import { agentSettingsAccount, runWithAgentAccount } from './agent-account-settings.ts'
// 에이전트 탭에 한 번만 보내는 예약 프롬프트. 브라우저 탭과 감독 프로세스가 모두 꺼져도
// 실행되어야 하므로, 목록은 DATA_DIR에 저장하고 서버 시작 때 다시 타이머를 건다.
import crypto from 'node:crypto'
import path from 'node:path'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import { composeRuntimePrompt, RUNTIMES } from './agentRuntimes.ts'
import { listSkills } from './skills.ts'

const FILE = path.join(DATA_DIR, 'agent-scheduled-prompts.json')
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const MAX_PROMPT = 100_000

export type AgentScheduledPrompt = { account?: string | null; id: string; runtime: string; tab: string; cwd: string; sessionId: string; text: string; skills: string[]; at: string; createdAt: string }
export class AgentScheduledPromptError extends Error {}
type AgentScheduledPromptScope = Pick<AgentScheduledPrompt, 'runtime' | 'tab' | 'cwd'>

function read(): AgentScheduledPrompt[] {
  const saved = readJsonFile<unknown>(FILE)
  if (saved === null) return []
  if (!Array.isArray(saved)) throw new AgentScheduledPromptError('예약 전송 목록 형식이 올바르지 않습니다')
  return saved.filter((item): item is AgentScheduledPrompt => {
    const job = item as Partial<AgentScheduledPrompt>
    return typeof job?.id === 'string' && typeof job.runtime === 'string' && typeof job.tab === 'string' && typeof job.cwd === 'string'
      && typeof job.sessionId === 'string' && typeof job.text === 'string' && Array.isArray(job.skills) && typeof job.at === 'string' && typeof job.createdAt === 'string'
  })
}
function belongsToAccount(job: AgentScheduledPrompt): boolean {
  return job.account === undefined || job.account === agentSettingsAccount()
}
function write(jobs: AgentScheduledPrompt[]) { writeFileAtomic(FILE, JSON.stringify(jobs, null, 2)) }

function validate(input: unknown): Omit<AgentScheduledPrompt, 'id' | 'createdAt'> {
  if (!input || typeof input !== 'object') throw new AgentScheduledPromptError('예약 전송 내용이 올바르지 않습니다')
  const value = input as Record<string, unknown>
  const runtime = typeof value.runtime === 'string' ? value.runtime : ''
  const tab = typeof value.tab === 'string' ? value.tab : ''
  const cwd = typeof value.cwd === 'string' ? value.cwd : ''
  const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const when = new Date(typeof value.at === 'string' ? value.at : '')
  const skills = Array.isArray(value.skills) ? value.skills.filter((name): name is string => typeof name === 'string') : []
  if (RUNTIMES[runtime]?.surface !== 'acp' || !TAB_ID.test(tab) || !path.isAbsolute(cwd) || !SESSION_ID.test(sessionId)) throw new AgentScheduledPromptError('예약할 에이전트 세션이 올바르지 않습니다')
  if (!text || text.length > MAX_PROMPT) throw new AgentScheduledPromptError('예약할 메시지를 입력하세요')
  if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) throw new AgentScheduledPromptError('미래의 날짜와 시간을 고르세요')
  return { runtime, tab, cwd, sessionId, text, skills: [...new Set(skills)], at: when.toISOString() }
}

function validateScope(input: unknown): AgentScheduledPromptScope {
  if (!input || typeof input !== 'object') throw new AgentScheduledPromptError('예약 메시지 범위가 올바르지 않습니다')
  const value = input as Record<string, unknown>
  const runtime = typeof value.runtime === 'string' ? value.runtime : ''
  const tab = typeof value.tab === 'string' ? value.tab : ''
  const cwd = typeof value.cwd === 'string' ? value.cwd : ''
  if (RUNTIMES[runtime]?.surface !== 'acp' || !TAB_ID.test(tab) || !path.isAbsolute(cwd)) throw new AgentScheduledPromptError('예약 메시지 범위가 올바르지 않습니다')
  return { runtime, tab, cwd }
}

