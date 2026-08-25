// 역할별 트리 가시성 — owner·manager(showAll)는 확장자·숨김 목록에 걸리지 않고 그대로 보고,
// member 이하는 문서용으로 걸러 본다. 어느 역할이든 차단 경로(.git·node_modules·.data)와
// build/ 산출물은 그대로 막힌다. 정책 기준본은 docs/ops/mew/access-model.md.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { WORKSPACE_PROJECT, WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import type { Role } from './reqAuth.ts'
import { buildTree, buildTreeAsync, isPathVisible, type TreeNode } from './tree.ts'
import { createApiApp } from './api.ts'
import { resetTreeWatchers } from './watcher.ts'

const DOCS = 'docs'
const CODE = 'some-code-project' // docs가 아닌 아무 프로젝트 (판정은 이름 규칙만 본다)

test('docs 프로젝트: 기본 눈에는 .md와 미디어만 뜬다', () => {
  assert.equal(isPathVisible(DOCS, 'ops/mew/access-model.md'), true)
  assert.equal(isPathVisible(DOCS, 'assets/screenshot.png'), true)
  assert.equal(isPathVisible(DOCS, 'ops/notes.txt'), false)
  assert.equal(isPathVisible(DOCS, 'ops/server.ts'), false)
})

test('showAll: docs에서도 확장자를 가리지 않는다', () => {
  assert.equal(isPathVisible(DOCS, 'ops/notes.txt', { showAll: true }), true)
  assert.equal(isPathVisible(DOCS, 'ops/server.ts', { showAll: true }), true)
  assert.equal(isPathVisible(DOCS, 'ops/weird.zip', { showAll: true }), true)
  assert.equal(isPathVisible(DOCS, 'ops/no-extension-at-all', { showAll: true }), true)
})

test('코드 프로젝트: 기본 눈은 텍스트 화이트리스트, showAll은 무엇이든 통과', () => {
  assert.equal(isPathVisible(CODE, 'src/App.tsx'), true)
  assert.equal(isPathVisible(CODE, '.env'), true) // 시크릿은 로그인 역할에 열려 있다 (게스트는 guestAccess가 거른다)
  assert.equal(isPathVisible(CODE, 'tools/report.zip'), false)
  assert.equal(isPathVisible(CODE, 'tools/report.zip', { showAll: true }), true)
  assert.equal(isPathVisible(CODE, 'tools/report.xlsx'), true) // 뷰어가 있는 바이너리는 화이트리스트다
})

test('숨김 목록은 showAll에서만 풀린다', () => {
  assert.equal(isPathVisible(CODE, 'dist/index.js'), false)
  assert.equal(isPathVisible(CODE, 'dist/index.js', { showAll: true }), true)
  assert.equal(isPathVisible(CODE, '.next/server/page.js'), false)
  assert.equal(isPathVisible(CODE, '.next/server/page.js', { showAll: true }), true)
})

test('차단 경로는 showAll이어도 뚫리지 않는다 — API가 경로 자체를 거부하므로', () => {
  for (const p of ['.git/config', 'node_modules/react/index.js', '.data/users.json']) {
    assert.equal(isPathVisible(CODE, p), false, `${p}는 기본 눈에서 막혀야 한다`)
    assert.equal(isPathVisible(CODE, p, { showAll: true }), false, `${p}는 showAll에서도 막혀야 한다`)
  }
})

test('build/ 안은 showAll이어도 APK·AAB만 — 산출물 홍수 방지 규칙은 숨김 목록이 아니다', () => {
  assert.equal(isPathVisible(CODE, 'build/app/outputs/flutter-apk/app-debug.apk', { showAll: true }), true)
  assert.equal(isPathVisible(CODE, 'build/app/intermediates/classes.dex', { showAll: true }), false)
  assert.equal(isPathVisible(CODE, 'build/app/outputs/logs/build.txt', { showAll: true }), false)
})

test('폴더 판정은 확장자를 보지 않는다', () => {
  assert.equal(isPathVisible(CODE, 'src/components', { type: 'dir' }), true)
  assert.equal(isPathVisible(CODE, 'dist/assets', { type: 'dir' }), false)
  assert.equal(isPathVisible(CODE, 'dist/assets', { type: 'dir', showAll: true }), true)
  assert.equal(isPathVisible(CODE, 'node_modules/react', { type: 'dir', showAll: true }), false)
})

test('빈 경로(프로젝트 루트)는 트리의 항목이 아니다', () => {
  assert.equal(isPathVisible(CODE, ''), false)
  assert.equal(isPathVisible(CODE, '', { type: 'dir', showAll: true }), false)
})

test('비동기 트리는 동기 트리와 같은 가시성·정렬 결과를 만든다', async () => {
  assert.deepEqual(await buildTreeAsync(DOCS), buildTree(DOCS))
})

