// 에이전트셋 오케스트레이터 — 정의(agentSets.ts)를 실제로 굴리는 쪽.
//
// 셋 하나에 러너 하나, 러너 하나에 ACP 세션 하나다. 에이전트 창(agentWs.ts)과 다른 점은 **창이
// 붙어 있지 않아도 돈다**는 것이다: 브라우저는 진행 상황을 구경할 뿐이고, 큐를 밀고 작업을 닫는
// 주체는 여기다. 그래서 창을 닫아도 시켜 둔 일은 계속 간다.
//
// 세션은 **첫 작업이 들어올 때 뜬다**(지연 시작). 켜 두기만 하고 안 시키면 프로세스가 안 뜬다는 뜻이라,
// 셋을 20개 만들어 두어도 램은 실제로 일하는 만큼만 든다. 10분 동안 아무 일도 없으면 스스로 끈다.
//
// 보안 경계는 에이전트 창과 같다 — 셋도 결국 Bash를 쓰는 에이전트다(agentSetWs.ts가 owner/manager만
// 통과시킨다). 무인으로 도는 표면이라는 점에서는 예약 작업(schedules.ts)과 같은 급이다.
import crypto from 'node:crypto'
import { AgentSession, modelsByRuntime, type AgentEvent, type ModelInfo } from './agentAcp.ts'
import { readSets, ROUTER_ID, ROUTER_ROLE, type AgentSet } from './agentSets.ts'

/** 아무 일도 없이 이만큼 지나면 세션을 끈다(사용자 규칙: 10분) */
const IDLE_KILL_MS = 10 * 60_000

/** 작업 하나가 들고 있을 이벤트 상한 — 넘치면 앞에서 버린다(창은 뒤쪽을 본다) */
const MAX_TASK_EVENTS = 400

/** 셋 하나가 들고 있을 지난 작업 수. ponytail: 메모리에만 산다 — 서버를 재시작하면 이력은 사라진다.
 *  영속이 필요해지면 <DATA_DIR>/agent-sets/<id>.jsonl 로 떨어뜨리는 것이 다음 단계다 */
const MAX_TASKS_PER_SET = 50

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface TaskSummary {
  id: string
  setId: string
  /** 사람이 읽는 제목 = 사용자가 친 프롬프트 원문(역할 머리말은 빼고) */
  prompt: string
  status: TaskStatus
  createdAt: string
  endedAt: string | null
  /** 라우터가 잡은 작업이면 어디로 넘겼는지(셋 이름). 판정 실패면 null */
  routedTo: string | null
  /** 실패 사유 — status가 error일 때만 */
  error: string | null
}

interface Task extends TaskSummary {
  /** 이 작업이 도는 동안의 ACP 이벤트 — 상세 팝업이 이걸 그린다 */
  events: AgentEvent[]
  /** 라우터의 판정 작업인지 — 끝나면 응답을 파싱해 진짜 셋으로 넘긴다 */
  routing: boolean
  /**
   * 에이전트에게 실제로 보내는 글. 보통은 prompt와 같고, 라우터의 판정 작업만 다르다
   * (후보 목록으로 감싼 글이 간다) — 제목은 사용자가 친 원문 그대로여야 하기 때문이다.
   */
  sendText: string
}

export interface SetView extends AgentSet {
  /** 세션이 떠 있는지 = 그리드의 "켜짐" */
  on: boolean
  busy: boolean
  /** 대기 중인 프롬프트 원문 — 창이 순서를 바꾸고 내용을 고친다 */
  queued: string[]
  tasks: TaskSummary[]
}

export type SetServerMessage =
  | { type: 'state'; sets: SetView[]; models: Record<string, ModelInfo[]> }
  | { type: 'task'; task: TaskSummary; events: AgentEvent[] }
  | { type: 'task_events'; taskId: string; events: AgentEvent[] }
  | { type: 'error'; message: string }

const summarize = (task: Task): TaskSummary => ({
  id: task.id,
  setId: task.setId,
  prompt: task.prompt,
  status: task.status,
  createdAt: task.createdAt,
  endedAt: task.endedAt,
  routedTo: task.routedTo,
  error: task.error,
})

// ── 구독 ────────────────────────────────────────────────────────────────────
// 창은 전체 상태를 통째로 받는다(셋 20개 × 작업 50개 요약이라 작다). 잦은 변화는 한 틱에 모아
// 한 번만 보낸다 — 스트리밍 청크마다 상태를 다시 그리면 창이 굳는다.
const listeners = new Set<(msg: SetServerMessage) => void>()
let stateTimer: NodeJS.Timeout | null = null

