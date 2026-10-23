import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveWorkspaceLinkAt } from './workspaceLinks.ts'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-workspace-links-'))
const docsRoot = path.join(root, '.mew', 'docs')
const projectRoot = path.join(root, 'app')
fs.mkdirSync(path.join(docsRoot, 'guide'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true })
fs.writeFileSync(path.join(docsRoot, 'guide', 'start.md'), '# 시작')
fs.writeFileSync(path.join(projectRoot, 'src', 'main.ts'), 'export {}')
fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules')

const roots = { workspaceRoot: root, docsRoot, projects: ['app'] }

test('절대경로와 :줄을 프로젝트 상대경로로 바꾼다', () => {
  assert.deepEqual(resolveWorkspaceLinkAt(`${projectRoot}/src/main.ts:42`, roots), {
    project: 'app',
    path: 'src/main.ts',
    line: 42,
  })
})

test('상대경로·#L줄과 docs 특별 경로를 해석한다', () => {
  assert.deepEqual(resolveWorkspaceLinkAt('app/src/main.ts#L7-L9', roots), {
    project: 'app',
    path: 'src/main.ts',
    line: 7,
  })
  assert.deepEqual(resolveWorkspaceLinkAt(`${docsRoot}/guide/start.md`, roots), {
    project: 'docs',
    path: 'guide/start.md',
    line: null,
  })
})

test('워크스페이스 루트 파일은 홈 스코프로 열고 바깥·URL·없는 파일은 거부한다', () => {
  assert.deepEqual(resolveWorkspaceLinkAt(`${root}/AGENTS.md:3`, roots), {
    project: '.workspace',
    path: 'AGENTS.md',
    line: 3,
  })
  assert.equal(resolveWorkspaceLinkAt('https://example.com/file.ts', roots), null)
  assert.equal(resolveWorkspaceLinkAt('/tmp/outside.ts:1', roots), null)
  assert.equal(resolveWorkspaceLinkAt('app/src/missing.ts:1', roots), null)
})
