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
  discardWorkingTree,
  initializeRepository,
  listRepositories,
  repositoryInfo,
  repositoryLog,
  repositoryBranches,
  runBranchAction,
  runCommitAction,
  workingTreeDetail,
  workingTreeFileDiff,
} = await import('./gitWorkbench.ts')

after(() => {
  paths.setWorkspaceRoot(original)
  fs.rmSync(root, { recursive: true, force: true })
})

test('discard restores only selected staged/unstaged files, deletions and renames, and removes selected new files', async t => {
  const directory = path.join(root, 'discard')
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(directory)
  const git = simpleGit(directory)
  await git.init()
  await git.addConfig('user.name', 'Mew Test')
  await git.addConfig('user.email', 'mew@example.com')
  const original = ['modified.txt', 'deleted.txt', 'rename.txt', 'keep.txt', 'literal[1].txt']
  for (const file of original) fs.writeFileSync(path.join(directory, file), 'original\n')
  await git.add('.')
  await git.commit('initial')
  fs.writeFileSync(path.join(directory, 'modified.txt'), 'staged\n')
  fs.writeFileSync(path.join(directory, 'keep.txt'), 'keep staged\n')
  await git.add(['modified.txt', 'keep.txt'])
  fs.writeFileSync(path.join(directory, 'modified.txt'), 'unstaged\n')
  fs.writeFileSync(path.join(directory, 'literal[1].txt'), 'changed\n')
  fs.unlinkSync(path.join(directory, 'deleted.txt'))
  await git.mv('rename.txt', 'renamed.txt')
  fs.writeFileSync(path.join(directory, 'new.txt'), 'new\n')
  await git.add('new.txt')
  fs.writeFileSync(path.join(directory, 'untracked.txt'), 'new\n')
  fs.writeFileSync(path.join(directory, 'keep-new.txt'), 'keep\n')
  const selected = ['modified.txt', 'deleted.txt', 'renamed.txt', 'literal[1].txt', 'new.txt', 'untracked.txt']
  fs.writeFileSync(path.join(directory, 'rename.txt'), 'unselected replacement\n')
  await assert.rejects(discardWorkingTree(paths.WORKSPACE_PROJECT, 'discard', selected), /함께 선택/)
  assert.equal(fs.readFileSync(path.join(directory, 'rename.txt'), 'utf8'), 'unselected replacement\n')
  fs.unlinkSync(path.join(directory, 'rename.txt'))
  await assert.rejects(discardWorkingTree(paths.WORKSPACE_PROJECT, 'discard', ['modified.txt', 'missing.txt']))
  assert.equal(fs.readFileSync(path.join(directory, 'modified.txt'), 'utf8'), 'unstaged\n')
  await assert.rejects(discardWorkingTree(paths.WORKSPACE_PROJECT, 'discard', ['../outside']))
  await assert.rejects(discardWorkingTree(paths.WORKSPACE_PROJECT, 'discard', []))
  await discardWorkingTree(paths.WORKSPACE_PROJECT, 'discard', selected)
  for (const file of original.filter(file => file !== 'keep.txt')) assert.equal(fs.readFileSync(path.join(directory, file), 'utf8'), 'original\n')
  for (const file of ['renamed.txt', 'new.txt', 'untracked.txt']) assert.equal(fs.existsSync(path.join(directory, file)), false)
  assert.equal(await git.raw(['show', ':keep.txt']), 'keep staged\n')
  assert.equal(fs.readFileSync(path.join(directory, 'keep-new.txt'), 'utf8'), 'keep\n')
  assert.deepEqual((await git.status()).files.map(file => file.path).sort(), ['keep-new.txt', 'keep.txt'])
})

