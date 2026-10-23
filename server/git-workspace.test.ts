import './test-isolated-data.ts'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { commitFile, fileHistory, invalidateGit, showAtCommit, showHeadContent } from './git.ts'
import { DEFAULT_PROJECT, pathsForWorkspace, projectRoot, WORKSPACE_PROJECT, workspaceContext } from './paths.ts'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function initialize(cwd: string): void {
  fs.mkdirSync(cwd, { recursive: true })
  git(cwd, 'init', '-b', 'main')
  git(cwd, 'config', 'user.name', 'Mew Test')
  git(cwd, 'config', 'user.email', 'mew@example.test')
}

function seed(cwd: string, label: string): void {
  fs.writeFileSync(path.join(cwd, '.gitignore'), `/.worktrees/\n/docs/\nignored-on-${label}.txt\n`)
  fs.writeFileSync(path.join(cwd, 'note.md'), `${label} content\n`)
  if (label === 'task') fs.writeFileSync(path.join(cwd, 'task-only.md'), 'task-only content\n')
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-m', `${label} content`)
}

function fixture(t: test.TestContext) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-git-workspace-')))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const primary = path.join(temporary, 'project')
  initialize(primary)
  seed(primary, 'primary')
  const linked = path.join(primary, '.worktrees', 'task')
  git(primary, 'worktree', 'add', '-b', 'feat/task', linked)
  seed(linked, 'task')
  for (const [cwd, label] of [[primary, 'primary'], [linked, 'task']] as const) {
    initialize(path.join(cwd, 'docs'))
    seed(path.join(cwd, 'docs'), label)
  }
  return { primary, linked }
}

function inWorkspace<T>(cwd: string, action: () => T): T {
  return workspaceContext.run(pathsForWorkspace(cwd, null), action)
}

for (const project of [WORKSPACE_PROJECT, DEFAULT_PROJECT]) {
  test(`${project} HEAD, history and commit contents follow each explicit linked-worktree workspace`, async t => {
    const { primary, linked } = fixture(t)
    for (let turn = 0; turn < 3; turn++) {
      await Promise.all([[primary, 'primary'], [linked, 'task']].map(async ([cwd, label]) => {
        await inWorkspace(cwd!, async () => {
          const repository = projectRoot(project)
          const head = git(repository, 'rev-parse', 'HEAD')
          assert.equal(await showHeadContent(project, 'note.md'), `${label} content\n`)
          assert.equal(await showAtCommit(project, 'note.md', head), `${label} content\n`)
          const history = await fileHistory(project, 'note.md')
          assert.equal(history[0]?.hash, head)
          assert.equal(history[0]?.message, `${label} content`)
        })
      }))
    }
    assert.equal(fs.statSync(path.join(linked, '.git')).isFile(), true, 'the fixture must use a real linked worktree')
  })

  test(`${project} commit prechecks use the selected worktree's ignore rules, tracked paths and index`, async t => {
    const { primary, linked } = fixture(t)
    const primaryRoot = inWorkspace(primary, () => projectRoot(project))
    const linkedRoot = inWorkspace(linked, () => projectRoot(project))
    const originalHead = git(primaryRoot, 'rev-parse', 'HEAD')
    const originalIndex = git(primaryRoot, 'ls-files', '--stage')
    await inWorkspace(primary, () => showHeadContent(project, 'note.md'))

    await inWorkspace(linked, async () => {
      fs.writeFileSync(path.join(linkedRoot, 'ignored-on-primary.txt'), 'tracked only in task\n')
      assert.ok((await commitFile(project, 'ignored-on-primary.txt', 'add'))?.hash, 'primary ignore rules cannot hide a worktree file')
      assert.equal(git(linkedRoot, 'show', 'HEAD:ignored-on-primary.txt'), 'tracked only in task')

      fs.writeFileSync(path.join(linkedRoot, 'ignored-on-task.txt'), 'ignored task file\n')
      const beforeIgnored = git(linkedRoot, 'rev-parse', 'HEAD')
      assert.equal(await commitFile(project, 'ignored-on-task.txt', 'add'), null)
      assert.equal(git(linkedRoot, 'rev-parse', 'HEAD'), beforeIgnored)

      fs.writeFileSync(path.join(linkedRoot, 'note.md'), 'updated task content\n')
      assert.ok((await commitFile(project, 'note.md', 'update'))?.hash, 'a clean primary index cannot suppress a worktree commit')
      assert.equal(git(linkedRoot, 'show', 'HEAD:note.md'), 'updated task content')

      fs.unlinkSync(path.join(linkedRoot, 'task-only.md'))
      assert.ok((await commitFile(project, 'task-only.md', 'delete'))?.hash, 'a worktree-only tracked deletion must be committed')
      assert.equal(git(linkedRoot, 'ls-files', '--', 'task-only.md'), '')
      assert.equal(git(linkedRoot, 'status', '--porcelain=v1'), '')
    })

    assert.equal(git(primaryRoot, 'rev-parse', 'HEAD'), originalHead)
    assert.equal(git(primaryRoot, 'ls-files', '--stage'), originalIndex)
    assert.equal(fs.readFileSync(path.join(primaryRoot, 'note.md'), 'utf8'), 'primary content\n')
    assert.equal(git(primaryRoot, 'status', '--porcelain=v1'), '')
  })
}

test('Git initialization invalidates only the selected absolute project root', async t => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-git-invalidate-')))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  const first = path.join(temporary, 'first'), second = path.join(temporary, 'second')
  for (const cwd of [first, second]) fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true })

  for (const project of [WORKSPACE_PROJECT, DEFAULT_PROJECT]) {
    for (const cwd of [first, second]) assert.equal(await inWorkspace(cwd, () => showHeadContent(project, 'note.md')), null)
    for (const [cwd, label] of [[first, 'first'], [second, 'second']] as const) {
      await inWorkspace(cwd, async () => {
        initialize(projectRoot(project))
        fs.writeFileSync(path.join(projectRoot(project), 'note.md'), `${label} content\n`)
        git(projectRoot(project), 'add', 'note.md')
        git(projectRoot(project), 'commit', '-m', `${label} content`)
        assert.equal(await showHeadContent(project, 'note.md'), null, 'the existing non-repository result stays cached until invalidation')
        invalidateGit(project)
        assert.equal(await showHeadContent(project, 'note.md'), `${label} content\n`)
      })
    }
    assert.equal(await inWorkspace(first, () => showHeadContent(project, 'note.md')), 'first content\n')
    assert.equal(await inWorkspace(second, () => showHeadContent(project, 'note.md')), 'second content\n')
  }
})
