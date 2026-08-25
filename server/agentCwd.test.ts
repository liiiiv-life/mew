import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AgentCwdError, resolveAgentCwd, suggestAgentCwds } from './agentCwd.ts'

test('에이전트 cwd는 워크스페이스 밖 절대경로와 현재 cwd 기준 상대경로를 받는다', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-cwd-'))
  const workspace = path.join(root, 'workspace')
  const outside = path.join(root, 'outside')
  fs.mkdirSync(workspace)
  fs.mkdirSync(outside)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  assert.equal(resolveAgentCwd('', workspace), workspace)
  assert.equal(resolveAgentCwd(outside, workspace), outside)
  assert.equal(resolveAgentCwd('../outside', workspace, workspace), outside)
})

test('에이전트 cwd는 없는 폴더와 파일을 거부한다', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-cwd-invalid-'))
  const file = path.join(root, 'file.txt')
  fs.writeFileSync(file, 'x')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  assert.throws(() => resolveAgentCwd(path.join(root, 'missing'), root), AgentCwdError)
  assert.throws(() => resolveAgentCwd(file, root), AgentCwdError)
})

test('주소창은 마지막 경로 조각을 접두어로 거르고, 들어간 뒤에는 하위 폴더를 보여준다', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-agent-cwd-suggest-'))
  fs.mkdirSync(path.join(root, 'home', 'saens'), { recursive: true })
  fs.mkdirSync(path.join(root, 'host'))
  fs.mkdirSync(path.join(root, 'var'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  assert.deepEqual(
    suggestAgentCwds(path.join(root, 'ho'), root).dirs.map((entry) => entry.name),
    ['home', 'host'],
  )
  assert.deepEqual(
    suggestAgentCwds(path.join(root, 'home'), root, root, true).dirs.map((entry) => entry.name),
    ['saens'],
  )
})
