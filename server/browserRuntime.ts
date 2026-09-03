// 실제 Chromium은 서버에서 실행하고, Mew에는 화면 프레임과 입력 이벤트만 중계한다.
// 외부 페이지를 Mew origin에 프록시하지 않으므로 페이지 JS가 Mew 쿠키/API에 닿을 수 없다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { WebSocket, type RawData } from 'ws'
import { DATA_DIR } from './dataDir.ts'

const PROFILE_ROOT = path.join(DATA_DIR, 'browser', 'profiles')
const RUNTIME_POINTER = path.join(DATA_DIR, 'browser', 'runtime.json')
const START_TIMEOUT_MS = 15_000
const IDLE_TIMEOUT_MS = 10 * 60_000
const FRAME_INTERVAL_MS = 100
const CDP_COMMAND_TIMEOUT_MS = 15_000
const MAX_FRAME_BACKLOG = 2 * 1024 * 1024
const TAB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

type JsonRecord = Record<string, unknown>
type CdpEvent = { method: string; params?: JsonRecord; sessionId?: string }

export type BrowserClientMessage =
  | { type: 'hello'; tabId: string; url: string; width: number; height: number }
  | { type: 'navigate'; url: string }
  | { type: 'resize'; width: number; height: number }
  | { type: 'history'; direction: 'back' | 'forward' }
  | { type: 'reload' }
  | { type: 'stop' }
  | { type: 'pointer'; event: 'down' | 'up' | 'move'; pointerType: 'mouse' | 'touch'; x: number; y: number; button: 'left' | 'middle' | 'right' | 'none'; buttons: number; clickCount: number }
  | { type: 'wheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'key'; event: 'down' | 'up'; key: string; code: string; modifiers: number; repeat: boolean }
  | { type: 'insert_text'; text: string }
  | { type: 'dialog'; accept: boolean; promptText?: string }
  | { type: 'close_tab'; tabId: string }

export type BrowserServerMessage =
  | { type: 'ready' }
  | { type: 'state'; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
  | { type: 'dialog'; dialogType: string; message: string; defaultPrompt: string }
  | { type: 'popup'; tab: { id: string; url: string; title: string } }
  | { type: 'fatal'; message: string }

function finiteNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(min, Math.min(max, value))
}

function viewport(value: unknown, min: number, max: number): number | null {
  const number = finiteNumber(value, min, max)
  return number === null ? null : Math.round(number)
}

/** WS 입력은 브라우저 프로세스에 바로 들어가므로 타입·길이·수치 범위를 한 곳에서 묶는다. */
export function parseBrowserClientMessage(raw: string): BrowserClientMessage | null {
  if (raw.length > 64 * 1024) return null
  let value: JsonRecord
  try {
    value = JSON.parse(raw) as JsonRecord
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || typeof value.type !== 'string') return null
  if (value.type === 'hello') {
    const width = viewport(value.width, 320, 1920)
    const height = viewport(value.height, 240, 1200)
    if (typeof value.tabId !== 'string' || !TAB_ID_RE.test(value.tabId) || typeof value.url !== 'string' || width === null || height === null) return null
    try { return { type: 'hello', tabId: value.tabId, url: normalizeRemoteBrowserUrl(value.url), width, height } } catch { return null }
  }
  if (value.type === 'navigate' && typeof value.url === 'string') {
    try { return { type: 'navigate', url: normalizeRemoteBrowserUrl(value.url) } } catch { return null }
  }
  if (value.type === 'resize') {
    const width = viewport(value.width, 320, 1920)
    const height = viewport(value.height, 240, 1200)
    return width === null || height === null ? null : { type: 'resize', width, height }
  }
  if (value.type === 'history' && (value.direction === 'back' || value.direction === 'forward')) return { type: 'history', direction: value.direction }
  if (value.type === 'reload' || value.type === 'stop') return { type: value.type }
  if (value.type === 'pointer') {
    if (value.event !== 'down' && value.event !== 'up' && value.event !== 'move') return null
    if (value.button !== 'left' && value.button !== 'middle' && value.button !== 'right' && value.button !== 'none') return null
    const x = finiteNumber(value.x, 0, 1920)
    const y = finiteNumber(value.y, 0, 1200)
    const buttons = finiteNumber(value.buttons, 0, 7)
    const clickCount = finiteNumber(value.clickCount, 0, 3)
    if (x === null || y === null || buttons === null || clickCount === null) return null
    const pointerType = value.pointerType === 'touch' ? 'touch' : 'mouse'
    return { type: 'pointer', event: value.event, pointerType, x, y, button: value.button, buttons: Math.round(buttons), clickCount: Math.round(clickCount) }
  }
  if (value.type === 'wheel') {
    const x = finiteNumber(value.x, 0, 1920)
    const y = finiteNumber(value.y, 0, 1200)
    const deltaX = finiteNumber(value.deltaX, -4000, 4000)
    const deltaY = finiteNumber(value.deltaY, -4000, 4000)
    if (x === null || y === null || deltaX === null || deltaY === null) return null
    return { type: 'wheel', x, y, deltaX, deltaY }
  }
  if (value.type === 'key') {
    if (value.event !== 'down' && value.event !== 'up') return null
    if (typeof value.key !== 'string' || value.key.length > 40 || typeof value.code !== 'string' || value.code.length > 40) return null
    const modifiers = finiteNumber(value.modifiers, 0, 15)
    if (modifiers === null) return null
    return { type: 'key', event: value.event, key: value.key, code: value.code, modifiers: Math.round(modifiers), repeat: value.repeat === true }
  }
  if (value.type === 'insert_text' && typeof value.text === 'string' && value.text.length <= 10_000) return { type: 'insert_text', text: value.text }
  if (value.type === 'dialog' && typeof value.accept === 'boolean') {
    const promptText = typeof value.promptText === 'string' ? value.promptText.slice(0, 10_000) : undefined
    return { type: 'dialog', accept: value.accept, ...(promptText === undefined ? {} : { promptText }) }
  }
  if (value.type === 'close_tab' && typeof value.tabId === 'string' && TAB_ID_RE.test(value.tabId)) return { type: 'close_tab', tabId: value.tabId }
  return null
}

export function normalizeRemoteBrowserUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > 4096) throw new Error('주소가 올바르지 않습니다')
  const hostWithPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(trimmed)
  const scheme = hostWithPort ? undefined : /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') throw new Error('http 또는 https 주소만 열 수 있습니다')
  const withScheme = scheme ? trimmed : `http://${trimmed}`
  const url = new URL(withScheme)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http 또는 https 주소만 열 수 있습니다')
  if (!url.hostname) throw new Error('주소가 올바르지 않습니다')
  return url.toString()
}

