import { agentSettingsAccount } from './agent-account-settings.ts'
// 예약 에이전트 작업 — "언제 / 어느 폴더에서 / 어떤 에이전트로 / 어떤 프롬프트를" 돌릴지의 목록.
// 저장소는 <DATA_DIR>/schedules.json 이 단일 원본이고, crontab은 거기서 생성되는 파생물이다.
// 프롬프트는 셸에 인라인하지 않고 <DATA_DIR>/schedules/<id>.prompt 파일로 떨어뜨린 뒤 명령이 읽어간다
// — 따옴표·개행·크론의 %(=stdin 구분자) 같은 escape 지뢰를 통째로 피하려는 것.
//
// 실행은 잡 전용 tmux 세션 안에서 이뤄진다(명령어 버튼과 같은 구조) — 크론 줄이 하는 일은
// "세션을 설정한 폴더에서 띄우고, 에이전트 명령을 그 셸에 타이핑한다"뿐이다. 덕분에 무인 실행이
// 끝난 뒤에도 화면이 세션에 남아 있어 예약 작업 창의 터미널 아이콘으로 그대로 들여다볼 수 있다.
import fs from 'node:fs'
import { captureAgentContext } from './agent-context.ts'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { COMMAND_SESSION_PREFIX } from '@mew/tmux-term/server'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import { WORKSPACE_ROOT, projectRoot } from './paths.ts'
import { readCrontab, writeCrontab } from './crontab.ts'
import { isAcpRuntime } from './agentRuntimes.ts'
import { normalizeSets, readSets, type AgentSet } from './agentSets.ts'

export type AgentKind = string

export interface AgentJob {
  account?: string | null
  id: string
  name: string
  /** 표준 크론 5필드 — 분 시 일 월 요일 */
  cron: string
  /** 실행 폴더. 빈 문자열이면 워크스페이스 루트 */
  project: string
  agent: AgentKind
  /** 저장 시점의 에이전트셋 스냅샷. 이전 런타임 전용 예약에는 없다. */
  agentSet?: AgentSet
  prompt: string
  enabled: boolean
}

export interface AgentJobView extends AgentJob {
  /** crontab에 실제로 들어가는(또는 들어갈) 줄 — UI에서 그대로 보여준다 */
  command: string
  /** 로그 파일 수정 시각(=마지막 실행). 아직 한 번도 안 돌았으면 null */
  lastRun: string | null
  /** 이 잡 전용 tmux 세션 이름 — 터미널 창으로 열어 볼 때 쓴다 */
  session: string
  /** 그 세션이 지금 떠 있는지 */
  running: boolean
}

export class ScheduleError extends Error {}

const JOBS_FILE = path.join(DATA_DIR, 'schedules.json')
const JOBS_DIR = path.join(DATA_DIR, 'schedules')
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runAgentJob.ts')
const MARKER = '# mew-job:'
const MAX_JOBS = 50
const MAX_NAME_LEN = 80
const MAX_PROMPT_LEN = 8000
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// 크론 필드에 허용하는 글자 — 셸 메타문자를 원천 차단해서 crontab 주입을 막는다
const CRON_FIELD_RE = /^[A-Za-z0-9*/,-]+$/

function shQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

const binCache = new Map<string, string>()

/** cron은 PATH가 빈약해서 이름만 쓰면 못 찾는다 — 저장 시점에 절대 경로로 굳혀 둔다. */
function resolveBin(bin: string): string {
  const cached = binCache.get(bin)
  if (cached) return cached
  let resolved = bin
  try {
    resolved = execFileSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf-8' }).trim() || bin
  } catch {
    /* 설치돼 있지 않으면 이름 그대로 — 실행 시점에 로그로 드러난다 */
  }
  binCache.set(bin, resolved)
  return resolved
}

export const promptFile = (id: string) => path.join(JOBS_DIR, `${id}.prompt`)
export const logFile = (id: string) => path.join(JOBS_DIR, `${id}.log`)
export const agentSetFile = (id: string) => path.join(JOBS_DIR, `${id}.agent-set.json`)

/**
 * 잡 전용 tmux 세션 이름. 명령어 버튼과 같은 프리픽스라 터미널 탭 목록에서는 걸러져 보이지 않고
 * (예약 작업 창의 터미널 아이콘으로만 연다), 세션 이름 규칙([a-zA-Z0-9_-], 50자 이하)도 만족한다.
 */
export const jobSessionName = (id: string) => `${COMMAND_SESSION_PREFIX}job-${id.slice(0, 8)}`