export function subscribeSets(listener: (msg: SetServerMessage) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(msg: SetServerMessage) {
  for (const listener of listeners) listener(msg)
}

export function pushState() {
  if (stateTimer) return
  stateTimer = setTimeout(() => {
    stateTimer = null
    if (listeners.size > 0) emit({ type: 'state', sets: viewSets(), models: modelsByRuntime() })
  }, 50)
  stateTimer.unref?.()
}

// ── 러너 ────────────────────────────────────────────────────────────────────
class AgentSetRunner {
  set: AgentSet
  #session: AgentSession | null = null
  /** 뜨는 중 — 같은 러너가 세션을 두 개 띄우지 않게 붙잡는다 */
  #starting: Promise<AgentSession> | null = null
  #queue: Task[] = []
  #current: Task | null = null
  #tasks: Task[] = []
  #idleTimer: NodeJS.Timeout | null = null
  #detach: (() => void) | null = null
  /** 이 세션에 역할 머리말을 이미 붙였는지 — 첫 프롬프트에만 붙인다 */
  #rolePrimed = false

  constructor(set: AgentSet) {
    this.set = set
  }

  get on(): boolean {
    return this.#session !== null || this.#starting !== null
  }

  get busy(): boolean {
    return this.#current !== null
  }

  view(): SetView {
    // 목록 순서는 "지금 도는 것 → 줄 서 있는 것 → 끝난 것(최신 먼저)" — 창이 그대로 그린다
    const tasks = [
      ...(this.#current ? [this.#current] : []),
      ...this.#queue,
      ...[...this.#tasks].reverse(),
    ].map(summarize)
    return {
      ...this.set,
      on: this.on,
      busy: this.busy,
      queued: this.#queue.map((t) => t.prompt),
      tasks,
    }
  }

  task(taskId: string): Task | null {
    if (this.#current?.id === taskId) return this.#current
    return this.#tasks.find((t) => t.id === taskId) ?? this.#queue.find((t) => t.id === taskId) ?? null
  }

  /** 정의가 바뀌었다 — 역할·런타임·모델이 달라졌으면 세션을 접는다(다음 작업에 새로 뜬다) */
  update(next: AgentSet) {
    const restart =
      next.runtime !== this.set.runtime || next.modelId !== this.set.modelId || next.role !== this.set.role
    this.set = next
    if (restart) this.#shutdown()
  }

  enqueue(prompt: string, opts: { routing?: boolean; sendText?: string } = {}): Task {
    const task: Task = {
      id: crypto.randomUUID(),
      setId: this.set.id,
      prompt,
      status: 'queued',
      createdAt: new Date().toISOString(),
      endedAt: null,
      routedTo: null,
      error: null,
      events: [],
      routing: opts.routing === true,
      sendText: opts.sendText ?? prompt,
    }
    this.#queue.push(task)
    this.#pump()
    pushState()
    return task
  }

  /** 대기 중인 작업을 취소한다. 진행 중인 작업이면 턴을 중단한다 */
  cancel(taskId: string) {
    const index = this.#queue.findIndex((t) => t.id === taskId)
    if (index >= 0) {
      const [dropped] = this.#queue.splice(index, 1)
      this.#finish(dropped, 'cancelled', null)
      pushState()
      return
    }
    if (this.#current?.id === taskId) this.#session?.cancel()
  }

  unqueue(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.#queue.length) return
    const [dropped] = this.#queue.splice(index, 1)
    this.#finish(dropped, 'cancelled', null)
    pushState()
  }

  moveQueued(from: number, to: number) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return
    if (from < 0 || from >= this.#queue.length || to < 0 || to >= this.#queue.length) return
    const [moved] = this.#queue.splice(from, 1)
    this.#queue.splice(to, 0, moved)
    pushState()
  }

  /** expect = 창이 보고 있던 원본. 그 사이 큐가 당겨졌으면 같은 번호가 다른 작업을 가리킨다 */
  editQueued(index: number, text: string, expect: string) {
    if (!Number.isInteger(index) || index < 0 || index >= this.#queue.length) return
    if (this.#queue[index].prompt !== expect) return
    const next = text.trim()
    if (!next) return
    this.#queue[index].prompt = next
    this.#queue[index].sendText = next
    pushState()
  }

  answerPermission(id: string, optionId: string | null) {
    this.#session?.answerPermission(id, optionId)
  }

  /** 유휴 종료·정의 변경·서버 정리 공용 */
  #shutdown() {
    this.#detach?.()
    this.#detach = null
    this.#session?.dispose()
    this.#session = null
    this.#starting = null
    this.#rolePrimed = false
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
  }

  stop() {
    this.#shutdown()
    pushState()
  }

  #armIdleTimer() {
    if (this.#idleTimer) clearTimeout(this.#idleTimer)
    this.#idleTimer = setTimeout(() => {
      // 그 사이 일이 들어왔으면 끄지 않는다 — 타이머는 도는 중에도 살아 있을 수 있다
      if (this.busy || this.#queue.length > 0) return this.#armIdleTimer()
      this.#shutdown()
      pushState()
    }, IDLE_KILL_MS)
    this.#idleTimer.unref?.()
  }

  async #ensureSession(): Promise<AgentSession> {
    if (this.#session) return this.#session
    if (this.#starting) return this.#starting
    const starting = AgentSession.start(this.set.runtime)
      .then(async (session) => {
        this.#session = session
        this.#starting = null
        this.#detach = session.attach((event) => this.#onEvent(event))
        if (this.set.modelId) {
          // 그 런타임에 없는 모델이면 조용히 넘어간다 — 기본 모델로도 일은 돈다
          await session.setModel(this.set.modelId).catch(() => {})
        }
        return session
      })
      .catch((err: unknown) => {
        this.#starting = null
        throw err
      })
    this.#starting = starting
    pushState()
    return starting
  }

  /** 역할은 시스템 프롬프트 자리가 없어서 첫 프롬프트 머리말로 간다 */
  #compose(prompt: string): string {
    if (this.#rolePrimed) return prompt
    this.#rolePrimed = true
    const role = this.set.id === ROUTER_ID ? ROUTER_ROLE : this.set.role
    return `${role}\n\n---\n\n${prompt}`
  }

  #pump() {
    if (this.#current || this.#queue.length === 0) return
    const task = this.#queue.shift()!
    this.#current = task
    task.status = 'running'
    void this.#ensureSession()
      .then((session) => {
        // 뜨는 사이에 취소됐다
        if (this.#current?.id !== task.id) return
        session.prompt(this.#compose(task.sendText))
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.#finish(task, 'error', `에이전트를 실행하지 못했습니다: ${message}`)
        this.#current = null
        pushState()
        this.#pump()
      })
    pushState()
  }

  #onEvent(event: AgentEvent) {
    // 모델 목록은 작업과 무관하게(세션이 뜨자마자) 온다. 런타임별 후보는 agentAcp가 담으므로
    // 여기서는 편집 창이 새 후보를 받도록 상태만 한 번 밀어 준다
    if (event.type === 'models') {
      pushState()
      return
    }
    const task = this.#current
    if (!task) return
    // meta·modes는 창 상단 정보줄용이라 작업 기록에 쌓지 않는다(계속 흐른다)
    if (event.type === 'meta' || event.type === 'modes') return

    task.events.push(event)
    if (task.events.length > MAX_TASK_EVENTS) task.events.splice(0, task.events.length - MAX_TASK_EVENTS)
    // 그 작업을 열어 둔 창에만 델타를 흘린다 — 상태 스냅샷에는 이벤트가 들어가지 않는다
    emit({ type: 'task_events', taskId: task.id, events: [event] })

    if (event.type === 'error') task.error = event.message
    if (event.type === 'turn_end') {
      const status: TaskStatus =
        event.stopReason === 'cancelled' ? 'cancelled' : event.stopReason === 'error' || task.error ? 'error' : 'done'
      this.#finish(task, status, task.error)
      this.#current = null
      if (task.routing) routeFinished(task)
      pushState()
      this.#pump()
      this.#armIdleTimer()
    }
  }

  #finish(task: Task, status: TaskStatus, error: string | null) {
    task.status = status
    task.error = error
    task.endedAt = new Date().toISOString()
    this.#tasks.push(task)
    if (this.#tasks.length > MAX_TASKS_PER_SET) this.#tasks.splice(0, this.#tasks.length - MAX_TASKS_PER_SET)
  }

  /** 마지막 에이전트 발화 — 라우터 판정 결과를 여기서 읽는다 */
  answerText(task: Task): string {
    let text = ''
    for (const event of task.events) {
      if (event.type !== 'update' || event.update.sessionUpdate !== 'agent_message_chunk') continue
      const content = event.update.content
      if (!Array.isArray(content) && content?.type === 'text') text += content.text
    }
    return text.trim()
  }
}

// ── 매니저 ──────────────────────────────────────────────────────────────────
const runners = new Map<string, AgentSetRunner>()

/** 정의에 있는 셋만 러너를 가진다 — 지워진 셋의 러너는 여기서 접힌다 */
function syncRunners(): AgentSet[] {
  const sets = readSets()
  const live = new Set(sets.map((s) => s.id))
  for (const [id, runner] of runners) {
    if (!live.has(id)) {
      runner.stop()
      runners.delete(id)
    }
  }
  for (const set of sets) {
    const existing = runners.get(set.id)
    if (existing) existing.update(set)
    else runners.set(set.id, new AgentSetRunner(set))
  }
  return sets
}

function runnerFor(setId: string): AgentSetRunner | null {
  syncRunners()
  return runners.get(setId) ?? null
}

export function viewSets(): SetView[] {
  const sets = syncRunners()
  return sets.map((set) => runners.get(set.id)!.view())
}

/** 정의가 바뀌었다(REST CRUD) — 러너를 맞추고 창에 알린다 */
export function reloadSets() {
  syncRunners()
  pushState()
}

export function findTask(taskId: string): { runner: AgentSetRunner; task: Task } | null {
  syncRunners()
  for (const runner of runners.values()) {
    const task = runner.task(taskId)
    if (task) return { runner, task }
  }
  return null
}

export function taskDetail(taskId: string): SetServerMessage | null {
  const found = findTask(taskId)
  if (!found) return null
  return { type: 'task', task: summarize(found.task), events: found.task.events }
}

export function cancelTask(taskId: string) {
  findTask(taskId)?.runner.cancel(taskId)
}

export function answerPermission(setId: string, id: string, optionId: string | null) {
  runnerFor(setId)?.answerPermission(id, optionId)
}

export function queueOp(setId: string, op: { type: 'unqueue' | 'move' | 'edit'; [k: string]: unknown }) {
  const runner = runnerFor(setId)
  if (!runner) return
  if (op.type === 'unqueue') runner.unqueue(Number(op.index))
  else if (op.type === 'move') runner.moveQueued(Number(op.from), Number(op.to))
  else if (op.type === 'edit') runner.editQueued(Number(op.index), String(op.text), String(op.expect))
}

export function stopSet(setId: string) {
  runnerFor(setId)?.stop()
}

/**
 * 창의 입력줄 하나가 부르는 길. setId를 주면(=@멘션) 라우터를 건너뛰고 그 셋이 바로 받는다.
 * 없으면 라우터가 판정하고, 판정이 끝나는 순간 routeFinished가 진짜 셋으로 넘긴다.
 */
export function submit(text: string, setId?: string | null): { ok: boolean; message?: string } {
  const prompt = text.trim()
  if (!prompt) return { ok: false, message: '프롬프트가 비어 있습니다' }

  if (setId) {
    const runner = runnerFor(setId)
    if (!runner) return { ok: false, message: '없는 에이전트셋입니다' }
    if (runner.set.id === ROUTER_ID) return { ok: false, message: '라우터에는 직접 맡길 수 없습니다' }
    runner.enqueue(prompt)
    return { ok: true }
  }

  const router = runnerFor(ROUTER_ID)
  if (!router) return { ok: false, message: '라우터가 없습니다' }
  const candidates = readSets().filter((s) => s.id !== ROUTER_ID)
  if (candidates.length === 0) return { ok: false, message: '맡길 에이전트셋이 없습니다 — 먼저 하나 만드세요' }
  // 후보 목록은 **맡길 때** 굳힌다 — 판정이 끝나는 시점의 목록이 아니라 지금 목록으로 고르게 한다
  router.enqueue(prompt, { routing: true, sendText: routePrompt(prompt, candidates) })
  return { ok: true }
}

/** 라우터가 무엇을 보고 판단할지 — 후보 목록과 사용자 프롬프트를 한 덩어리로 준다 */
function routePrompt(prompt: string, candidates: AgentSet[]): string {
  const list = candidates.map((s) => `- ${s.id} · ${s.name}: ${s.role.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
  return [`[후보]`, list, '', '[사용자 프롬프트]', prompt].join('\n')
}

/**
 * 판정 응답에서 셋을 골라낸다. 모델이 id 대신 이름을 답하는 일이 잦아서 둘 다 본다.
 * 못 고르면 null — 그 작업은 라우팅 실패로 남고, 사용자가 @로 직접 맡기면 된다.
 */
export function pickSet(answer: string, candidates: AgentSet[]): AgentSet | null {
  const text = answer.toLowerCase()
  // 마지막 줄부터 본다 — 모델이 앞에 군말을 붙여도 결론은 끝에 있다
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).reverse()
  for (const line of lines) {
    for (const set of candidates) {
      if (line.includes(set.id.toLowerCase())) return set
      if (line.includes(set.name.toLowerCase())) return set
    }
  }
  return null
}

function routeFinished(task: Task) {
  const router = runners.get(ROUTER_ID)
  if (!router) return
  const candidates = readSets().filter((s) => s.id !== ROUTER_ID)
  const answer = router.answerText(task)
  const picked = pickSet(answer, candidates)
  if (!picked) {
    task.status = 'error'
    task.error = `맡길 셋을 고르지 못했습니다: ${answer.slice(0, 200) || '(응답 없음)'}`
    pushState()
    return
  }
  task.routedTo = picked.name
  const target = runnerFor(picked.id)
  target?.enqueue(task.prompt)
  pushState()
}

/** 워크스페이스 교체·서버 종료 — 돌던 셋을 전부 접는다 */
export function stopAllSets() {
  for (const runner of runners.values()) runner.stop()
}
