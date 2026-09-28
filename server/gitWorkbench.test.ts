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
  assert.deepEqual((await listRepositories(paths.WORKSPACE_PROJECT)).map((entry) => entry.path), [''])
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

  const committed = await commitWorkingTree(paths.WORKSPACE_PROJECT, '', 'third', 'working tree body', ['draft.txt', 'note.txt'])
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


test('current project root excludes nested repositories and never falls back to an ancestor', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-git-root-only-'))
  const child = path.join(parent, 'child')
  fs.mkdirSync(child)
  await simpleGit(child).init()
  try {
    paths.setWorkspaceRoot(parent)
    assert.deepEqual(await listRepositories(paths.WORKSPACE_PROJECT), [])
    assert.equal((await repositoryInfo(paths.WORKSPACE_PROJECT, '')).repository, false)
    paths.setWorkspaceRoot(child)
    assert.deepEqual(await listRepositories(paths.WORKSPACE_PROJECT), [{ path: '' }])
    const plain = path.join(child, 'plain'); fs.mkdirSync(plain)
    paths.setWorkspaceRoot(plain)
    assert.deepEqual(await listRepositories(paths.WORKSPACE_PROJECT), [])
    assert.equal((await repositoryInfo(paths.WORKSPACE_PROJECT, '')).repository, false)
  } finally { paths.setWorkspaceRoot(root); fs.rmSync(parent, { recursive: true, force: true }) }
})