export function browserProfileKey(email: string): string {
  return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24)
}

type RuntimePointer = { executable?: unknown }

function executableFile(file: string | undefined): string | null {
  if (!file || !path.isAbsolute(file)) return null
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return file
  } catch {
    return null
  }
}

/** 명시 설정 → Mew 관리 런타임 → OS 설치 순서. PATH의 우연한 별칭보다 절대경로를 쓴다. */
export function resolveBrowserExecutable(): string | null {
  const configured = executableFile(process.env.MEW_BROWSER_EXECUTABLE)
  if (configured) return configured
  try {
    const pointer = JSON.parse(fs.readFileSync(RUNTIME_POINTER, 'utf8')) as RuntimePointer
    const managed = typeof pointer.executable === 'string' ? executableFile(pointer.executable) : null
    if (managed) return managed
  } catch {
    /* 아직 관리 런타임을 설치하지 않았거나 포인터가 낡았다 — 시스템 설치 탐색으로 계속한다 */
  }
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      ]
    : ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']
  return candidates.map(executableFile).find((file): file is string => file !== null) ?? null
}

export function browserExecutableStatus(): { available: boolean; executable: string | null } {
  const executable = resolveBrowserExecutable()
  return { available: executable !== null, executable }
}

class CdpTransport {
  private socket: WebSocket
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private listeners = new Set<(event: CdpEvent) => void>()

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (raw) => this.receive(raw))
    socket.on('close', () => this.failPending(new Error('서버 Chromium 연결이 종료되었습니다')))
    socket.on('error', (error) => this.failPending(error))
  }

  static async connect(url: string): Promise<CdpTransport> {
    const socket = new WebSocket(url, { maxPayload: 16 * 1024 * 1024 })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    return new CdpTransport(socket)
  }

  command<T = JsonRecord>(method: string, params: JsonRecord = {}, sessionId?: string): Promise<T> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('서버 Chromium에 연결되어 있지 않습니다'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Chromium 명령 시간이 초과되었습니다: ${method}`))
      }, CDP_COMMAND_TIMEOUT_MS)
      timer.unref?.()
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.socket.close()
  }

  private receive(raw: RawData): void {
    let message: JsonRecord
    try { message = JSON.parse(raw.toString()) as JsonRecord } catch { return }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      const error = message.error as { message?: unknown } | undefined
      if (error) pending.reject(new Error(typeof error.message === 'string' ? error.message : 'Chromium 명령이 실패했습니다'))
      else pending.resolve(message.result)
      return
    }
    if (typeof message.method === 'string') {
      const event: CdpEvent = {
        method: message.method,
        params: message.params && typeof message.params === 'object' ? message.params as JsonRecord : undefined,
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : undefined,
      }
      for (const listener of this.listeners) listener(event)
    }
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function send(ws: WebSocket, message: BrowserServerMessage): void {
  if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_FRAME_BACKLOG) ws.send(JSON.stringify(message))
}

/** 8바이트 viewport 헤더 + JPEG. JSON/base64로 다시 싸는 33% 전송 오버헤드를 피한다. */
function framePacket(data: string, width: number, height: number): Buffer {
  const jpeg = Buffer.from(data, 'base64')
  const packet = Buffer.allocUnsafe(8 + jpeg.length)
  packet.writeUInt32BE(width, 0)
  packet.writeUInt32BE(height, 4)
  jpeg.copy(packet, 8)
  return packet
}

function sendFrame(ws: WebSocket, packet: Buffer): void {
  if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount >= MAX_FRAME_BACKLOG) return
  ws.send(packet, { binary: true })
}

function virtualKeyCode(key: string): number {
  if (key.length === 1) return key.toUpperCase().charCodeAt(0)
  return ({ Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Meta: 91 } as Record<string, number>)[key] ?? 0
}

class BrowserPage {
  readonly tabId: string
  readonly targetId: string
  readonly viewers = new Set<WebSocket>()
  private sessionId: string
  private cdp: CdpTransport
  private width = 1280
  private height = 800
  private initialized = false
  private streaming = false
  private stopStreamingTimer: NodeJS.Timeout | null = null
  private loading = false
  private currentUrl = 'about:blank'
  private title = ''
  private canGoBack = false
  private canGoForward = false
  private offEvent: () => void

  constructor(
    tabId: string,
    targetId: string,
    sessionId: string,
    cdp: CdpTransport,
  ) {
    this.tabId = tabId
    this.targetId = targetId
    this.sessionId = sessionId
    this.cdp = cdp
    this.offEvent = cdp.onEvent((event) => {
      if (event.sessionId === this.sessionId) void this.onEvent(event)
    })
  }

  async initialize(initialUrl: string): Promise<void> {
    if (this.initialized) return
    await Promise.all([
      this.command('Page.enable'),
      this.command('Runtime.enable'),
      this.command('Page.setLifecycleEventsEnabled', { enabled: true }),
    ])
    this.initialized = true
    await this.resize(this.width, this.height)
    if (initialUrl !== 'about:blank') await this.navigate(initialUrl)
    else await this.updateState()
  }

  async addViewer(ws: WebSocket, width: number, height: number): Promise<void> {
    if (this.stopStreamingTimer) clearTimeout(this.stopStreamingTimer)
    this.stopStreamingTimer = null
    this.viewers.add(ws)
    await this.resize(width, height)
    if (!this.streaming) {
      this.streaming = true
      await this.command('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: this.width, maxHeight: this.height, everyNthFrame: 1 })
    }
    send(ws, { type: 'ready' })
    await this.updateState()
  }

  removeViewer(ws: WebSocket): void {
    this.viewers.delete(ws)
    if (this.viewers.size !== 0 || !this.streaming || this.stopStreamingTimer) return
    // 패널→팝업 떼기는 기존 소켓이 먼저 닫히고 새 소켓이 곧 붙는다. 짧은 유예로 같은
    // screencast를 이어 받아 stop/start 역전과 검은 프레임을 막는다.
    this.stopStreamingTimer = setTimeout(() => {
      this.stopStreamingTimer = null
      if (this.viewers.size !== 0 || !this.streaming) return
      void this.command('Page.stopScreencast').catch(() => {}).then(async () => {
        this.streaming = false
        if (this.viewers.size > 0) {
          this.streaming = true
          await this.command('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: this.width, maxHeight: this.height, everyNthFrame: 1 }).catch(() => {})
        }
      })
    }, 1_000)
    this.stopStreamingTimer.unref?.()
  }

  async navigate(rawUrl: string): Promise<void> {
    const url = normalizeRemoteBrowserUrl(rawUrl)
    this.loading = true
    this.currentUrl = url
    this.broadcastState()
    await this.command('Page.navigate', { url })
  }

  async resize(width: number, height: number): Promise<void> {
    if (width === this.width && height === this.height && this.initialized) return
    this.width = width
    this.height = height
    await this.command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    })
    if (this.streaming) {
      await this.command('Page.stopScreencast').catch(() => {})
      await this.command('Page.startScreencast', { format: 'jpeg', quality: 72, maxWidth: width, maxHeight: height, everyNthFrame: 1 })
    }
  }

  async history(direction: 'back' | 'forward'): Promise<void> {
    const history = await this.command<{ currentIndex: number; entries: { id: number }[] }>('Page.getNavigationHistory')
    const index = history.currentIndex + (direction === 'back' ? -1 : 1)
    const entry = history.entries[index]
    if (entry) await this.command('Page.navigateToHistoryEntry', { entryId: entry.id })
  }

  async reload(): Promise<void> { await this.command('Page.reload', { ignoreCache: false }) }
  async stop(): Promise<void> { await this.command('Page.stopLoading') }

  async pointer(message: Extract<BrowserClientMessage, { type: 'pointer' }>): Promise<void> {
    if (message.pointerType === 'touch') {
      await this.command('Input.dispatchTouchEvent', {
        type: message.event === 'down' ? 'touchStart' : message.event === 'up' ? 'touchEnd' : 'touchMove',
        touchPoints: message.event === 'up' ? [] : [{ x: message.x, y: message.y, id: 1 }],
      })
      return
    }
    const type = message.event === 'down' ? 'mousePressed' : message.event === 'up' ? 'mouseReleased' : 'mouseMoved'
    await this.command('Input.dispatchMouseEvent', {
      type,
      x: message.x,
      y: message.y,
      button: message.button,
      buttons: message.buttons,
      clickCount: message.clickCount,
    })
  }

  async wheel(message: Extract<BrowserClientMessage, { type: 'wheel' }>): Promise<void> {
    await this.command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: message.x, y: message.y, deltaX: message.deltaX, deltaY: message.deltaY })
  }

  async key(message: Extract<BrowserClientMessage, { type: 'key' }>): Promise<void> {
    const printable = message.key.length === 1 && (message.modifiers & 7) === 0
    await this.command('Input.dispatchKeyEvent', {
      type: message.event === 'down' ? 'keyDown' : 'keyUp',
      key: message.key,
      code: message.code,
      modifiers: message.modifiers,
      autoRepeat: message.repeat,
      windowsVirtualKeyCode: virtualKeyCode(message.key),
      nativeVirtualKeyCode: virtualKeyCode(message.key),
      ...(message.event === 'down' && printable ? { text: message.key, unmodifiedText: message.key } : {}),
    })
  }

  async insertText(text: string): Promise<void> { await this.command('Input.insertText', { text }) }
  async dialog(accept: boolean, promptText?: string): Promise<void> {
    await this.command('Page.handleJavaScriptDialog', { accept, ...(promptText === undefined ? {} : { promptText }) })
  }

  announcePopup(tab: { id: string; url: string; title: string }): void {
    for (const viewer of this.viewers) send(viewer, { type: 'popup', tab })
  }

  dispose(): void {
    if (this.stopStreamingTimer) clearTimeout(this.stopStreamingTimer)
    this.stopStreamingTimer = null
    this.offEvent()
    this.viewers.clear()
  }

  private command<T = JsonRecord>(method: string, params: JsonRecord = {}): Promise<T> {
    return this.cdp.command<T>(method, params, this.sessionId)
  }

  private async onEvent(event: CdpEvent): Promise<void> {
    if (event.method === 'Page.screencastFrame') {
      const data = event.params?.data
      const frameSessionId = event.params?.sessionId
      if (typeof data === 'string') {
        const packet = framePacket(data, this.width, this.height)
        for (const viewer of this.viewers) sendFrame(viewer, packet)
      }
      if (typeof frameSessionId === 'number') {
        const timer = setTimeout(() => {
          void this.command('Page.screencastFrameAck', { sessionId: frameSessionId }).catch(() => {})
        }, FRAME_INTERVAL_MS)
        timer.unref?.()
      }
      return
    }
    if (event.method === 'Page.frameStartedLoading') {
      this.loading = true
      this.broadcastState()
    } else if (event.method === 'Page.frameStoppedLoading' || event.method === 'Page.loadEventFired') {
      this.loading = false
      await this.updateState()
    } else if (event.method === 'Page.frameNavigated') {
      const frame = event.params?.frame as { parentId?: unknown; url?: unknown } | undefined
      if (frame && !frame.parentId && typeof frame.url === 'string') this.currentUrl = frame.url
      await this.updateState()
    } else if (event.method === 'Page.javascriptDialogOpening') {
      const message = typeof event.params?.message === 'string' ? event.params.message : ''
      const dialogType = typeof event.params?.type === 'string' ? event.params.type : 'alert'
      const defaultPrompt = typeof event.params?.defaultPrompt === 'string' ? event.params.defaultPrompt : ''
      for (const viewer of this.viewers) send(viewer, { type: 'dialog', dialogType, message, defaultPrompt })
    }
  }

  private async updateState(): Promise<void> {
    try {
      const [history, title] = await Promise.all([
        this.command<{ currentIndex: number; entries: { id: number; url?: string }[] }>('Page.getNavigationHistory'),
        this.command<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression: 'document.title', returnByValue: true }),
      ])
      this.canGoBack = history.currentIndex > 0
      this.canGoForward = history.currentIndex < history.entries.length - 1
      const current = history.entries[history.currentIndex]
      if (typeof current?.url === 'string') this.currentUrl = current.url
      if (typeof title.result?.value === 'string') this.title = title.result.value
    } catch {
      /* 탐색 중 execution context가 교체되는 짧은 구간 — 다음 lifecycle 이벤트에서 다시 읽는다 */
    }
    this.broadcastState()
  }

  private broadcastState(): void {
    const state: BrowserServerMessage = {
      type: 'state',
      url: this.currentUrl,
      title: this.title,
      loading: this.loading,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
    }
    for (const viewer of this.viewers) send(viewer, state)
  }
}

class BrowserRuntime {
  private account: string
  private process: ChildProcess | null = null
  private cdp: CdpTransport | null = null
  private pages = new Map<string, BrowserPage>()
  private startPromise: Promise<void> | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private offTargetEvents: (() => void) | null = null

  constructor(account: string) { this.account = account }

  async page(tabId: string, initialUrl: string): Promise<BrowserPage> {
    this.touch()
    await this.start()
    const existing = this.pages.get(tabId)
    if (existing) return existing
    const cdp = this.cdp!
    const created = await cdp.command<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
    const attached = await cdp.command<{ sessionId: string }>('Target.attachToTarget', { targetId: created.targetId, flatten: true })
    const page = new BrowserPage(tabId, created.targetId, attached.sessionId, cdp)
    this.pages.set(tabId, page)
    try {
      await page.initialize(initialUrl)
      return page
    } catch (error) {
      this.pages.delete(tabId)
      page.dispose()
      await cdp.command('Target.closeTarget', { targetId: created.targetId }).catch(() => {})
      throw error
    }
  }

  async closeTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId)
    if (!page) return
    this.pages.delete(tabId)
    page.dispose()
    if (this.cdp) await this.cdp.command('Target.closeTarget', { targetId: page.targetId }).catch(() => {})
    this.touch()
  }

  viewerClosed(page: BrowserPage, ws: WebSocket): void {
    page.removeViewer(ws)
    this.touch()
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    for (const page of this.pages.values()) page.dispose()
    this.pages.clear()
    const cdp = this.cdp
    this.cdp = null
    this.offTargetEvents?.()
    this.offTargetEvents = null
    if (cdp) {
      void cdp.command('Browser.close').catch(() => {})
      cdp.close()
    }
    if (this.process && !this.process.killed) this.process.kill('SIGTERM')
    this.process = null
    this.startPromise = null
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      const hasViewers = [...this.pages.values()].some((page) => page.viewers.size > 0)
      if (hasViewers) this.touch()
      else this.dispose()
    }, IDLE_TIMEOUT_MS)
    this.idleTimer.unref?.()
  }

  private start(): Promise<void> {
    if (this.cdp) return Promise.resolve()
    if (this.startPromise) return this.startPromise
    this.startPromise = this.launch().catch((error) => {
      this.dispose()
      throw error
    })
    return this.startPromise
  }

  private async launch(): Promise<void> {
    const executable = resolveBrowserExecutable()
    if (!executable) throw new Error('서버 Chromium이 없습니다. Mew 서버에서 `./mew browser install`을 한 번 실행하세요.')
    const profileDir = path.join(PROFILE_ROOT, browserProfileKey(this.account))
    fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 })
    try { fs.chmodSync(profileDir, 0o700) } catch { /* chmod가 없는 파일시스템은 상위 DATA_DIR 경계에 의존한다 */ }
    const portFile = path.join(profileDir, 'DevToolsActivePort')
    try { fs.unlinkSync(portFile) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }

    const args = [
      '--headless=new',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--password-store=basic',
      '--window-size=1280,800',
      'about:blank',
    ]
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox')
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    this.process = child
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-8_000) })
    const exit = new Promise<never>((_resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => reject(new Error(`서버 Chromium이 시작 중 종료되었습니다 (${signal ?? code ?? 'unknown'}).${stderr.trim() ? `\n${stderr.trim()}` : ''}`)))
    })
    const endpoint = await Promise.race([waitForDevToolsPort(portFile), exit])
    this.cdp = await CdpTransport.connect(endpoint)
    // 원격 화면에서 누른 다운로드가 서버 홈 어딘가에 조용히 쌓이면 안 된다. 파일 전달 UX를
    // 별도로 만들기 전까지 명시적으로 막는다.
    await this.cdp.command('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})
    await this.cdp.command('Target.setDiscoverTargets', { discover: true })
    this.offTargetEvents = this.cdp.onEvent((event) => { void this.targetEvent(event) })
    child.once('exit', () => {
      if (this.process !== child) return
      this.cdp?.close()
      this.cdp = null
      this.process = null
      this.startPromise = null
      for (const page of this.pages.values()) {
        for (const viewer of page.viewers) {
          send(viewer, { type: 'fatal', message: '서버 Chromium이 종료되었습니다.' })
          viewer.close(1012, 'browser exited')
        }
        page.dispose()
      }
      this.pages.clear()
    })
  }

  private async targetEvent(event: CdpEvent): Promise<void> {
    if (event.method === 'Target.targetDestroyed' && typeof event.params?.targetId === 'string') {
      for (const [tabId, page] of this.pages) {
        if (page.targetId !== event.params.targetId) continue
        this.pages.delete(tabId)
        for (const viewer of page.viewers) {
          send(viewer, { type: 'fatal', message: '이 Chromium 탭이 닫혔습니다. 다시 연결합니다.' })
          viewer.close(1012, 'browser tab closed')
        }
        page.dispose()
        break
      }
      return
    }
    if (event.method !== 'Target.targetCreated' || !this.cdp) return
    const info = event.params?.targetInfo as { targetId?: unknown; type?: unknown; openerId?: unknown; url?: unknown; title?: unknown } | undefined
    if (!info || info.type !== 'page' || typeof info.targetId !== 'string' || typeof info.openerId !== 'string') return
    const opener = [...this.pages.values()].find((page) => page.targetId === info.openerId)
    if (!opener) return
    if (opener.viewers.size === 0) {
      await this.cdp.command('Target.closeTarget', { targetId: info.targetId }).catch(() => {})
      return
    }
    const tabId = crypto.randomUUID()
    try {
      const attached = await this.cdp.command<{ sessionId: string }>('Target.attachToTarget', { targetId: info.targetId, flatten: true })
      const page = new BrowserPage(tabId, info.targetId, attached.sessionId, this.cdp)
      this.pages.set(tabId, page)
      await page.initialize('about:blank')
      const url = typeof info.url === 'string' && info.url ? info.url : 'about:blank'
      const title = typeof info.title === 'string' && info.title ? info.title : url
      opener.announcePopup({ id: tabId, url, title })
    } catch {
      await this.cdp.command('Target.closeTarget', { targetId: info.targetId }).catch(() => {})
    }
  }
}

async function waitForDevToolsPort(file: string): Promise<string> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const [port, websocketPath] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)
      if (/^\d+$/.test(port) && websocketPath?.startsWith('/')) return `ws://127.0.0.1:${port}${websocketPath}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('서버 Chromium 디버그 포트가 열리지 않았습니다.')
}

const runtimes = new Map<string, BrowserRuntime>()

export function browserRuntimeFor(account: string): BrowserRuntime {
  let runtime = runtimes.get(account)
  if (!runtime) {
    runtime = new BrowserRuntime(account)
    runtimes.set(account, runtime)
  }
  return runtime
}

export function disposeAllBrowserRuntimes(): void {
  for (const runtime of runtimes.values()) runtime.dispose()
  runtimes.clear()
}
