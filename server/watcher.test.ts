// 트리 감시 대상 디렉터리 선정 — 임시 트리를 만들어 node_modules·dist·build·.git 같은 제외 구역엔
// 내려가지 않고(감시 폭발·inotify 한계 방지), 소스 폴더와 .mew 는 감시하는지 확인한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectWatchDirs, watchProjectTree } from './watcher.ts'

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
    ]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true })
    }
    const dirs = collectWatchDirs(root).map((d) => path.relative(root, d))

    assert.ok(dirs.includes('')) // root 자신
    assert.ok(dirs.includes('src'))
    assert.ok(dirs.includes(path.join('src', 'components')))
    assert.ok(dirs.includes('.mew'))

    for (const excluded of ['node_modules', 'dist', 'build', '.git', '.data']) {
      assert.ok(
        !dirs.some((d) => d === excluded || d.startsWith(excluded + path.sep)),
        `${excluded} 는 감시 대상에서 제외돼야 한다`,
      )
    }
  })
})

test('watchProjectTree: 존재하지 않는 프로젝트는 던지지 않고 무시한다', () => {
  assert.doesNotThrow(() => watchProjectTree('this-project-does-not-exist-zzz'))
})