// ── GET /tree 배선 ────────────────────────────────────────────────────────────
// 임시 프로젝트 폴더를 실제로 만들고 라우터를 bare express에 마운트해(인증은 스텁) 역할별로 두드린다.
// 여기서 보는 것은 "역할 → showAll" 배선 하나다. 규칙 자체는 위 isPathVisible 테스트가 본다.

/** 트리를 납작하게 편 경로 목록 */
function paths(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...(n.children ? paths(n.children) : [])])
}

test('GET /tree: owner·manager는 거르지 않은 트리를, member는 걸러진 트리를 받는다', async (t) => {
  const project = `ztree${process.pid}${Math.random().toString(36).slice(2, 6)}`
  const dir = path.join(WORKSPACE_ROOT, project)
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'node_modules', 'left-pad'), { recursive: true })

  fs.writeFileSync(path.join(dir, 'note.md'), '# hi\n')
  fs.writeFileSync(path.join(dir, 'archive.zip'), 'not really an archive')
  fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export {}\n')
  fs.writeFileSync(path.join(dir, 'dist', 'bundle.js'), '// built\n')
  fs.writeFileSync(path.join(dir, 'node_modules', 'left-pad', 'index.js'), '// dep\n')

  let role: Role = 'member'
  const app = express()
  app.use(express.json())
  // 인증 스텁 — 실서버에선 attachAuthContext가 채운다
  app.use((req, _res, next) => {
    ;(req as express.Request & { auth?: unknown }).auth = { role, email: 'tester@x.com', mustChangePassword: false }
    next()
  })
  app.use('/api', createApiApp())
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''

  const treeFor = async (as: Role): Promise<string[]> => {
    role = as
    const res = await fetch(`${base}/api/tree?project=${project}`)
    assert.equal(res.status, 200, `${as} 트리 조회는 성공해야 한다`)
    return paths((await res.json()) as TreeNode[])
  }

  try {
    const member = await treeFor('member')
    assert.ok(member.includes('note.md'), 'member도 .md는 본다')
    assert.ok(member.includes('src/app.ts'), 'member도 소스 파일은 본다')
    assert.ok(!member.includes('archive.zip'), 'member에게 화이트리스트 밖 확장자는 안 보인다')
    assert.ok(!member.some((p) => p.startsWith('dist')), 'member에게 숨김 목록(dist)은 안 보인다')

    for (const as of ['owner', 'manager'] as const) {
      const all = await treeFor(as)
      assert.ok(all.includes('archive.zip'), `${as}는 확장자를 가리지 않고 본다`)
      assert.ok(all.includes('dist/bundle.js'), `${as}는 숨김 목록도 뚫고 본다`)
      assert.ok(
        !all.some((p) => p.startsWith('node_modules')),
        `${as}에게도 차단 경로(node_modules)는 안 보인다`,
      )
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    // GET /tree가 이 임시 프로젝트에 fs.watch를 걸어뒀다 — 접지 않으면 이벤트 루프가 살아 있어
    // 테스트가 끝나도 프로세스가 종료되지 않는다
    resetTreeWatchers()
    fs.rmSync(dir, { recursive: true, force: true })
  }

  t.diagnostic(`임시 프로젝트 ${project} 정리 완료`)
})

// ── 홈(.workspace) 스코프 ─────────────────────────────────────────────────────
// 홈 탭은 워크스페이스 폴더 자신을 프로젝트처럼 본다. 프로젝트 폴더와 docs 폴더·.mew는 위쪽 탭 줄이
// 맡는 자리라 트리에서 빠진다 — 다만 **맨 위 칸에서만** 빠진다.

test('홈(.workspace) 트리: 워크스페이스 루트를 보되 프로젝트 폴더와 docs·.mew는 빠진다', () => {
  const original = WORKSPACE_ROOT
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-ws-')))
  fs.mkdirSync(path.join(root, 'some-project'))
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
  fs.mkdirSync(path.join(root, '.mew'), { recursive: true })
  fs.mkdirSync(path.join(root, '.agents', 'some-project'), { recursive: true })
  fs.writeFileSync(path.join(root, 'some-project', 'app.ts'), 'export {}\n')
  fs.writeFileSync(path.join(root, 'docs', 'MOC.md'), '# moc\n')
  fs.writeFileSync(path.join(root, '.mew', 'cmd-button.json'), '[]\n')
  fs.writeFileSync(path.join(root, '.agents', 'some-project', 'note.md'), '# note\n')
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n')

  try {
    setWorkspaceRoot(root)
    const all = paths(buildTree(WORKSPACE_PROJECT, { showAll: true })).sort()
    assert.deepEqual(all, ['.agents', '.agents/some-project', '.agents/some-project/note.md', 'AGENTS.md'].sort())
    assert.equal(isPathVisible(WORKSPACE_PROJECT, 'some-project', { type: 'dir', showAll: true }), false)
    // 깊은 곳의 같은 이름은 그냥 폴더다
    assert.equal(isPathVisible(WORKSPACE_PROJECT, '.agents/some-project/note.md', { showAll: true }), true)
  } finally {
    setWorkspaceRoot(original)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
