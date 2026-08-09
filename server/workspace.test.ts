// 워크스페이스 갈아끼우기 — 진짜 워크스페이스와 사용자의 설정 파일을 건드리지 않도록,
// XDG_CONFIG_HOME을 임시 폴더로 돌려놓고(설정 저장 위치) 임시 폴더 사이에서만 오간다.
import { strict as assert } from 'node:assert'
import { after, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-ws-'))
process.env.XDG_CONFIG_HOME = path.join(tmp, 'config')

const { currentWorkspace, switchWorkspace, WorkspaceError } = await import('./workspace.ts')
// paths는 네임스페이스로 잡는다 — 경로들이 갈아끼워지는 라이브 바인딩이라 뜯어내면 옛 값이 굳는다
const paths = await import('./paths.ts')
const { listProjects, setWorkspaceRoot } = paths
const { resetTreeWatchers } = await import('./watcher.ts')

const original = paths.WORKSPACE_ROOT
const configFile = path.join(tmp, 'config', 'mew', 'config.env')

after(() => {
  // 바꿀 때마다 새 워크스페이스에 트리 감시가 붙는다 — 안 접으면 테스트 프로세스가 끝나지 않는다
  resetTreeWatchers()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('워크스페이스를 바꾸면 경로·프로젝트 목록·설정 파일이 따라온다', () => {
  const next = path.join(tmp, 'workspace')
  fs.mkdirSync(path.join(next, 'alpha'), { recursive: true })
  fs.mkdirSync(path.join(next, 'beta'), { recursive: true })

  try {
    const info = switchWorkspace(next)

    assert.equal(info.path, next)
    assert.deepEqual(info.projects, ['alpha', 'beta'])
    assert.deepEqual(listProjects(), ['alpha', 'beta'])
    // docs는 워크스페이스마다 하나 — 새 폴더에 빈 docs가 생긴다
    assert.equal(currentWorkspace().path, next)
    assert.ok(fs.existsSync(path.join(next, '.mew', 'docs')))

    // 다음 실행에도 같은 폴더로 뜨도록 설정에 남는다
    assert.match(fs.readFileSync(configFile, 'utf8'), new RegExp(`^MEW_WORKSPACE='${next}'$`, 'm'))
  } finally {
    setWorkspaceRoot(original)
  }
})

test('설정 파일의 다른 값은 남고 MEW_WORKSPACE만 갈린다', () => {
  fs.mkdirSync(path.dirname(configFile), { recursive: true })
  fs.writeFileSync(configFile, "MEW_TEAM_PORT=5000\nMEW_WORKSPACE='/old/place'\n")
  const next = fs.mkdtempSync(path.join(tmp, 'other-'))

  try {
    switchWorkspace(next)
    const written = fs.readFileSync(configFile, 'utf8')
    assert.match(written, /^MEW_TEAM_PORT=5000$/m)
    assert.equal(written.match(/MEW_WORKSPACE=/g)?.length, 1)
    assert.match(written, new RegExp(`MEW_WORKSPACE='${next}'`))
  } finally {
    setWorkspaceRoot(original)
  }
})

test('없는 폴더·파일·따옴표 낀 경로는 거부한다 — 바꾸기 전 상태 그대로', () => {
  const file = path.join(tmp, 'not-a-folder')
  fs.writeFileSync(file, 'x')

  assert.throws(() => switchWorkspace(path.join(tmp, 'nope')), WorkspaceError)
  assert.throws(() => switchWorkspace(file), WorkspaceError)
  assert.throws(() => switchWorkspace(path.join(tmp, "it's")), WorkspaceError)
  assert.equal(currentWorkspace().path, original)
  assert.equal(paths.DOCS_ROOT, path.join(original, '.mew', 'docs'))
})