/** 잡이 도는 폴더. 빈 프로젝트명이면 워크스페이스 루트 */
export function jobCwd(project: string): string {
  return project === '' ? WORKSPACE_ROOT : projectRoot(project)
}

/**
 * 세션 셸에 실제로 타이핑되는 한 줄 — 프롬프트는 파일에서 읽고, 출력은 화면에 남기면서
 * 동시에 잡별 로그에 덧붙인다(그 파일의 mtime이 "마지막 실행"이다).
 * 크론과 "지금 실행" 버튼이 같은 문자열을 쓴다.
 */
export function agentCommand(job: AgentJob): string {
  return [
    shQuote(resolveBin(process.execPath)),
    shQuote(RUNNER),
    ...(job.account ? ['--account', shQuote(job.account)] : []),
    '--runtime',
    shQuote(job.agent),
    ...(job.agentSet ? ['--agent-set-file', shQuote(agentSetFile(job.id))] : []),
    '--prompt-file',
    shQuote(promptFile(job.id)),
    '--log-file',
    shQuote(logFile(job.id)),
    '--cwd',
    shQuote(jobCwd(job.project)),
    '--context',
    shQuote(JSON.stringify(captureAgentContext(jobCwd(job.project)))),
  ].join(' ')
}

/**
 * 크론 줄의 명령 부분 — 잡 전용 세션을 설정한 폴더에서 띄우고 에이전트 명령을 타이핑한다.
 * 세션이 이미 있으면 new-session이 실패하고(2>/dev/null) 그 세션을 그대로 재사용한다.
 */
export function buildCommand(job: AgentJob): string {
  const tmux = shQuote(resolveBin('tmux'))
  const session = jobSessionName(job.id)
  const cmd = [
    `${tmux} new-session -d -s ${session} -c ${shQuote(jobCwd(job.project))} 2>/dev/null`,
    `${tmux} send-keys -t ${session} -l ${shQuote(agentCommand(job))}`,
    `${tmux} send-keys -t ${session} Enter`,
  ].join('; ')
  // crontab에서 %는 개행/stdin 구분자다 — 명령 안에 살아 있으면 줄이 잘린다
  return cmd.replaceAll('%', '\\%')
}

function jobLine(job: AgentJob): string {
  const label = job.name.replace(/[\r\n%]/g, ' ').trim()
  return `${job.cron} ${buildCommand(job)} ${MARKER}${job.id}${label ? ` ${label}` : ''}`
}

/** mew가 관리하지 않는 줄 — 손으로 쓴 크론 줄은 건드리지 않고 그대로 보존한다. */
export function otherLines(crontabText: string): string[] {
  return crontabText.split('\n').filter((line) => !line.includes(MARKER))
}

/** 기존 crontab에서 mew 줄만 걷어내고 현재 잡 목록으로 다시 채운다(순수 함수 — 테스트용). */
export function mergeCrontab(crontabText: string, jobs: AgentJob[]): string {
  const kept = otherLines(crontabText)
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
  const generated = jobs.filter((j) => j.enabled).map(jobLine)
  const all = generated.length > 0 ? [...kept, ...generated] : kept
  return all.length > 0 ? `${all.join('\n')}\n` : ''
}

