// 예약 작업 검증과 crontab 생성 — 실제 crontab은 건드리지 않고 순수 함수만 확인한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ScheduleError, buildCommand, jobSessionName, mergeCrontab, normalizeJobs, otherLines } from './schedules.ts'

const base = { id: '11111111-2222-4333-8444-555555555555', name: '야간 정리', cron: '0 2 * * *', project: '', agent: 'claude', prompt: '문서 정리해줘', enabled: true }

test('정상 입력은 그대로 통과한다', () => {
  const [job] = normalizeJobs([base])
  assert.equal(job.id, base.id)
  assert.equal(job.agent, 'claude')
  assert.equal(job.enabled, true)
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
