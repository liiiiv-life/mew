import { randomUUID } from 'node:crypto'
import type { CDPSession, Page } from 'playwright-core'
import { getUser } from './auth.ts'
import { accessChanges, canUse, unrestrictedWorkspaceFiles } from './access-policy.ts'
import { workspacePaths } from './paths.ts'
import type { RequestAuth } from './reqAuth.ts'
import type { BrowserAnalysisSnapshot, BrowserCapture } from '../shared/debugger-browser.ts'

type Capture = 'cpu' | 'heap' | 'coverage'
interface BrowserBreakpoint { id: string; kind: 'dom' | 'event' | 'xhr'; value: string; type?: string; nodeId?: number }
const captures = ['cpu', 'heap', 'coverage'] as const
export class BrowserInspection {
  readonly id = randomUUID()
  readonly account: string
  readonly root: string
  readonly page: Page
  private client: CDPSession
  private closed = false
  private closing?: Promise<void>
  private permissionTimer?: NodeJS.Timeout
  private captureTimers = new Map<Capture, NodeJS.Timeout>()
  private busy = false
  private objects = new Set<string>()
  private scripts = new Set<string>()
  private rootNode?: number
  private revision = 0
  private frames: any[] = []
  private reason = ''
  private breakpoints: BrowserBreakpoint[] = []
  private artifacts: { id: string; kind: BrowserCapture; time: number; data: unknown }[] = []
  private queue: Promise<unknown> = Promise.resolve()
  private constructor(account: string, root: string, page: Page, client: CDPSession) { this.account = account; this.root = root; this.page = page; this.client = client }
  static async connect(account: string, root: string, page: Page) {
    const session = new BrowserInspection(account, root, page, await page.context().newCDPSession(page))
    session.client.on('Debugger.scriptParsed', event => { if (session.scripts.size < 2000) session.scripts.add(event.scriptId) })
    session.client.on('Debugger.paused', event => { void session.client.send('Runtime.releaseObjectGroup', { objectGroup: `${session.id}-${session.revision}` }).catch(() => {}); session.frames = event.callFrames.slice(0, 40); session.reason = event.reason; ++session.revision; session.objects.clear() })
    session.client.on('Debugger.resumed', () => { void session.client.send('Runtime.releaseObjectGroup', { objectGroup: `${session.id}-${session.revision}` }).catch(() => {}); session.frames = []; session.reason = ''; session.objects.clear(); ++session.revision })
    session.client.on('DOM.documentUpdated', () => { session.rootNode = undefined; session.breakpoints = session.breakpoints.filter(b => b.kind !== 'dom') })
    session.client.on('DOM.childNodeRemoved', event => { session.breakpoints = session.breakpoints.filter(b => b.nodeId !== event.nodeId) })
    page.on('close', session.pageClosed)
    try {
      await session.client.send('Debugger.enable'); await session.client.send('DOM.enable'); await session.client.send('Profiler.enable')
      session.permissionTimer = setInterval(session.recheck, 5000); session.permissionTimer.unref(); accessChanges.on('change', session.recheck)
      return session
    } catch (error) { await session.close(); throw error }
  }
  snapshot(): BrowserAnalysisSnapshot { return { id: this.id, revision: this.revision, closed: this.closed, url: this.page.isClosed() ? '' : this.page.url(), reason: this.reason, frames: this.frames.map(f => ({ id: f.callFrameId, name: f.functionName, url: f.url, line: f.location.lineNumber + 1, column: f.location.columnNumber + 1, scriptId: f.location.scriptId })), breakpoints: this.breakpoints, capturing: [...this.captureTimers.keys()], artifacts: this.artifacts.map(a => ({ id: a.id, kind: a.kind, time: a.time })), busy: this.busy } }
  private pageClosed = () => { void this.close() }
  private recheck = () => {
    const user = getUser(this.account), auth: RequestAuth = { email: this.account, role: user?.role ?? 'guest', mustChangePassword: user?.mustChangePassword ?? false }
    if (!user || workspacePaths.root !== this.root || !['owner', 'manager'].includes(auth.role) || auth.mustChangePassword || !canUse(auth, 'terminal') || !canUse(auth, 'browser') || !unrestrictedWorkspaceFiles(auth, this.root, true)) void this.close()
  }
  async command(command: string, args: Record<string, unknown>) {
    const next = this.queue.catch(() => {}).then(async () => { const result = await this.execute(command, args); this.recheck(); if (this.closed) throw new Error('브라우저 분석 연결이 종료되었습니다'); return result })
    this.queue = next; return next
  }
  private async execute(command: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.closed || this.page.isClosed()) throw new Error('브라우저 분석 연결이 종료되었습니다')
    this.recheck(); if (this.closed) throw new Error('브라우저 분석 권한이 없습니다')
    const allowed: Record<string, string[]> = { resume: ['revision'], next: ['revision'], stepIn: ['revision'], stepOut: ['revision'], pause: [], evaluate: ['revision', 'frameId', 'expression'], properties: ['revision', 'objectId'], source: ['scriptId'], breakpoint: ['kind', 'value', 'type'], removeBreakpoint: ['id'], startCapture: ['kind'], stopCapture: ['kind'], artifact: ['id'], heapSnapshot: [] }
    if (!Object.hasOwn(allowed, command) || Object.keys(args).some(k => !allowed[command].includes(k))) throw new Error('지원하지 않는 브라우저 분석 명령 또는 인수')
    if (['resume', 'next', 'stepIn', 'stepOut', 'evaluate', 'properties'].includes(command) && (!this.frames.length || args.revision !== this.revision)) throw new Error('브라우저 중단 시점이 변경되었습니다')
    const text = (key: string, max = 4096) => { if (typeof args[key] !== 'string' || !args[key] || args[key].length > max || args[key].includes('\0')) throw new Error(`잘못된 ${key}`); return args[key] as string }
    if (command === 'pause') return this.client.send('Debugger.pause')
    if (['resume', 'next', 'stepIn', 'stepOut'].includes(command)) return this.client.send(({ resume: 'Debugger.resume', next: 'Debugger.stepOver', stepIn: 'Debugger.stepInto', stepOut: 'Debugger.stepOut' } as const)[command as 'resume'])
    if (command === 'evaluate') {
      const frameId = text('frameId'); if (!this.frames.some(f => f.callFrameId === frameId)) throw new Error('만료된 브라우저 프레임')
      const revision = this.revision, result = await this.client.send('Debugger.evaluateOnCallFrame', { callFrameId: frameId, expression: text('expression'), objectGroup: `${this.id}-${revision}`, generatePreview: true })
      if (revision !== this.revision) throw new Error('브라우저 중단 시점이 변경되었습니다')
      if (result.result.objectId && this.objects.size < 1000) this.objects.add(result.result.objectId)
      return result
    }
    if (command === 'properties') {
      const objectId = text('objectId'); if (!this.objects.has(objectId)) throw new Error('만료된 브라우저 객체 참조')
      const revision = this.revision, result = await this.client.send('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true })
      if (revision !== this.revision) throw new Error('브라우저 중단 시점이 변경되었습니다')
      const properties = result.result.slice(0, 200)
      for (const p of properties) if (p.value?.objectId && this.objects.size < 1000) this.objects.add(p.value.objectId)
      return { result: properties, total: result.result.length }
    }
    if (command === 'source') { const scriptId = text('scriptId'); if (!this.scripts.has(scriptId)) throw new Error('알 수 없는 브라우저 소스'); const result = await this.client.send('Debugger.getScriptSource', { scriptId }); if (result.scriptSource.length > 512000) throw new Error('소스가 512KB를 초과합니다'); return { content: result.scriptSource } }
    if (command === 'breakpoint') {
      if (this.breakpoints.length >= 64) throw new Error('브라우저 중단점은 최대 64개입니다')
      const kind = text('kind'), value = text('value'), bp: BrowserBreakpoint = { id: randomUUID(), kind: kind as BrowserBreakpoint['kind'], value }
      if (this.breakpoints.some(b => b.kind === kind && b.value === value && b.type === args.type)) throw new Error('이미 등록된 브라우저 중단점입니다')
      if (kind === 'dom') {
        if (!['subtree-modified', 'attribute-modified', 'node-removed'].includes(String(args.type))) throw new Error('DOM 중단점 종류를 선택하세요')
        if (!this.rootNode) this.rootNode = (await this.client.send('DOM.getDocument')).root.nodeId
        const node = await this.client.send('DOM.querySelector', { nodeId: this.rootNode, selector: value })
        if (!node.nodeId) throw new Error('선택자에 해당하는 요소가 없습니다')
        bp.type = String(args.type); bp.nodeId = node.nodeId
        await this.client.send('DOMDebugger.setDOMBreakpoint', { nodeId: node.nodeId, type: bp.type as 'subtree-modified' })
      } else if (kind === 'event') await this.client.send('DOMDebugger.setEventListenerBreakpoint', { eventName: value })
      else if (kind === 'xhr') await this.client.send('DOMDebugger.setXHRBreakpoint', { url: value })
      else throw new Error('지원하지 않는 브라우저 중단점')
      this.breakpoints.push(bp); return bp
    }
    if (command === 'removeBreakpoint') { const bp = this.breakpoints.find(b => b.id === text('id')); if (!bp) throw new Error('중단점을 찾을 수 없습니다'); await this.remove(bp); this.breakpoints = this.breakpoints.filter(b => b !== bp); return { ok: true } }
    if (command === 'artifact') { const artifact = this.artifacts.find(a => a.id === text('id', 128)); if (!artifact) throw new Error('분석 파일을 찾을 수 없습니다'); return artifact.data }
    if (command === 'heapSnapshot') {
      this.busy = true
      let content = '', exceeded = false
      const chunk = (event: { chunk: string }) => { if (exceeded) return; if (content.length + event.chunk.length > 8_000_000) { exceeded = true; content = ''; return }; content += event.chunk }
      this.client.on('HeapProfiler.addHeapSnapshotChunk', chunk)
      try {
        await this.client.send('HeapProfiler.enable'); await this.client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
        if (exceeded) throw new Error('힙 스냅샷이 8MB를 초과합니다')
        const data: unknown = JSON.parse(content); this.record('snapshot', data); return data
      } finally { this.client.off('HeapProfiler.addHeapSnapshotChunk', chunk); this.busy = false }
    }
    const kind = text('kind') as Capture
    if (!captures.includes(kind)) throw new Error('지원하지 않는 수집 종류')
    if (command === 'startCapture') {
      if (this.captureTimers.has(kind)) throw new Error('이미 수집 중입니다')
      if (kind === 'cpu') await this.client.send('Profiler.start')
      else if (kind === 'heap') { await this.client.send('HeapProfiler.enable'); await this.client.send('HeapProfiler.startSampling', { samplingInterval: 32768 }) }
      else await this.client.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
      const timer = setTimeout(() => { void this.command('stopCapture', { kind }).catch(() => {}) }, 60_000); timer.unref(); this.captureTimers.set(kind, timer)
      return { ok: true, maxSeconds: 60 }
    }
    this.busy = true
    try {
      if (!this.captureTimers.has(kind)) throw new Error('수집 중인 분석이 없습니다')
      clearTimeout(this.captureTimers.get(kind)); this.captureTimers.delete(kind)
      let data: unknown
      if (kind === 'cpu') data = (await this.client.send('Profiler.stop')).profile
      else if (kind === 'heap') data = (await this.client.send('HeapProfiler.stopSampling')).profile
      else { const result = await this.client.send('Profiler.takePreciseCoverage'); await this.client.send('Profiler.stopPreciseCoverage'); data = { kind: 'coverage', ...result } }
      this.record(kind, data)
      return data
    } finally { this.busy = false }
  }
  private record(kind: BrowserCapture, data: unknown) {
    if (JSON.stringify(data).length > 8_000_000) throw new Error('분석 파일이 8MB를 초과합니다')
    this.artifacts.push({ id: randomUUID(), kind, time: Date.now(), data }); this.artifacts = this.artifacts.slice(-3)
    while (this.artifacts.length > 1 && JSON.stringify(this.artifacts).length > 8_000_000) this.artifacts.shift()
  }
  private remove(bp: BrowserBreakpoint) {
    if (bp.kind === 'dom') return this.client.send('DOMDebugger.removeDOMBreakpoint', { nodeId: bp.nodeId!, type: bp.type as 'subtree-modified' })
    if (bp.kind === 'event') return this.client.send('DOMDebugger.removeEventListenerBreakpoint', { eventName: bp.value })
    return this.client.send('DOMDebugger.removeXHRBreakpoint', { url: bp.value })
  }
  close() {
    if (this.closing) return this.closing
    this.closed = true; clearInterval(this.permissionTimer); accessChanges.off('change', this.recheck); this.page.off('close', this.pageClosed)
    for (const timer of this.captureTimers.values()) clearTimeout(timer)
    const attempts: Promise<unknown>[] = this.breakpoints.map(b => this.remove(b))
    for (const kind of this.captureTimers.keys()) attempts.push(this.client.send(({ cpu: 'Profiler.stop', heap: 'HeapProfiler.stopSampling', coverage: 'Profiler.stopPreciseCoverage' } as const)[kind]))
    this.captureTimers.clear(); this.breakpoints = []; this.objects.clear(); this.scripts.clear(); this.frames = []; this.artifacts = []
    attempts.push(this.client.send('Runtime.releaseObjectGroup', { objectGroup: `${this.id}-${this.revision}` }))
    this.closing = (async () => { await Promise.allSettled(attempts); await this.client.detach().catch(() => {}) })()
    return this.closing
  }
}

const inspections = new Map<string, BrowserInspection>()
const connecting = new Set<string>()
export function browserInspection(account: string, root: string) { return inspections.get(JSON.stringify([account, root])) }
export async function connectBrowserInspection(account: string, root: string, page: Page) {
  const key = JSON.stringify([account, root])
  if (connecting.has(key)) throw new Error('브라우저 분석 연결 중입니다')
  connecting.add(key)
  try {
    const previous = inspections.get(key); if (previous) await previous.close()
    if (inspections.size + connecting.size > 64) { for (const [k, s] of inspections) if (s.snapshot().closed) inspections.delete(k); if (inspections.size + connecting.size > 64) throw new Error('브라우저 분석 연결 한도에 도달했습니다') }
    const session = await BrowserInspection.connect(account, root, page); inspections.set(key, session); return session
  } finally { connecting.delete(key) }
}
