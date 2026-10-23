// 런타임 설정 저장 — 병합 저장(보낸 키만 갈아끼움)과 마스킹 검증
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'

const settingsData = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-settings-test-'))
process.env.MEW_DATA_DIR = settingsData
const {
  describeAgentSetting,
  normalizeAgentSetting,
  writeAgentSetting,
  deleteAgentSetting,
  purgeForbiddenAgentEnv,
  readAgentSetting,
} = await import('./agentSettings.ts')
test.after(() => fs.rmSync(settingsData, { recursive: true, force: true }))

test('normalize는 빈 값을 걷어내고 형식을 지킨다', () => {
  const value = normalizeAgentSetting({ cmd: '', extraArgs: ['', '--flag'], env: { A: 'x', B: '' } })
  assert.deepEqual(value, { extraArgs: ['--flag'], env: { A: 'x' } })
})

test('env 키 이름은 식별자만 허용한다', () => {
  assert.throws(() => normalizeAgentSetting({ env: { 'BAD KEY': 'v' } }))
  assert.doesNotThrow(() => normalizeAgentSetting({ env: { ANTHROPIC_API_KEY: 'sk' } }))
  assert.throws(() => normalizeAgentSetting({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'oauth' } }))
})

test('기존 Claude OAuth token은 서버 시작 전 정리해 spawn에 쓰이지 않게 한다', () => {
  writeAgentSetting('claude', { env: { ANTHROPIC_API_KEY: 'sk-secret' } })
  // 이전 버전이 남긴 파일을 직접 흉내 낸다. 정상 API로는 이 키를 다시 저장할 수 없다.
  const dataDir = process.env.MEW_DATA_DIR!
  const file = path.join(dataDir, 'agent-settings.json')
  const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { env?: Record<string, string> }>
  stored.claude.env!.CLAUDE_CODE_OAUTH_TOKEN = 'legacy-oauth'
  fs.writeFileSync(file, JSON.stringify(stored))
  assert.equal(purgeForbiddenAgentEnv(), true)
  assert.equal(readAgentSetting('claude')?.env?.CLAUDE_CODE_OAUTH_TOKEN, undefined)
  assert.equal(readAgentSetting('claude')?.env?.ANTHROPIC_API_KEY, 'sk-secret')
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
  writeAgentSetting('antigravity', { env: { GOOGLE_CLOUD_PROJECT: 'project' } })
  deleteAgentSetting('antigravity')
  assert.equal(describeAgentSetting('antigravity'), null)
})
