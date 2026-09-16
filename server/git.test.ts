import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import simpleGit from 'simple-git'
import { commitFile } from './git.ts'
import { renamePath } from './documents.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'

const originalRoot = WORKSPACE_ROOT
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-git-move-'))
setWorkspaceRoot(root)
after(() => {
  setWorkspaceRoot(originalRoot)
  fs.rmSync(root, { recursive: true, force: true })
})

async function repository(project: string) {
  const dir = path.join(root, project)
  fs.mkdirSync(dir)
  const git = simpleGit(dir)
  await git.init()
  await git.addConfig('user.name', 'Mew Test')
  await git.addConfig('user.email', 'mew@example.com')
  return { dir, git }
}

for (const tracked of [false, true]) {
  for (const folder of [false, true]) {
    test(`moving a ${tracked ? 'tracked' : 'new'} ${folder ? 'folder' : 'file'} records the destination without a missing-source error`, async () => {
      const project = `move-${tracked}-${folder}`
      const { dir, git } = await repository(project)
      const oldPath = folder ? 'draft' : '메모.md'
      const newPath = `archive/${oldPath}`
      const suffix = folder ? '/메모.md' : ''
      if (folder) fs.mkdirSync(path.join(dir, oldPath))
      fs.writeFileSync(path.join(dir, oldPath + suffix), 'keep this content\n')
      if (tracked) {
        await git.add(oldPath)
        await git.commit('initial')
      }
      fs.writeFileSync(path.join(dir, 'unrelated.md'), 'leave untracked\n')

      renamePath(project, oldPath, newPath)
      const result = await commitFile(project, [oldPath, newPath], 'rename')

      assert.ok(result?.hash)
      assert.equal(fs.existsSync(path.join(dir, oldPath)), false)
      assert.equal(fs.readFileSync(path.join(dir, newPath + suffix), 'utf8'), 'keep this content\n')
      assert.equal(await git.show([`HEAD:${newPath + suffix}`]), 'keep this content\n')
      assert.equal(await git.raw(['ls-files', '--', oldPath]), '')
      assert.deepEqual((await git.status()).not_added, ['unrelated.md'])
    })
  }
}

test('moving an ignored file succeeds without creating a commit', async () => {
  const project = 'move-ignored'
  const { dir, git } = await repository(project)
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.tmp\n')
  await git.add('.gitignore')
  await git.commit('ignore temporary files')
  fs.writeFileSync(path.join(dir, 'note.tmp'), 'temporary\n')
  renamePath(project, 'note.tmp', 'archive/note.tmp')

  assert.equal(await commitFile(project, ['note.tmp', 'archive/note.tmp'], 'rename'), null)
  assert.equal((await git.log()).total, 1)
  assert.equal(fs.readFileSync(path.join(dir, 'archive/note.tmp'), 'utf8'), 'temporary\n')
})

test('a missing untracked path does not commit unrelated staged changes', async () => {
  const project = 'missing-untracked'
  const { dir, git } = await repository(project)
  fs.writeFileSync(path.join(dir, 'unrelated.md'), 'leave staged\n')
  await git.add('unrelated.md')

  assert.equal(await commitFile(project, 'missing.md', 'delete'), null)
  assert.equal((await git.diff(['--cached', '--name-only'])).trim(), 'unrelated.md')
})
