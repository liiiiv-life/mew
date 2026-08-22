// 런타임 설정 저장 — 병합 저장(보낸 키만 갈아끼움)과 마스킹 검증
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeAgentSetting,
  normalizeAgentSetting,
  writeAgentSetting,
  deleteAgentSetting,
} from './agentSettings.ts'

test('normalize는 빈 값을 걷어내고 형식을 지킨다', () => {
  const value = normalizeAgentSetting({ cmd: '', extraArgs: ['', '--flag'], env: { A: 'x', B: '' } })
  assert.deepEqual(value, { extraArgs: ['--flag'], env: { A: 'x' } })
})

test('env 키 이름은 식별자만 허용한다', () => {
  assert.throws(() => normalizeAgentSetting({ env: { 'BAD KEY': 'v' } }))
  assert.doesNotThrow(() => normalizeAgentSetting({ env: { ANTHROPIC_API_KEY: 'sk' } }))
})

test('저장은 병합이다 — 보낸 키만 바뀌고 나머지 env는 유지된다', () => {
  writeAgentSetting('claude', { env: { ANTHROPIC_API_KEY: 'sk-secret-9999', OPENAI_API_KEY: 'o-1234' } })
  // 시크릿 원문 없이 다른 키만 고친다 — 기존 ANTHROPIC_API_KEY가 살아 있어야 한다
  writeAgentSetting('claude', { env: { PRIME_API_KEY: 'p-key' } })
  const setting = describeAgentSetting('claude')
  assert.ok(setting?.env)
  assert.equal(setting.env.OPENAI_API_KEY, '****1234')
  assert.equal(setting.env.ANTHROPIC_API_KEY, '****9999')
  assert.equal(setting.env.PRIME_API_KEY, '****-key')
})

test('cmd·extraArgs는 명시하면 교체하고 안 하면 유지한다', () => {
  writeAgentSetting('kimi', { cmd: '/opt/kimi/bin/kimi', extraArgs: ['--debug'] })
  writeAgentSetting('kimi', { env: { EXTRA: '1' } })
  const setting = describeAgentSetting('kimi')
  assert.equal(setting?.cmd, '/opt/kimi/bin/kimi')
  assert.deepEqual(setting?.extraArgs, ['--debug'])
  // 이번엔 cmd만 고친다
  writeAgentSetting('kimi', { cmd: '/new/path/kimi' })
  assert.equal(describeAgentSetting('kimi')?.cmd, '/new/path/kimi')
  assert.deepEqual(describeAgentSetting('kimi')?.extraArgs, ['--debug'])
})

test('삭제하면 항목이 사라진다', () => {
  writeAgentSetting('gemini', { env: { GEMINI_API_KEY: 'g-key' } })
  deleteAgentSetting('gemini')
  assert.equal(describeAgentSetting('gemini'), null)
})