test('selected commits preserve unrelated staged contents and support unborn, rename, deletion and literal paths', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-selected-'))
  paths.setWorkspaceRoot(cwd)
  const git = simpleGit(cwd)
  try {
    await git.init(); await git.addConfig('user.name', 'Test'); await git.addConfig('user.email', 'test@example.test')
    const write = (file: string, text: string) => fs.writeFileSync(path.join(cwd, file), text)
    write('selected.txt', 'initial'); write('unselected.txt', 'staged initial')
    await git.add('unselected.txt')
    const commit = (files: unknown) => commitWorkingTree(paths.WORKSPACE_PROJECT, '', 'selected commit', '', files)
    const changed = async () => (await git.raw(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD'])).trim().split('\n')
    await assert.rejects(commit([]), /선택/)
    await assert.rejects(commit(undefined), /선택/)
    await assert.rejects(commit(['../outside']), /달라졌습니다/)
    await commit(['selected.txt'])
    assert.deepEqual(await changed(), ['selected.txt'])
    assert.match(await git.diff(['--cached']), /staged initial/)
    await git.commit('save other')
    write('unselected.txt', 'staged other'); await git.add('unselected.txt')
    write('unselected.txt', 'unstaged other')
    const index = await git.show([':unselected.txt'])
    await git.raw(['mv', 'selected.txt', 'renamed.txt'])
    await commit(['renamed.txt'])
    assert.deepEqual((await changed()).sort(), ['renamed.txt', 'selected.txt'])
    assert.equal(await git.show([':unselected.txt']), index)
    await git.raw(['rm', 'renamed.txt'])
    await commit(['renamed.txt'])
    assert.deepEqual(await changed(), ['renamed.txt'])
    write('[literal].txt', 'literal'); write('l.txt', 'exclude glob')
    fs.mkdirSync(path.join(cwd, 'new-dir')); write('new-dir/one.txt', 'one'); write('new-dir/two.txt', 'two')
    const files = (await workingTreeDetail(paths.WORKSPACE_PROJECT, '')).files.map(file => file.path)
    assert.ok(files.includes('new-dir/one.txt') && files.includes('new-dir/two.txt'))
    await commit(['[literal].txt', 'new-dir/one.txt'])
    assert.deepEqual((await changed()).sort(), ['[literal].txt', 'new-dir/one.txt'])
    assert.equal(await git.show([':unselected.txt']), index)
    assert.equal(fs.readFileSync(path.join(cwd, 'unselected.txt'), 'utf8'), 'unstaged other')
  } finally { paths.setWorkspaceRoot(root); fs.rmSync(cwd, { recursive: true, force: true }) }
})

test('remote actions pull fast-forward only and push only the tracked branch without force', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-git-remote-'))
  const remote = path.join(fixture, 'remote.git'), seed = path.join(fixture, 'seed'), client = path.join(fixture, 'client')
  fs.mkdirSync(remote); fs.mkdirSync(seed)
  const seedGit = simpleGit(seed)
  const { runRemoteAction } = await import('./gitWorkbench.ts')
  try {
    await simpleGit(remote).raw(['init', '--bare', '--initial-branch=main'])
    await seedGit.raw(['init', '--initial-branch=main'])
    await seedGit.addConfig('user.name', 'Mew Test'); await seedGit.addConfig('user.email', 'mew@example.com')
    const save = async (cwd: string, file: string, content: string) => {
      fs.writeFileSync(path.join(cwd, file), content)
      await simpleGit(cwd).add(file)
      await simpleGit(cwd).raw(['-c', 'commit.gpgsign=false', 'commit', '-m', content])
    }
    await save(seed, 'note.txt', 'initial')
    await seedGit.addRemote('origin', remote)
    await seedGit.push(['-u', 'origin', 'main'])
    await simpleGit(fixture).clone(remote, client)
    const git = simpleGit(client)
    await git.addConfig('user.name', 'Mew Test'); await git.addConfig('user.email', 'mew@example.com')
    paths.setWorkspaceRoot(client)
    await save(seed, 'note.txt', 'remote change'); await seedGit.push()
    fs.writeFileSync(path.join(client, 'draft.txt'), 'keep draft')
    await runRemoteAction(paths.WORKSPACE_PROJECT, '', 'pull')
    assert.equal(fs.readFileSync(path.join(client, 'note.txt'), 'utf8'), 'remote change')
    assert.equal(fs.readFileSync(path.join(client, 'draft.txt'), 'utf8'), 'keep draft')
    await save(client, 'local.txt', 'local change')
    await git.raw(['branch', 'unpublished'])
    await git.addConfig('push.default', 'matching')
    await git.addConfig('remote.origin.push', 'refs/heads/*:refs/heads/*')
    await runRemoteAction(paths.WORKSPACE_PROJECT, '', 'push')
    assert.equal((await simpleGit(remote).revparse('main')).trim(), (await git.revparse('HEAD')).trim())
    assert.equal((await simpleGit(remote).raw(['branch', '--list', 'unpublished'])).trim(), '')
    const pending = runRemoteAction(paths.WORKSPACE_PROJECT, '', 'push')
    await assert.rejects(runRemoteAction(paths.WORKSPACE_PROJECT, '', 'push'), /이미 실행 중/)
    await pending
    await seedGit.pull(['--ff-only'])
    await save(seed, 'note.txt', 'diverged remote'); await seedGit.push()
    await save(client, 'local.txt', 'diverged local')
    const head = await git.revparse('HEAD'), remoteHead = await simpleGit(remote).revparse('main')
    await git.addConfig('pull.rebase', 'true')
    await assert.rejects(runRemoteAction(paths.WORKSPACE_PROJECT, '', 'pull'), /fast-forward|diverg/i)
    assert.equal(await git.revparse('HEAD'), head)
    await assert.rejects(runRemoteAction(paths.WORKSPACE_PROJECT, '', 'push'), /rejected|fetch first|non-fast-forward/i)
    assert.equal(await simpleGit(remote).revparse('main'), remoteHead)
    await assert.rejects(runRemoteAction(paths.WORKSPACE_PROJECT, '', 'push --force'), /지원하지 않는/)
    await git.checkout('unpublished')
    await assert.rejects(runRemoteAction(paths.WORKSPACE_PROJECT, '', 'push'), /upstream/)
    await git.checkout(['--detach', 'HEAD'])
    await assert.rejects(runRemoteAction(paths.WORKSPACE_PROJECT, '', 'pull'), /브랜치로 전환/)
  } finally {
    paths.setWorkspaceRoot(root)
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})