let timer: NodeJS.Timeout | null = null
let running = false
function arm() {
  if (timer) clearTimeout(timer)
  const next = read().sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]
  if (!next) return
  timer = setTimeout(() => void runDue(), Math.max(0, Date.parse(next.at) - Date.now()))
  timer.unref?.()
}
async function dispatch(job: AgentScheduledPrompt) {
  const { connectAgentHost } = await import('./agentHost.ts')
  const client = await connectAgentHost(job.runtime, job.tab, job.cwd, {}, job.sessionId)
  try {
    const wanted = new Set(job.skills)
    const promptText = wanted.size ? composeRuntimePrompt(job.runtime, job.text, listSkills(job.cwd, job.runtime).filter((skill) => wanted.has(skill.name))) : job.text
    // prompt()는 실행 중인 세션에 자동으로 큐잉한다. 새 감독은 resume 힌트로 원 세션을 먼저 load한다.
    client.send({ type: 'prompt', text: job.text, promptText, automatic: true })
  } finally { client.close() }
}
async function runDue() {
  if (running) return
  running = true
  try {
    const jobs = read(); const due = jobs.filter((job) => Date.parse(job.at) <= Date.now())
    const keep = jobs.filter((job) => !due.includes(job))
    for (const job of due) {
      try {
        await runWithAgentAccount(job.account ?? null, () => dispatch(job))
      } catch (err) {
        // 서버가 막 재시작했거나 런타임이 잠깐 준비 중이어도 예약을 잃지 않는다.
        console.error('[mew:agent-schedule] 실행 실패:', err)
        keep.push({ ...job, at: new Date(Date.now() + 60_000).toISOString() })
      }
    }
    if (due.length) write(keep)
  } finally { running = false; arm() }
}
export function scheduleAgentPrompt(input: unknown): AgentScheduledPrompt {
  const job = { ...validate(input), account: agentSettingsAccount(), id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  const jobs = read(); jobs.push(job); write(jobs); arm(); return job
}

/** 현재 에이전트 탭의 아직 실행되지 않은 메시지만 시간순으로 돌려준다. */
export function listAgentScheduledPrompts(input: unknown): AgentScheduledPrompt[] {
  const scope = validateScope(input)
  return read()
    .filter((job) => belongsToAccount(job) && job.runtime === scope.runtime && job.tab === scope.tab && job.cwd === scope.cwd)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** 같은 탭·런타임·작업 경로에 속한 예약만 취소할 수 있다. */
export function cancelAgentScheduledPrompt(input: unknown): boolean {
  if (!input || typeof input !== 'object') throw new AgentScheduledPromptError('예약 메시지를 찾을 수 없습니다')
  const value = input as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id : ''
  if (!id) throw new AgentScheduledPromptError('예약 메시지를 찾을 수 없습니다')
  const scope = validateScope(value)
  const jobs = read()
  const keep = jobs.filter((job) => !(job.id === id && belongsToAccount(job) && job.runtime === scope.runtime && job.tab === scope.tab && job.cwd === scope.cwd))
  if (keep.length === jobs.length) return false
  write(keep)
  arm()
  return true
}

/** 아직 실행되지 않은 같은 탭의 예약 메시지 내용과 시각을 바꾼다. */
export function updateAgentScheduledPrompt(input: unknown): AgentScheduledPrompt {
  if (!input || typeof input !== 'object') throw new AgentScheduledPromptError('예약 메시지를 찾을 수 없습니다')
  const value = input as Record<string, unknown>
  const id = typeof value.id === 'string' ? value.id : ''
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const at = new Date(typeof value.at === 'string' ? value.at : '')
  const skills = Array.isArray(value.skills) ? value.skills.filter((name): name is string => typeof name === 'string') : []
  if (!id || !text || text.length > MAX_PROMPT) throw new AgentScheduledPromptError('예약할 메시지를 입력하세요')
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) throw new AgentScheduledPromptError('미래의 날짜와 시간을 고르세요')
  const scope = validateScope(value)
  const jobs = read()
  const index = jobs.findIndex((job) => job.id === id && belongsToAccount(job) && job.runtime === scope.runtime && job.tab === scope.tab && job.cwd === scope.cwd)
  if (index < 0) throw new AgentScheduledPromptError('예약 메시지를 찾을 수 없습니다')
  const job = { ...jobs[index], account: jobs[index].account ?? agentSettingsAccount(), text, skills: [...new Set(skills)], at: at.toISOString() }
  jobs[index] = job
  write(jobs)
  arm()
  return job
}
export function startAgentScheduledPrompts() { arm() }
