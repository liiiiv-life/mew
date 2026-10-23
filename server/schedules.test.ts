// 예약 작업 검증과 crontab 생성 — 실제 crontab은 건드리지 않고 순수 함수만 확인한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ScheduleError, buildCommand, jobSessionName, mergeCrontab, normalizeJobs, otherLines } from './schedules.ts'
import { runScheduledPrompt } from './runAgentJob.ts'

const base = { id: '11111111-2222-4333-8444-555555555555', name: '야간 정리', cron: '0 2 * * *', project: '', agent: 'claude', prompt: '문서 정리해줘', enabled: true }
const preset = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: '문서 검토', runtime: 'codex', modelId: 'chosen-model', role: "검토 역할\n따옴표 '와 100%" }

test('셋 스냅샷·프롬프트 파일을 동기화하고 삭제 시 함께 정리한다', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-schedule-files-'))
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { writeJobs, readJobs, agentSetFile, promptFile } from ${JSON.stringify(new URL('./schedules.ts', import.meta.url).href)};
      const job = ${JSON.stringify({ ...base, agent: preset.runtime, agentSet: preset })};
      writeJobs([job]);
      assert.deepEqual(readJobs(), [job]);
      assert.deepEqual(JSON.parse(fs.readFileSync(agentSetFile(job.id), 'utf8')), job.agentSet);
      assert.equal(fs.readFileSync(promptFile(job.id), 'utf8'), job.prompt + '\\n');
      writeJobs([]);
      assert.equal(fs.existsSync(agentSetFile(job.id)), false);
      assert.equal(fs.existsSync(promptFile(job.id)), false);
      assert.deepEqual(readJobs(), []);
    `], { env: { ...process.env, MEW_DATA_DIR: directory }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('예약 저장은 서버의 에이전트셋으로 런타임·모델·역할을 고정한다', () => {
  const [job] = normalizeJobs([{ ...base, agentSetId: preset.id, agentSet: { ...preset, role: 'forged' } }], { sets: [preset], existing: [] })
  assert.equal(job.agent, 'codex')
  assert.deepEqual(job.agentSet, preset)
  assert.notEqual(job.agentSet, preset)
  assert.deepEqual(normalizeJobs([job])[0], job, '저장한 스냅샷을 다시 읽는다')
  const command = buildCommand(job)
  assert.ok(command.includes(`${job.id}.agent-set.json`))
  assert.ok(!command.includes(preset.role), '역할은 셸 명령에 넣지 않는다')
  const [retained] = normalizeJobs([{ ...job, agentSetId: preset.id }], { sets: [], existing: [job] })
  assert.deepEqual(retained.agentSet, preset, '셋이 삭제돼도 기존 예약을 보존한다')
  const [updated] = normalizeJobs([{ ...job, agentSetId: preset.id }], { sets: [{ ...preset, modelId: 'updated' }], existing: [job] })
  assert.equal(updated.agentSet?.modelId, 'updated', '다시 저장하면 현재 셋을 적용한다')
})

test('새 예약은 셋이 필수이며 이전 런타임 예약만 그대로 저장할 수 있다', () => {
  assert.throws(() => normalizeJobs([base], { sets: [preset], existing: [] }), ScheduleError)
  assert.deepEqual(normalizeJobs([base], { sets: [], existing: [base] }), [base])
  assert.throws(() => normalizeJobs([{ ...base, agent: 'codex' }], { sets: [], existing: [base] }), ScheduleError)
  assert.throws(() => normalizeJobs([{ ...base, agentSetId: 'missing' }], { sets: [], existing: [base] }), ScheduleError)
})

test('예약 실행은 모델 적용 뒤 역할과 프롬프트를 전달하고 모델 실패 시 실행하지 않는다', async () => {
  const calls: string[] = []
  const session = {
    setModel: async (model: string) => { calls.push(`model:${model}`) },
    runOnce: async (prompt: string) => { calls.push(prompt); return 'end_turn' },
  }
  await runScheduledPrompt(session, base.prompt, preset)
  assert.deepEqual(calls, [`model:${preset.modelId}`, `${preset.role}\n\n---\n\n${base.prompt}`])
  calls.length = 0
  await runScheduledPrompt(session, base.prompt, { ...preset, modelId: '' })
  assert.deepEqual(calls, [`${preset.role}\n\n---\n\n${base.prompt}`])
  calls.length = 0
  await runScheduledPrompt(session, base.prompt)
  assert.deepEqual(calls, [base.prompt])
  calls.length = 0
  await assert.rejects(runScheduledPrompt({ ...session, setModel: async () => { throw new Error('model unavailable') } }, base.prompt, preset), /model unavailable/)
  assert.deepEqual(calls, [])
})

test('정상 입력은 그대로 통과한다', () => {
  const [job] = normalizeJobs([base])
  assert.equal(job.id, base.id)
  assert.equal(job.agent, 'claude')
  assert.equal(job.enabled, true)

  const [codex] = normalizeJobs([{ ...base, agent: 'codex' }])
  assert.equal(codex.agent, 'codex')
})

test('크론 필드에 셸 메타문자가 들어오면 거부한다', () => {
  for (const cron of ['0 2 * * * ; rm -rf /', '0 2 * *', '0 2 * * $(whoami)', '']) {
    assert.throws(() => normalizeJobs([{ ...base, cron }]), ScheduleError)
  }
})

test('알 수 없는 에이전트·빈 프롬프트는 거부한다', () => {
  assert.throws(() => normalizeJobs([{ ...base, agent: 'bash' }]), ScheduleError)
  assert.throws(() => normalizeJobs([{ ...base, prompt: '   ' }]), ScheduleError)
})

test('명령에는 프롬프트 본문이 아니라 프롬프트 파일 경로가 들어간다', () => {
  const [job] = normalizeJobs([{ ...base, prompt: "따옴표'와 % 기호" }])
  const cmd = buildCommand(job)
  assert.ok(cmd.includes(`${job.id}.prompt`))
  assert.ok(cmd.includes('runAgentJob.ts'))
  assert.ok(cmd.includes("--runtime '\\''claude'\\''") || cmd.includes("--runtime 'claude'"))
  assert.ok(!cmd.includes('따옴표'))
  assert.ok(!/(^|[^\\])%/.test(cmd), `크론 %가 escape되지 않음: ${cmd}`)
})

test('크론 줄은 잡 전용 tmux 세션을 설정한 폴더에서 띄우고 명령을 타이핑한다', () => {
  const [job] = normalizeJobs([base])
  const session = jobSessionName(job.id)
  const cmd = buildCommand(job)

  assert.ok(session.startsWith('mewcmd-'), `터미널 탭에서 숨겨지는 이름이 아님: ${session}`)
  assert.ok(/^[a-zA-Z0-9_-]{1,50}$/.test(session), `tmux 세션 이름 규칙 위반: ${session}`)
  assert.ok(cmd.includes(`new-session -d -s ${session} -c `), cmd)
  assert.ok(cmd.includes(`send-keys -t ${session} -l `), cmd)
  assert.ok(cmd.endsWith(`send-keys -t ${session} Enter`), cmd)
})

test('손으로 쓴 크론 줄은 보존하고 mew 줄만 교체한다', () => {
  const existing = '# 손으로 쓴 것\n0 5 * * * /usr/bin/backup.sh\n0 9 * * * old >> x 2>&1 # mew-job:11111111-2222-4333-8444-555555555555 옛 이름\n'
  const jobs = normalizeJobs([{ ...base, cron: '30 3 * * 1' }])
  const merged = mergeCrontab(existing, jobs)

  assert.ok(merged.includes('/usr/bin/backup.sh'))
  assert.ok(merged.includes('# 손으로 쓴 것'))
  assert.equal(merged.split('\n').filter((l) => l.includes('# mew-job:')).length, 1)
  assert.ok(merged.startsWith('# 손으로 쓴 것\n0 5 * * * /usr/bin/backup.sh\n30 3 * * 1 '))
  assert.equal(otherLines(merged).filter((l) => l.trim()).length, 2)
})

test('꺼진 작업은 crontab에 나가지 않는다', () => {
  const jobs = normalizeJobs([{ ...base, enabled: false }])
  assert.equal(mergeCrontab('', jobs), '')
})


test('예약 프롬프트 전에 모델과 노력도를 순서대로 적용한다', async () => {
  const calls: string[] = []
  await runScheduledPrompt({
    setModel: async id => { calls.push(id) },
    setThinking: async (configId, id) => { calls.push(`${configId}:${id}`) },
    runOnce: async () => { calls.push('prompt'); return 'end_turn' },
  }, 'review', { ...preset, runtime: 'claude', thinkingConfigId: 'effort', thinkingId: 'high' })
  assert.deepEqual(calls, ['chosen-model', 'effort:high', 'prompt'])
})