test('discard supports repositories without HEAD and rejects directories before changing files', async t => {
  const directory = path.join(root, 'discard-unborn')
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(directory)
  const git = simpleGit(directory)
  await git.init()
  fs.writeFileSync(path.join(directory, 'added.txt'), 'new\n')
  await git.add('added.txt')
  fs.writeFileSync(path.join(directory, 'keep.txt'), 'keep\n')
  await discardWorkingTree(paths.WORKSPACE_PROJECT, 'discard-unborn', ['added.txt'])
  assert.equal(fs.existsSync(path.join(directory, 'added.txt')), false)
  assert.equal(fs.existsSync(path.join(directory, 'keep.txt')), true)
  await git.add('keep.txt')
  fs.unlinkSync(path.join(directory, 'keep.txt'))
  fs.mkdirSync(path.join(directory, 'keep.txt'))
  fs.writeFileSync(path.join(directory, 'keep.txt', 'nested.txt'), 'preserve\n')
  await assert.rejects(discardWorkingTree(paths.WORKSPACE_PROJECT, 'discard-unborn', ['keep.txt']), /폴더/)
  assert.equal(fs.existsSync(path.join(directory, 'keep.txt', 'nested.txt')), true)
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
    const progress: import('../shared/git-remote-progress.ts').GitRemoteProgress[] = []
    await runRemoteAction(paths.WORKSPACE_PROJECT, '', 'push', event => progress.push(event))
    assert.ok(progress.some(event => event.phase === 'writing' && event.percent === 100), 'real local push emits transfer progress')
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

test('branch picker lists refs, creates from explicit bases and switches without discarding changes', async () => {
  const cwd = fs.mkdtempSync(path.join(root, 'branches-')), rel = path.relative(root, cwd)
  const git = simpleGit(cwd)
  await git.init(['--initial-branch=main'])
  await git.addConfig('user.name', 'Branch Test'); await git.addConfig('user.email', 'branch@example.test')
  await runBranchAction(paths.WORKSPACE_PROJECT, rel, 'create', 'HEAD', 'empty')
  assert.equal((await git.status()).current, 'empty', 'unborn repository can create a branch')
  await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'base\n'); await git.add('note.txt'); await git.commit('base')
  const base = (await git.revparse(['HEAD'])).trim()
  await git.raw(['tag', 'v1'])
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'main\n'); await git.add('note.txt'); await git.commit('main')
  const main = (await git.revparse(['HEAD'])).trim()
  await git.addRemote('origin', 'https://github.com/example/fixture.git')
  await git.raw(['update-ref', 'refs/remotes/origin/topic', base])
  await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/topic'])
  const refs = await repositoryBranches(paths.WORKSPACE_PROJECT, rel)
  assert.deepEqual(refs.map(ref => ref.ref), ['refs/heads/main', 'refs/remotes/origin/topic', 'refs/tags/v1'])
  const created = await runBranchAction(paths.WORKSPACE_PROJECT, rel, 'create', 'refs/tags/v1', 'feature/from-tag')
  assert.equal(created.branch, 'feature/from-tag'); assert.equal((await git.revparse(['HEAD'])).trim(), base)
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'unsaved changes\n'); await git.add('note.txt')
  await assert.rejects(runBranchAction(paths.WORKSPACE_PROJECT, rel, 'switch', 'refs/heads/main'), /overwritten|local changes/i)
  assert.equal((await git.status()).current, 'feature/from-tag')
  assert.equal(fs.readFileSync(path.join(cwd, 'note.txt'), 'utf8'), 'unsaved changes\n')
  assert.match(await git.diff(['--cached']), /unsaved changes/)
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'base\n'); await git.add('note.txt')
  await runBranchAction(paths.WORKSPACE_PROJECT, rel, 'switch', 'refs/heads/main')
  assert.equal((await git.revparse(['HEAD'])).trim(), main)
  await runBranchAction(paths.WORKSPACE_PROJECT, rel, 'create', main.slice(0, 10), 'from-hash')
  assert.equal((await git.revparse(['HEAD'])).trim(), main)
  await runBranchAction(paths.WORKSPACE_PROJECT, rel, 'create', 'HEAD', 'from-head')
  assert.equal((await git.revparse(['HEAD'])).trim(), main)
  await runBranchAction(paths.WORKSPACE_PROJECT, rel, 'create', 'refs/heads/feature/from-tag', 'from-local')
  assert.equal((await git.revparse(['HEAD'])).trim(), base)
  await runBranchAction(paths.WORKSPACE_PROJECT, rel, 'create', 'refs/remotes/origin/topic', 'from-remote')
  assert.equal((await git.revparse(['HEAD'])).trim(), base)
  assert.equal((await git.getConfig('branch.from-remote.remote')).value, null, 'custom names do not acquire unintended upstreams')
  await runBranchAction(paths.WORKSPACE_PROJECT, rel, 'switch', 'refs/remotes/origin/topic')
  assert.equal((await git.status()).current, 'topic')
  assert.equal((await git.getConfig('branch.topic.remote')).value, 'origin')
  assert.equal((await git.getConfig('branch.topic.merge')).value, 'refs/heads/topic')
  for (const ref of ['--force', 'HEAD~1', 'refs/heads/missing', 'refs/tags/v1', 'refs/remotes/origin/HEAD']) {
    await assert.rejects(runBranchAction(paths.WORKSPACE_PROJECT, rel, 'switch', ref))
  }
  for (const name of ['--force', 'bad..name', 'bad\0name', 'main', 'bad.lock']) {
    await assert.rejects(runBranchAction(paths.WORKSPACE_PROJECT, rel, 'create', 'HEAD', name))
  }
  await assert.rejects(runBranchAction(paths.WORKSPACE_PROJECT, rel, 'create', 'HEAD~1', 'bad-base'))
  assert.equal((await git.status()).current, 'topic')
})

test('working tree defaults select only files whose current contents came from this IP', async t => {
  const directory = path.join(root, 'ip-defaults')
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  fs.mkdirSync(directory)
  await simpleGit(directory).init()
  const { recordChangeIp } = await import('./change-ip.ts')
  for (const [name, ip] of [['mine.txt', 'client-a'], ['other.txt', 'client-b'], ['external.txt', 'client-a']]) {
    const file = path.join(directory, name)
    fs.writeFileSync(file, 'saved')
    recordChangeIp(file, ip, 'saved')
  }
  fs.writeFileSync(path.join(directory, 'external.txt'), 'outside edit')
  const details = await workingTreeDetail(paths.WORKSPACE_PROJECT, 'ip-defaults', 'client-a')
  assert.deepEqual(details.files.filter(file => file.currentIp).map(file => file.path), ['mine.txt'])
  assert.equal(details.files.length, 3)
})