/** 클라이언트가 보낸 목록을 검증·정규화한다. 통과 못 하면 ScheduleError(=400). */
export function normalizeJobs(input: unknown, selection?: { sets: AgentSet[]; existing: AgentJob[] }): AgentJob[] {
  if (!Array.isArray(input)) throw new ScheduleError('작업 목록이 배열이 아닙니다')
  if (input.length > MAX_JOBS) throw new ScheduleError(`예약 작업은 최대 ${MAX_JOBS}개까지입니다`)
  const out: AgentJob[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (!item || typeof item !== 'object') throw new ScheduleError('작업 형식이 올바르지 않습니다')
    const rec = item as Record<string, unknown>

    const id = typeof rec.id === 'string' && ID_RE.test(rec.id) ? rec.id : crypto.randomUUID()
    if (seen.has(id)) throw new ScheduleError('작업 id가 중복됩니다')
    seen.add(id)

    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (name.length > MAX_NAME_LEN) throw new ScheduleError(`이름은 ${MAX_NAME_LEN}자 이하여야 합니다`)

    const cron = typeof rec.cron === 'string' ? rec.cron.trim().replace(/\s+/g, ' ') : ''
    const fields = cron.split(' ')
    if (fields.length !== 5 || !fields.every((f) => CRON_FIELD_RE.test(f))) {
      throw new ScheduleError(`실행 주기가 올바르지 않습니다: ${cron || '(비어 있음)'}`)
    }

    let agentSet: AgentSet | undefined
    let agent = typeof rec.agent === 'string' ? rec.agent : ''
    if (selection) {
      const previous = selection.existing.find((job) => job.id === id)
      if (typeof rec.agentSetId === 'string' && rec.agentSetId) {
        const selected = selection.sets.find((set) => set.id === rec.agentSetId)
          ?? (previous?.agentSet?.id === rec.agentSetId ? previous.agentSet : undefined)
        if (!selected) throw new ScheduleError('에이전트셋을 찾을 수 없습니다')
        agentSet = { ...selected }
        agent = agentSet.runtime
      } else if (!previous || previous.agentSet || previous.agent !== agent) {
        throw new ScheduleError('에이전트셋을 선택하세요')
      }
    } else if (rec.agentSet !== undefined) {
      try { [agentSet] = normalizeSets([rec.agentSet]) } catch { throw new ScheduleError('에이전트셋 형식이 올바르지 않습니다') }
      if (!agentSet) throw new ScheduleError('에이전트셋 형식이 올바르지 않습니다')
      agent = agentSet.runtime
    }
    if (!isAcpRuntime(agent)) throw new ScheduleError('예약 실행을 지원하는 에이전트를 고르세요')

    const project = typeof rec.project === 'string' ? rec.project : ''
    if (project !== '') projectRoot(project) // 없는 프로젝트면 여기서 던진다

    const prompt = typeof rec.prompt === 'string' ? rec.prompt.trim() : ''
    if (!prompt) throw new ScheduleError('프롬프트를 입력하세요')
    if (prompt.length > MAX_PROMPT_LEN) throw new ScheduleError(`프롬프트는 ${MAX_PROMPT_LEN}자 이하여야 합니다`)

    const account = selection
      ? selection.existing.find(job => job.id === id)?.account ?? agentSettingsAccount()
      : typeof rec.account === 'string' ? rec.account : null
    out.push({ id, name, cron, project, agent, ...(account ? { account } : {}), ...(agentSet ? { agentSet } : {}), prompt, enabled: rec.enabled !== false })
  }
  return out
}

export function readJobs(): AgentJob[] {
  const parsed = readJsonFile<unknown>(JOBS_FILE)
  if (parsed === null) return []
  try {
    return normalizeJobs(parsed)
  } catch {
    return [] // 저장 파일이 스키마와 어긋나면 빈 목록 — 저장 시 통째로 다시 쓰인다
  }
}

function statLastRun(id: string): string | null {
  try {
    return fs.statSync(logFile(id)).mtime.toISOString()
  } catch {
    return null
  }
}

/** running 판정에 필요한 tmux 세션 목록은 호출부(api.ts)가 넘긴다 — 여기서 tmux를 부르지 않는다. */
export function jobViews(jobs: AgentJob[], liveSessions: Set<string> = new Set()): AgentJobView[] {
  return jobs.map((job) => {
    const session = jobSessionName(job.id)
    return { ...job, command: jobLine(job), lastRun: statLastRun(job.id), session, running: liveSessions.has(session) }
  })
}

/** 잡 목록을 통째로 교체한다 — 프롬프트 파일 동기화 + crontab 재생성까지 한 세트. */
export function writeJobs(jobs: AgentJob[]): void {
  fs.mkdirSync(JOBS_DIR, { recursive: true, mode: 0o700 })

  // 사라진 잡의 프롬프트·로그는 남겨두지 않는다
  const live = new Set(jobs.map((j) => j.id))
  for (const entry of fs.readdirSync(JOBS_DIR)) {
    const id = entry.replace(/\.(prompt|log|agent-set\.json)$/, '')
    if (id !== entry && !live.has(id)) fs.rmSync(path.join(JOBS_DIR, entry), { force: true })
  }

  for (const job of jobs) {
    const body = job.prompt.endsWith('\n') ? job.prompt : `${job.prompt}\n`
    writeFileAtomic(promptFile(job.id), body)
    if (job.agentSet) writeFileAtomic(agentSetFile(job.id), `${JSON.stringify(job.agentSet)}\n`)
    else fs.rmSync(agentSetFile(job.id), { force: true })
  }
  writeFileAtomic(JOBS_FILE, `${JSON.stringify(jobs, null, 2)}\n`)
}

export async function saveSchedules(input: unknown): Promise<AgentJob[]> {
  const jobs = normalizeJobs(input, { sets: readSets(), existing: readJobs() })
  writeJobs(jobs)
  await writeCrontab(mergeCrontab(await readCrontab(), jobs))
  return jobs
}
