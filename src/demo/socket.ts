import type { AgentEvent, AgentMessageSettings, SessionMeta } from '../utils/agentFold.ts'
import type { LiveResource } from '../../shared/live-updates.ts'
import { DEMO_USER } from './fixtures.ts'
import type { DemoWorkspaceStore } from './workspace-store.ts'
import { DemoTerminal } from './terminal.ts'
import { loadDemoFeatureDocuments, readDemoFeatureSnapshot } from './http-features.ts'
import { demoDebuggerStatus } from './http-debugger.ts'

type Payload = Record<string, unknown>
type AgentPrompt = { text: string; displayText?: string; settings?: AgentMessageSettings }
type AgentSession = {
  id: string
  cwd: string
  events: AgentEvent[]
  sockets: Set<DemoSocket>
  queued: AgentPrompt[]
  timer?: ReturnType<typeof setTimeout>
  startedAt: number
  busy: boolean
  turns: number
}
type Channel = { resource: LiveResource; revision: number; generation: number }
type ArchivedAgentSession = Pick<AgentSession, 'id' | 'cwd' | 'events' | 'startedAt' | 'turns'> & { key: string }
export type DemoSocketFactory = ((url: string) => WebSocket) & { close(): void }

/** A socket-shaped local channel. It never constructs a network WebSocket. */
class DemoSocket extends EventTarget {
  readonly url: string
  readyState = 0
  binaryType: BinaryType = 'blob'
  bufferedAmount = 0
  extensions = ''
  protocol = ''
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  receive: (message: Payload) => void = () => {}
  dispose: () => void = () => {}

  constructor(url: string, initialize: (socket: DemoSocket) => void) {
    super()
    this.url = url
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      initialize(this)
      if (this.readyState !== 1) return
      const event = new Event('open')
      this.onopen?.(event)
      this.dispatchEvent(event)
    })
  }

  emit(value: unknown): void {
    if (this.readyState !== 1) return
    const event = new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })
    this.onmessage?.(event)
    this.dispatchEvent(event)
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== 1) throw new DOMException('데모 연결이 열려 있지 않습니다.', 'InvalidStateError')
    if (typeof data !== 'string') return
    try {
      const message: unknown = JSON.parse(data)
      if (message && typeof message === 'object' && !Array.isArray(message)) this.receive(message as Payload)
    } catch { this.emit({ type: 'error', message: '올바른 데모 요청이 아닙니다.' }) }
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState >= 2) return
    this.readyState = 3
    this.dispose()
    const event = new Event('close') as CloseEvent
    Object.defineProperties(event, { code: { value: code }, reason: { value: reason }, wasClean: { value: code === 1000 } })
    this.onclose?.(event)
    this.dispatchEvent(event)
  }
}

function agentTask(store: DemoWorkspaceStore, _text: string, cwd: string): { path: string; response: string } {
  const path = store.demoFilePath
  const canonical = store.canonicalFilePath(cwd)
  const absoluteCwd = store.workspacePath + (canonical ? `/${canonical}` : '')
  store.tree('.workspace', absoluteCwd)
  const roots = store.getState<string[]>('project-roots', []).filter(root => absoluteCwd === root || absoluteCwd.startsWith(`${root}/`)).sort((a, b) => b.length - a.length)
  const docs = absoluteCwd.indexOf('/docs', store.workspacePath.length)
  const root = roots[0] ?? (docs >= 0 && (absoluteCwd.length === docs + 5 || absoluteCwd[docs + 5] === '/') ? absoluteCwd.slice(0, docs) : absoluteCwd)
  const absolutePath = `${root}/${path}`
  let current: string
  try { current = store.readFile(absolutePath).content }
  catch { current = '---\ntitle: "Mew 데모 안내"\ndescription: "데모 에이전트와 함께 정리한 프로젝트 문서입니다."\n---\n\n# Mew 데모 안내\n' }
  const section = '\n\n## 에이전트와 정리한 다음 단계\n\n- [ ] 실제 Mew 코드와 문서를 열어 보기\n- [ ] 기능과 태스크를 수정하고 문서에서 확인하기\n- [ ] Git에서 변경을 비교하고 데모를 초기화하기\n'
  const marker = '\n\n## 에이전트와 정리한 다음 단계'
  const existing = current.indexOf(marker)
  const base = existing >= 0 ? current.slice(0, existing) : current.trimEnd()
  let next = base + section
  if (next === current) next += '\n- [ ] 문서와 코드의 수정 내용을 다시 확인하기\n'
  store.writeFile(absolutePath, next)
  return { path, response: `예제 문서를 정리했습니다. [${path}](${absolutePath})에 다음 단계를 추가했어요.\n\n문서를 열어 내용을 바꾸거나 Git에서 변경 내용을 확인해 보세요.` }
}

