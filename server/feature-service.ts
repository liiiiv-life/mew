import { connectAgentHost, connectExistingAgentHost, type AgentHostCallbacks, type AgentHostClient } from './agentHost.ts'
import { FeatureStore } from './features.ts'
import { featureAgentInstructions } from './feature-agent-instructions.ts'
import { activeFeatureRun, type FeatureRun } from '../shared/features.ts'
import { getUser } from './auth.ts'
import { canUse, unrestrictedWorkspaceFiles } from './access-policy.ts'
import type { AgentEvent } from './agentAcp.ts'

type Connection = Pick<AgentHostClient, 'send' | 'close'>
type Connect = (runtime: string, tab: string, cwd: string, callbacks: AgentHostCallbacks, context?: FeatureRun['context']) => Promise<Connection>
const connectFeatureHost: Connect = (runtime, tab, cwd, callbacks, context) => connectAgentHost(runtime, tab, cwd, callbacks, null, context)
function authorize(owner: string, workspace: string) {
  const user = getUser(owner)
  if (!user) return false
  const auth = { email: owner, role: user.role, mustChangePassword: user.mustChangePassword }
  return canUse(auth, 'agent') && unrestrictedWorkspaceFiles(auth, workspace, true)
}

export class FeatureService {
  private connections = new Map<string, Connection>()
  private pumping = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  readonly store: FeatureStore
  private connect: Connect
  private reconnect: Connect
  private allowed: typeof authorize
  constructor(store = new FeatureStore(), connect: Connect = connectFeatureHost, reconnect: Connect = connectExistingAgentHost, allowed = authorize) {
    this.store = store; this.connect = connect; this.reconnect = reconnect; this.allowed = allowed
  }
  start() {
    if (this.timer) return
    this.stopped = false
    const tick = () => { try { for (const workspace of this.store.workspaces()) void this.pump(workspace).catch(error => console.error('[mew:features]', error.message)) } catch (error) { console.error('[mew:features]', error instanceof Error ? error.message : String(error)) } }
    this.timer = setInterval(tick, 2000); this.timer.unref(); tick()
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; for (const connection of this.connections.values()) connection.close(); this.connections.clear() }
  private key(workspace: string, id: string) { return `${workspace}\0${id}` }
  async pump(workspace: string) {
    if (this.stopped || this.pumping.has(workspace)) return
    this.pumping.add(workspace)
    try {
      await this.store.prepare(workspace)
      const data = { runs: this.store.runs(workspace) }
      for (const run of data.runs) {
        const key = this.key(workspace, run.id)
        if (!activeFeatureRun(run) && this.connections.has(key)) { this.connections.get(key)!.close(); this.connections.delete(key) }
      }
      const active = data.runs.find(activeFeatureRun)
      if (active) {
        if (!this.connections.has(this.key(workspace, active.id))) await this.attach(workspace, active, true)
        return
      }
      if (!data.runs.some(run => run.state === 'queued')) return
      const next = await this.store.claim(workspace)
      if (!next) return
      if (!this.allowed(next.owner, workspace)) { await this.store.finish(workspace, next.id, 'failed', '작업을 요청한 계정의 에이전트·프로젝트 수정 권한이 없습니다.'); return }
      await this.attach(workspace, next, false)
    } finally { this.pumping.delete(workspace) }
  }
  private async attach(workspace: string, run: FeatureRun, recovering: boolean) {
    const key = this.key(workspace, run.id)
    let receivedTerminal = false
    let ready = false, currentModel = '', modelRequested = false, dispatching = false
    const dispatch = async () => {
      if (dispatching) return
      dispatching = true
      try {
        const connection = this.connections.get(key), current = this.store.runs(workspace).find(item => item.id === run.id)!
        if (!connection || this.stopped || !ready || !activeFeatureRun(current) || current.state === 'cancelling' || current.dispatchedAt) return
        if (!this.allowed(run.owner, workspace)) { await this.store.finish(workspace, run.id, 'failed', '프로젝트 수정 권한이 변경되어 실행하지 못했습니다.'); return }
        if (run.agentSet.modelId && currentModel !== run.agentSet.modelId) {
          if (!modelRequested) { modelRequested = true; connection.send({ type: 'set_model', modelId: run.agentSet.modelId }) }
          return
        }
        if (run.agentSet.thinkingId && run.agentSet.thinkingConfigId) connection.send({ type: 'set_thinking', configId: run.agentSet.thinkingConfigId, value: run.agentSet.thinkingId })
        // Persist send intent first, atomically with cancellation and other recovering monitors.
        if (!await this.store.beginDispatch(workspace, run.id)) return
        if (this.store.runs(workspace).find(item => item.id === run.id)?.state === 'cancelling') {
          await this.store.finish(workspace, run.id, 'cancelled'); return
        }
        connection.send({ type: 'prompt', text: `${run.title}\n\n${run.content}`, promptText: featureAgentInstructions(this.store.directory, workspace, run), automatic: true })
      } finally { dispatching = false }
    }
    // Process events in order, including a replay arriving before connect() resolves.
    let events = Promise.resolve()
    const receive = (event: AgentEvent, replayed = false) => {
      events = events.then(async () => {
        if (event.type === 'meta') {
          ready = !!event.meta.sessionId
          if (ready) await this.store.updateRun(workspace, run.id, { sessionId: event.meta.sessionId })
          if (!replayed && !event.meta.busy && this.store.runs(workspace).find(item => item.id === run.id)?.state === 'cancelling') await this.store.finish(workspace, run.id, 'cancelled')
        }
        else if (event.type === 'models') currentModel = event.models.currentModelId
        else if (event.type === 'auth' || event.type === 'permission') {
          if (event.type === 'auth') { ready = false; modelRequested = false }
          await this.store.updateRun(workspace, run.id, { state: 'blocked' })
        }
        else if (event.type === 'turn_start' || event.type === 'permission_done' || event.type === 'auth_complete') await this.store.updateRun(workspace, run.id, { state: 'running' })
        else if (event.type === 'error') {
          await this.store.updateRun(workspace, run.id, { error: event.message.slice(0, 8000) })
          if (modelRequested && !this.store.runs(workspace).find(item => item.id === run.id)?.dispatchedAt) await this.store.finish(workspace, run.id, 'failed', event.message)
        }
        else if (event.type === 'turn_end') {
          receivedTerminal = true
          await this.store.finish(workspace, run.id, event.stopReason === 'end_turn' ? 'completed' : event.stopReason === 'cancelled' ? 'cancelled' : 'failed', event.stopReason === 'end_turn' ? '' : `에이전트 종료: ${event.stopReason}`)
          this.connections.get(key)?.close(); this.connections.delete(key)
        }
        await dispatch()
      }).catch(error => {
        console.error('[mew:features:event]', error.message)
        this.connections.get(key)?.close(); this.connections.delete(key)
      })
    }
    try {
      const connection = await (recovering ? this.reconnect : this.connect)(run.agentSet.runtime, run.tabId, workspace, {
        onEvent: receive,
        onReplay: replay => { for (const event of replay) receive(event, true) },
        onFatal: message => { void this.store.finish(workspace, run.id, 'failed', message).catch(console.error) },
        onClose: () => { this.connections.delete(key) },
      }, run.context)
      await events
      if (this.stopped || receivedTerminal || !activeFeatureRun(this.store.runs(workspace).find(item => item.id === run.id)!)) { connection.close(); return }
      this.connections.set(key, connection)
      if (this.store.runs(workspace).find(item => item.id === run.id)?.state === 'cancelling') {
        connection.send({ type: 'cancel' })
      } else { await dispatch() }
    } catch (error) {
      await this.store.finish(workspace, run.id, 'failed', recovering ? '이전 에이전트 연결을 복원하지 못했습니다. 대화를 확인한 뒤 다시 요청하세요.' : error instanceof Error ? error.message : String(error))
    }
  }
  async cancel(workspace: string, id: string) {
    const run = await this.store.requestCancellation(workspace, id)
    const key = this.key(workspace, id), connection = this.connections.get(key)
    if (!activeFeatureRun(run)) {
      connection?.close(); this.connections.delete(key)
      return
    }
    if (connection) {
      connection.send({ type: 'cancel' })
      return
    }
    if (activeFeatureRun(run)) {
      // Keep the project queue occupied until the recovered host confirms cancellation.
      // If attach is already pending, it observes this state before sending a prompt.
      await this.pump(workspace)
      return
    }
  }
}
