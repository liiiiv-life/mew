// 트리 감시 대상 디렉터리 선정 — 임시 트리를 만들어 node_modules·dist·build·.git 같은 제외 구역엔
// 내려가지 않고(감시 폭발·inotify 한계 방지), 소스 폴더와 .mew 는 감시하는지 확인한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { collectWatchDirs, collectWatchDirsAsync, resetTreeWatchers, watchProjectTree } from './watcher.ts'
import { WORKSPACE_PROJECT, WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'

function withTree(fn: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-watch-'))
  try {
    fn(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('collectWatchDirs: 소스·.mew 하위는 감시하고 node_modules·dist·build·.git 은 내려가지 않는다', () => {
  withTree((root) => {
    for (const dir of [
      'src/components',
      '.mew',
      'node_modules/foo/bar',
      'dist/assets',
      'build/app/outputs',
      '.git/objects',
      '.data',
      '.worktrees/task/src',
    ]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true })
    }
    const dirs = collectWatchDirs(root).map((d) => path.relative(root, d))

    assert.ok(dirs.includes('')) // root 자신
    assert.ok(dirs.includes('src'))
    assert.ok(dirs.includes(path.join('src', 'components')))
    assert.ok(dirs.includes('.mew'))

    for (const excluded of ['node_modules', 'dist', 'build', '.git', '.data', '.worktrees']) {
      assert.ok(
        !dirs.some((d) => d === excluded || d.startsWith(excluded + path.sep)),
        `${excluded} 는 감시 대상에서 제외돼야 한다`,
      )
    }
  })
})

test('숨김 목록에 없어도 .worktrees는 감시하지 않고 명시한 워크트리 루트는 감시한다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-watch-worktree-'))
  const worktree = path.join(root, '.worktrees', 'task')
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true })
  try {
    assert.deepEqual(collectWatchDirs(root, new Set()), [root])
    assert.deepEqual(await collectWatchDirsAsync(root, new Set()), [root])
    const wanted = [worktree, path.join(worktree, 'src')]
    assert.deepEqual(collectWatchDirs(worktree, new Set()), wanted)
    assert.deepEqual(await collectWatchDirsAsync(worktree, new Set()), wanted)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rename으로 생긴 .worktrees와 제외 폴더를 syncTarget이 다시 감시하지 않는다', async (t) => {
  const original = WORKSPACE_ROOT
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-watch-rename-'))
  const listeners = new Map<string, fs.WatchListener<string>>()
  const watched: string[] = []
  t.mock.method(fs, 'watch', ((dir: fs.PathLike, listener: fs.WatchListener<string>) => {
    const absolute = dir.toString()
    listeners.set(absolute, listener)
    watched.push(absolute)
    const watcher = new EventEmitter() as fs.FSWatcher
    watcher.close = () => { listeners.delete(absolute) }
    return watcher
  }) as typeof fs.watch)
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 3000
    while (!predicate()) {
      assert.ok(Date.now() < deadline, '감시 대상 갱신이 완료되어야 한다')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  try {
    setWorkspaceRoot(root)
    watchProjectTree(WORKSPACE_PROJECT)
    await waitFor(() => listeners.has(root))
    const onRoot = listeners.get(root)!
    for (const excluded of ['.worktrees', 'dist', 'build', 'node_modules']) {
      fs.mkdirSync(path.join(root, excluded, 'task', 'src'), { recursive: true })
      onRoot('rename', excluded)
    }
    fs.mkdirSync(path.join(root, 'added'))
    onRoot('rename', 'added')
    await waitFor(() => listeners.has(path.join(root, 'added')))
    assert.deepEqual(watched, [root, path.join(root, 'added')])

    const worktree = path.join(root, '.worktrees', 'task')
    setWorkspaceRoot(worktree)
    watchProjectTree(WORKSPACE_PROJECT)
    await waitFor(() => listeners.has(path.join(worktree, 'src')))
    assert.ok(listeners.has(worktree), '별도로 연 워크트리는 정상 감시한다')
  } finally {
    resetTreeWatchers()
    setWorkspaceRoot(original)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('watchProjectTree: 존재하지 않는 프로젝트는 던지지 않고 무시한다', () => {
  assert.doesNotThrow(() => watchProjectTree('this-project-does-not-exist-zzz'))
})

test('collectWatchDirsAsync: 동기 순회와 같은 감시 대상을 만든다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-watch-'))
  try {
    for (const dir of ['src/components', 'node_modules/foo', 'dist/assets', '.git/objects']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true })
    }
    assert.deepEqual(await collectWatchDirsAsync(root), collectWatchDirs(root))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