/** All event streams observe the same visitor-owned workspace as the HTTP adapter. */
export function createDemoSocketFactory(store: DemoWorkspaceStore): DemoSocketFactory {
  const sockets = new Set<DemoSocket>()
  const agents = new Map<string, AgentSession>()
  const archives = new Map<string, ArchivedAgentSession>()
  const presence = new Set<DemoSocket>()
  const live = new Map<DemoSocket, Map<string, Channel>>()
  const databases = new Map<DemoSocket, Set<string>>()
  const terminals = new Map<string, { shell: DemoTerminal; sockets: Set<DemoSocket> }>()
  const deletedTerminals = new Set<string>()
  const connectedAt = Date.now()
  let sequence = 0, closed = false

  const metadata = (session: AgentSession): SessionMeta => ({ sessionId: session.id, startedAt: new Date(session.startedAt).toISOString(), turns: session.turns, busy: session.busy,
    queued: session.queued.map(prompt => prompt.displayText ?? prompt.text), queuedKinds: session.queued.map(() => 'prompt'), queuedSettings: session.queued.map(prompt => prompt.settings ?? null), usage: null, canLoad: true, canList: true })
  function broadcast(session: AgentSession, event: AgentEvent, remember = false): void {
    if (remember) { session.events.push(event); if (session.events.length > 500) session.events.splice(0, session.events.length - 500) }
    for (const socket of session.sockets) socket.emit(event)
  }
  const meta = (session: AgentSession) => broadcast(session, { type: 'meta', meta: metadata(session) })
  const archive = (key: string, session: AgentSession) => {
    archives.set(session.id, { key, id: session.id, cwd: session.cwd, events: structuredClone(session.events), startedAt: session.startedAt, turns: session.turns })
  }

  function run(session: AgentSession, prompt: AgentPrompt): void {
    if (session.busy) { session.queued.push(prompt); meta(session); return }
    session.busy = true
    const startedAt = Date.now()
    broadcast(session, { type: 'update', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: prompt.displayText ?? prompt.text } }, settings: prompt.settings }, true)
    broadcast(session, { type: 'turn_start', startedAt }, true)
    meta(session)
    const toolId = `demo-edit-${++sequence}`
    broadcast(session, { type: 'update', update: { sessionUpdate: 'tool_call', toolCallId: toolId, title: '예제 문서 정리', status: 'in_progress', kind: 'edit' } }, true)
    session.timer = setTimeout(() => {
      session.timer = undefined
      if (closed) return
      try {
        const result = agentTask(store, prompt.text, session.cwd)
        broadcast(session, { type: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: toolId, title: result.path, status: 'completed' } }, true)
        broadcast(session, { type: 'update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: result.response } } }, true)
      } catch (error) { broadcast(session, { type: 'error', message: error instanceof Error ? error.message : '데모 문서를 바꾸지 못했습니다.' }, true) }
      session.busy = false
      session.turns++
      broadcast(session, { type: 'turn_end', stopReason: 'end_turn', durationMs: Date.now() - startedAt }, true)
      meta(session)
      const next = session.queued.shift()
      if (next) run(session, next)
    }, 650)
  }

  function replay(socket: DemoSocket, session: AgentSession): void {
    socket.emit({ type: 'replay', events: session.events, restored: true })
    socket.emit({ type: 'models', models: { currentModelId: 'demo-model', availableModels: [{ modelId: 'demo-model', name: 'Demo agent' }] } })
    socket.emit({ type: 'modes', modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: '작업 폴더만' }] } })
    socket.emit({ type: 'meta', meta: metadata(session) })
  }

  function openAgent(socket: DemoSocket, url: URL): void {
    const key = JSON.stringify([url.searchParams.get('runtime'), url.searchParams.get('tab'), url.searchParams.get('cwd'), url.searchParams.get('mewcat')])
    let session = agents.get(key)
    if (!session) {
      session = { id: `demo-conversation-${++sequence}`, cwd: url.searchParams.get('cwd') ?? store.workspacePath, events: [], sockets: new Set(), queued: [], startedAt: Date.now(), busy: false, turns: 0 }
      agents.set(key, session)
    }
    const active = session
    active.sockets.add(socket)
    const dispose = socket.dispose
    socket.dispose = () => { active.sockets.delete(socket); dispose() }
    socket.receive = message => {
      const type = message.type
      if (type === 'prompt' && typeof message.text === 'string' && message.text.trim()) run(active, { text: message.text, displayText: typeof message.displayText === 'string' ? message.displayText : undefined, settings: message.settings as AgentMessageSettings | undefined })
      else if (type === 'cancel' || type === 'close_session') {
        clearTimeout(active.timer); active.timer = undefined
        if (active.busy) broadcast(active, { type: 'turn_end', stopReason: 'cancelled' }, true)
        active.busy = false
        if (type === 'close_session') {
          active.queued = []
          archive(key, active)
          if (agents.get(key) === active) agents.delete(key)
          meta(active)
          for (const peer of [...active.sockets]) peer.close()
        } else {
          const next = active.queued.shift()
          if (next) run(active, next)
          else meta(active)
        }
      } else if (type === 'clear_session') {
        clearTimeout(active.timer); active.timer = undefined
        archive(key, active)
        active.events = []; active.queued = []; active.busy = false; active.turns = 0; active.startedAt = Date.now()
        active.id = `demo-conversation-${++sequence}`
        broadcast(active, { type: 'reset' }); broadcast(active, { type: 'replay', events: [] }); meta(active)
      } else if (type === 'list_sessions') socket.emit({ type: 'sessions', sessions: [{ sessionId: active.id, title: 'Demo conversation' }, ...[...archives.values()].filter(session => session.key === key && session.id !== active.id).map(session => ({ sessionId: session.id, title: 'Demo conversation' }))] })
      else if (type === 'load_session') {
        const saved = typeof message.sessionId === 'string' ? archives.get(message.sessionId) : undefined
        if (message.sessionId !== active.id) {
          if (!saved || saved.key !== key) { socket.emit({ type: 'error', message: '데모 대화를 찾을 수 없습니다.' }); return }
          clearTimeout(active.timer); active.timer = undefined
          archive(key, active)
          Object.assign(active, { id: saved.id, cwd: saved.cwd, events: structuredClone(saved.events), startedAt: saved.startedAt, turns: saved.turns, busy: false, queued: [] })
          broadcast(active, { type: 'reset' })
        }
        for (const peer of active.sockets) replay(peer, active)
      }
      else if (type === 'history') replay(socket, active)
      else if (type === 'unqueue' && Number.isInteger(message.index)) { active.queued.splice(Number(message.index), 1); meta(active) }
      else if (type === 'move_queued' && Number.isInteger(message.from) && Number.isInteger(message.to)) {
        const [prompt] = active.queued.splice(Number(message.from), 1)
        if (prompt) active.queued.splice(Number(message.to), 0, prompt)
        meta(active)
      } else if (type === 'edit_queued' && Number.isInteger(message.index) && typeof message.text === 'string') {
        const prompt = active.queued[Number(message.index)]
        if (prompt) prompt.text = message.text
        meta(active)
      }
    }
    queueMicrotask(() => {
      socket.emit({ type: 'ready', cwd: active.cwd })
      replay(socket, active)
    })
  }

  function presenceSnapshot(socket: DemoSocket, message: Payload = {}): void {
    const path = typeof message.path === 'string' ? message.path : null
    socket.emit({ type: 'participants', participants: path ? { [path]: ['#a855f7'] } : {}, activeSessions: { selfId: 'demo-browser', sessions: [{ id: 'demo-browser', ...DEMO_USER,
      browser: 'Browser', device: 'Demo', connectedAt, workspaceLabel: 'Mew', project: message.project ?? '.workspace', path, visible: true, agents: { running: Number(message.runningAgents) || 0, reportedAt: Date.now() } }] } })
  }

  async function snapshot(socket: DemoSocket, id: string, channel: Channel): Promise<void> {
    const resource = channel.resource
    const generation = ++channel.generation
    const active = () => !closed && socket.readyState === 1 && live.get(socket)?.get(id) === channel && channel.generation === generation
    try {
      let value: Record<string, unknown>
      if (resource.kind === 'git') value = { info: store.gitRepository(), commits: store.gitLog().commits, workingTree: store.gitWorkingTree() }
      else if (resource.kind === 'git-diff') {
        await store.loadDiff(resource.file)
        if (!active()) return
        value = { ...store.gitDiff(resource.file), deleted: store.gitWorkingTree().files.some(file => file.path === resource.file && file.status === 'D') }
      } else if (resource.kind === 'features') {
        const prefix = `${store.canonicalFilePath(resource.workspace)}/docs/features/`.replace(/^\//, '')
        const loaded = store.repositoryEntries().filter(file => file.path.startsWith(prefix) && /\.md$/i.test(file.path) && !file.path.endsWith('/README.md')).every(file => store.isFileLoaded(`${store.workspacePath}/${file.path}`))
        if (!loaded) await loadDemoFeatureDocuments(store, resource.workspace)
        if (!active()) return
        value = { ...readDemoFeatureSnapshot(store, resource.workspace) }
      }
      else if (resource.kind === 'debugger') value = { ...demoDebuggerStatus(store, resource.workspace) }
      else { socket.emit({ type: 'error', id, message: '이 기능은 데모에서 제공하지 않습니다.' }); return }
      if (!active()) return
      socket.emit({ type: 'snapshot', id, revision: ++channel.revision, value })
    } catch (error) { if (active()) socket.emit({ type: 'error', id, message: error instanceof Error ? error.message : '데모 상태를 읽지 못했습니다.' }) }
  }

  function openTerminal(socket: DemoSocket, url: URL): void {
    const name = url.searchParams.get('session') || 'demo-terminal'
    if (deletedTerminals.has(name)) { socket.close(1008, 'Demo terminal has ended'); return }
    let terminal = terminals.get(name)
    if (!terminal) {
      const peers = new Set<DemoSocket>()
      const shell = new DemoTerminal(store, output => { for (const peer of peers) peer.emit(output) }, () => {
        shell.close()
        for (const peer of [...peers]) peer.close()
        for (const [key, candidate] of terminals) if (candidate.shell === shell) {
          terminals.delete(key); deletedTerminals.add(key)
          store.setState('tmux-sessions', store.getState<{ name: string }[]>('tmux-sessions', []).filter(session => session.name !== key))
        }
      }, store.getState(`tmux-session-cwd:${name}`, store.workspaceInfo().path))
      terminal = { shell, sockets: peers }
      terminals.set(name, terminal)
      const sessions = store.getState('tmux-sessions', [{ name: 'demo-terminal', windows: 1, attached: false, createdAt: 0 }])
      if (!sessions.some(session => session.name === name)) store.setState('tmux-sessions', [...sessions, { name, windows: 1, attached: false, createdAt: Date.now() }])
    }
    const active = terminal
    active.sockets.add(socket)
    const dispose = socket.dispose
    socket.dispose = () => { active.sockets.delete(socket); dispose() }
    socket.receive = message => { if (message.type === 'input' && typeof message.data === 'string') active.shell.input(message.data) }
    queueMicrotask(() => {
      const scrollback = active.shell.replay()
      if (scrollback) socket.emit(scrollback)
      else active.shell.start(store.getState(`tmux-session-output:${name}`, ''))
    })
  }

  const unsubscribe = store.subscribe(event => {
    if (event.type === 'state' && event.key === 'theme') for (const socket of presence) socket.emit({ type: 'theme' })
    if (event.type === 'files' || event.type === 'reset') for (const socket of presence) socket.emit({ type: 'tree', project: '.workspace', version: store.revision })
    if (event.type === 'state' && (event.key?.includes('chat') || event.key?.includes('comment'))) for (const socket of presence) socket.emit({ type: event.key.includes('chat') ? 'chat' : 'comments' })
    if (event.type === 'state' && event.key?.startsWith('db-event:')) {
      const update = store.getState<{ project: string; dbId: string; event: unknown } | null>(event.key, null)
      if (update) for (const [socket, subscriptions] of databases) if (subscriptions.has(JSON.stringify([update.project, update.dbId]))) socket.emit({ type: 'db.event', ...update })
    }
    if (event.type === 'git' || event.type === 'reset') for (const [socket, channels] of live) for (const [id, channel] of channels) if (event.type === 'reset' || channel.resource.kind === 'git' || channel.resource.kind === 'git-diff') void snapshot(socket, id, channel)
    if (event.type === 'state' && event.key?.startsWith('debug-')) for (const [socket, channels] of live) for (const [id, channel] of channels) if (channel.resource.kind === 'debugger') snapshot(socket, id, channel)
    if (event.type === 'state' && event.key?.startsWith('tmux-session-output:')) terminals.get(event.key.slice('tmux-session-output:'.length))?.shell.log(store.getState(event.key, ''))
    if (event.type === 'files' || event.type === 'state' && event.key?.startsWith('features:')) for (const [socket, channels] of live) for (const [id, channel] of channels) if (channel.resource.kind === 'features') snapshot(socket, id, channel)
    if (event.type === 'state' && event.key === 'tmux-session-rename') {
      const rename = store.getState<{ oldName: string; newName: string } | null>('tmux-session-rename', null)
      const terminal = rename && terminals.get(rename.oldName)
      if (rename && terminal) { terminals.delete(rename.oldName); terminals.set(rename.newName, terminal); deletedTerminals.add(rename.oldName); deletedTerminals.delete(rename.newName) }
    }
    if (event.type === 'state' && event.key === 'tmux-sessions') {
      const sessions = store.getState<{ name: string }[]>('tmux-sessions', [])
      for (const session of sessions) deletedTerminals.delete(session.name)
      for (const [name, terminal] of terminals) if (!sessions.some(session => session.name === name)) {
        terminal.shell.close()
        for (const socket of [...terminal.sockets]) socket.close()
        terminals.delete(name); deletedTerminals.add(name)
      }
    }
    if (event.type === 'reset') {
      archives.clear()
      deletedTerminals.clear()
      for (const terminal of terminals.values()) terminal.shell.reset()
      for (const session of agents.values()) {
        clearTimeout(session.timer); session.timer = undefined; session.events = []; session.queued = []; session.busy = false; session.turns = 0
        broadcast(session, { type: 'reset' }); broadcast(session, { type: 'replay', events: [] }); meta(session)
      }
    }
  })

  const factory = ((input: string): WebSocket => {
    if (closed) throw new Error('데모 작업 공간이 닫혔습니다.')
    const url = new URL(input, 'https://demo.invalid')
    const socket = new DemoSocket(url.href, current => {
      if (url.pathname === '/api/agent/ws') openAgent(current, url)
      else if (url.pathname === '/api/tmux/ws') openTerminal(current, url)
      else if (url.pathname === '/api/presence') {
        presence.add(current)
        let focus: Payload = {}
        current.receive = message => { if (message.type === 'focus') { focus = message; presenceSnapshot(current, focus) } }
        queueMicrotask(() => presenceSnapshot(current, focus))
      } else if (url.pathname === '/api/live/ws') {
        const channels = new Map<string, Channel>()
        live.set(current, channels)
        current.receive = message => {
          if (typeof message.id !== 'string') return
          if (message.type === 'unsubscribe') channels.delete(message.id)
          else if (message.type === 'subscribe' && message.resource && typeof message.resource === 'object') {
            const channel = { resource: message.resource as LiveResource, revision: 0, generation: 0 }
            channels.set(message.id, channel); void snapshot(current, message.id, channel)
          }
        }
      } else if (url.pathname === '/api/db/ws') {
        const subscriptions = new Set<string>()
        databases.set(current, subscriptions)
        current.receive = message => {
          if (typeof message.project !== 'string' || typeof message.dbId !== 'string') return
          const key = JSON.stringify([message.project, message.dbId])
          if (message.type === 'subscribe') subscriptions.add(key)
          else if (message.type === 'unsubscribe') subscriptions.delete(key)
        }
      } else current.close(1008, 'Unsupported demo channel')
    })
    sockets.add(socket)
    socket.dispose = () => { sockets.delete(socket); presence.delete(socket); live.delete(socket); databases.delete(socket) }
    return socket as unknown as WebSocket
  }) as DemoSocketFactory
  factory.close = () => {
    if (closed) return
    closed = true
    unsubscribe()
    for (const session of agents.values()) clearTimeout(session.timer)
    for (const terminal of terminals.values()) terminal.shell.close()
    for (const socket of [...sockets]) socket.close()
    agents.clear()
    archives.clear()
    terminals.clear()
    deletedTerminals.clear()
  }
  return factory
}
