import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import simpleGit from 'simple-git'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-git-workbench-'))
const paths = await import('./paths.ts')
const original = paths.WORKSPACE_ROOT
paths.setWorkspaceRoot(root)

const {
  cloneExternalRepository,
  commitDetail,
  commitFileDiff,
  commitWorkingTree,
  initializeRepository,
  listRepositories,
  repositoryInfo,
  repositoryLog,
  runCommitAction,
  workingTreeDetail,
  workingTreeFileDiff,
} = await import('./gitWorkbench.ts')

after(() => {
  paths.setWorkspaceRoot(original)
  fs.rmSync(root, { recursive: true, force: true })
})

test('저장소 초기화 뒤 로그·상세·파일 diff와 안전한 커밋 작업을 제공한다', async () => {
  await initializeRepository(paths.WORKSPACE_PROJECT, '')
  fs.mkdirSync(path.join(root, 'packages', 'addon'), { recursive: true })
  await simpleGit(path.join(root, 'packages', 'addon')).init()
  assert.deepEqual((await listRepositories(paths.WORKSPACE_PROJECT)).map((entry) => entry.path), ['', 'packages/addon'])
  fs.rmSync(path.join(root, 'packages'), { recursive: true, force: true })
  const git = simpleGit(root)
  await git.addConfig('user.name', 'Mew Test')
  await git.addConfig('user.email', 'mew@example.com')
  fs.writeFileSync(path.join(root, 'note.txt'), 'one\n')
  await git.add('note.txt')
  await git.commit('first')
  fs.writeFileSync(path.join(root, 'note.txt'), 'one\ntwo\n')
  await git.add('note.txt')
  await git.commit('second')

  const info = await repositoryInfo(paths.WORKSPACE_PROJECT, '')
  assert.equal(info.repository, true)
  assert.equal(info.dirty, false)

  const log = await repositoryLog(paths.WORKSPACE_PROJECT, '')
  assert.equal(log.length, 2)
  assert.equal(log[0].subject, 'second')
  assert.equal(log[0].parents.length, 1)

  const detail = await commitDetail(paths.WORKSPACE_PROJECT, '', log[0].hash)
  assert.deepEqual(detail.files, [{ status: 'M', path: 'note.txt' }])
  assert.match(await commitFileDiff(paths.WORKSPACE_PROJECT, '', log[0].hash, 'note.txt'), /^\+two$/m)

  await runCommitAction(paths.WORKSPACE_PROJECT, '', 'branch', log[0].hash, 'feature/test')
  await runCommitAction(paths.WORKSPACE_PROJECT, '', 'tag', log[0].hash, 'v0.1.0')
  assert.match(await git.raw(['branch', '--list', 'feature/test']), /feature\/test/)
  assert.match(await git.raw(['tag', '--list', 'v0.1.0']), /v0\.1\.0/)

  fs.writeFileSync(path.join(root, 'note.txt'), 'one\ntwo\nthree\n')
  fs.writeFileSync(path.join(root, 'draft.txt'), 'draft\n')
  const working = await workingTreeDetail(paths.WORKSPACE_PROJECT, '')
  assert.deepEqual(working.files.map((file) => file.path).sort(), ['draft.txt', 'note.txt'])
  assert.match(await workingTreeFileDiff(paths.WORKSPACE_PROJECT, '', 'note.txt'), /^\+three$/m)
  assert.match(await workingTreeFileDiff(paths.WORKSPACE_PROJECT, '', 'draft.txt'), /^\+draft$/m)
  await assert.rejects(() => commitWorkingTree(paths.WORKSPACE_PROJECT, '', '', ''), /커밋 제목/)

  const committed = await commitWorkingTree(paths.WORKSPACE_PROJECT, '', 'third', 'working tree body')
  assert.match(committed.hash, /^[0-9a-f]+$/)
  assert.equal((await repositoryInfo(paths.WORKSPACE_PROJECT, '')).dirty, false)
  const committedDetail = await commitDetail(paths.WORKSPACE_PROJECT, '', committed.hash)
  assert.equal(committedDetail.subject, 'third')
  assert.equal(committedDetail.body, 'working tree body')
  assert.deepEqual(committedDetail.files.map((file) => file.path).sort(), ['draft.txt', 'note.txt'])
  await assert.rejects(() => commitWorkingTree(paths.WORKSPACE_PROJECT, '', 'empty', ''), /커밋할 변경사항이 없습니다/)
})

test('로컬 원본 저장소를 현재 디렉터리 아래 clone한다', async () => {
  const destinationParent = fs.mkdtempSync(path.join(root, 'clones-'))
  const target = await cloneExternalRepository(destinationParent, root, 'copy')
  assert.equal(target, path.join(destinationParent, 'copy'))
  assert.equal(fs.existsSync(path.join(target, '.git')), true)
  assert.equal(fs.readFileSync(path.join(target, 'note.txt'), 'utf8'), 'one\ntwo\nthree\n')
  assert.equal(fs.readFileSync(path.join(target, 'draft.txt'), 'utf8'), 'draft\n')
})
