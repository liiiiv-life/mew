import { watchSocketAccess } from './access-socket.ts'
import { canUse } from './access-policy.ts'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Server, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import express from 'express'
import multer from 'multer'
import { chromium, type Browser, type BrowserContext, type Page, type ElementHandle, type CDPSession, type Dialog, type Frame, type FileChooser, type Download, type Request } from 'playwright-core'
import { WebSocket, WebSocketServer } from 'ws'
import { authOf, requireFeature, resolveAuth, type RequestAuth } from './reqAuth.ts'
import { acquireBrowserProfile, domBrowserHeadless } from './browser-dom-profile.ts'
import { createDomNetworkGate } from './browser-dom-network.ts'
import { domBrowserExecutable } from './browser-dom-executable.ts'
import { domRecorderSource } from './browser-dom-recorder-source.ts'

export { domBrowserExecutable } from './browser-dom-executable.ts'

export const DOM_BROWSER_WS = '/api/browser-dom/ws'
const sessions = new Map<string, DomBrowserSession>()
const require = createRequire(import.meta.url)
const recorder = domRecorderSource(
  fs.readFileSync(path.join(path.dirname(require.resolve('@rrweb/record')), 'record.umd.cjs'), 'utf8'),
  fs.readFileSync(new URL('./browser-dom-recorder.js', import.meta.url), 'utf8'),
)
const TTL = 20 * 60_000
const MAX_RESOURCE = 5 * 1024 * 1024
const MAX_CACHE = 32 * 1024 * 1024

export function domTargetAllowed(raw: string, hosts: readonly string[], callbackOrigin: string): boolean {
  try {
    const u = new URL(raw)
    if (u.username || u.password) return false
    if (u.origin === callbackOrigin && ['http:', 'https:'].includes(u.protocol)) return true
    return u.protocol === 'https:' && (!u.port || u.port === '443') && hosts.some((host) =>
      host.startsWith('*.') ? u.hostname.endsWith(host.slice(1)) && u.hostname !== host.slice(2) : u.hostname === host)
  } catch { return false }
}

function callbackFromLogin(raw: string): string {
  const callback = new URL(new URL(raw).searchParams.get('redirect_uri') ?? '')
  if (!['http:', 'https:'].includes(callback.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname) || callback.username || callback.password) {
    throw new Error('로그인 callback이 서버 loopback 주소가 아닙니다')
  }
  return callback.origin
}

type Asset = { type: string; body: Buffer }
// Structural browser types keep DOM globals out of the Node server compilation.
type RemoteNode = { nodeType: number; tagName?: string; scrollingElement?: RemoteNode; scrollTo: (options: { left: number; top: number; behavior: 'instant' }) => void }
export type DomInput = { kind: 'click' | 'input' | 'key' | 'scroll' | 'resize' | 'snapshot' | 'navigate' | 'back' | 'forward' | 'reload' | 'stop' | 'dialog' | 'hover' | 'close'; url?: string; accept?: boolean; button?: 'left' | 'middle' | 'right'; modifiers?: string[]; id?: number; value?: string; key?: string; x?: number; y?: number; width?: number; height?: number; generation?: number; frame?: string; scrollToken?: string; scrollRevision?: number }

export class DomBrowserSession {
  readonly account: string
  readonly job: string
  readonly url: string
  readonly hosts: readonly string[]
  readonly callbackOrigin: string
  readonly id = crypto.randomBytes(24).toString('base64url')
  get expiresAt(): number { return this.general && !this.authJob ? Number.MAX_SAFE_INTEGER : this.createdAt + TTL }
  private createdAt = Date.now()
  readonly general: boolean
  readonly authJob?: string
  private releaseProfile?: () => Promise<void>
  private cdp?: CDPSession
  private dialog?: Dialog
  private chooser?: { id: string; value: FileChooser }
  private downloads = new Map<string, Download>()
  private stateTimer?: ReturnType<typeof setInterval>
  private lastState = ''
  private stateRevision = 0
  private loading = false
  private navigationMessage?: string
  private navigationRequest?: Request
  private navigationAttempt = 0
  browser?: Browser
  context?: BrowserContext
  page?: Page
  socket?: WebSocket
  generation = 0
  private frames = new Map<Frame, { id: string; generation: number; document: string }>()
  private startPromise?: Promise<void>
  private closed = false
  private timer: ReturnType<typeof setTimeout>
  private disconnectTimer?: ReturnType<typeof setTimeout>
  private assets = new Map<string, Promise<Asset | null>>()
  private assetBytes = 0
  private inputQueue: DomInput[] = []
  private drainingInput = false
  private inputEpoch = 0
  private inputAbort?: AbortController
  private inputKind?: DomInput['kind']
  private lastNotice = ''
  private network?: Awaited<ReturnType<typeof createDomNetworkGate>>

  constructor(account: string, job: string, url: string, hosts: readonly string[], callbackOrigin: string, general = false, existingPage?: Page, authJob?: string) {
    this.authJob = authJob
    this.general = general
    this.page = existingPage
    this.account = account
    this.job = job
    this.url = url
    this.hosts = hosts
    this.callbackOrigin = callbackOrigin
    this.timer = setTimeout(() => { void (this.authJob ? closeDomBrowserJob(this.account, this.authJob) : this.close()) }, general && !authJob ? 10 * 60_000 : TTL)
    this.timer.unref()
  }

  send(message: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    const data = JSON.stringify(message)
    if (this.socket.bufferedAmount + Buffer.byteLength(data) > 12 * 1024 * 1024) {
      this.socket.close(1013, 'DOM stream is too large; reconnect')
      return
    }
    this.socket.send(data)
  }

  notice(message: string): void {
    if (this.lastNotice === message) return
    this.lastNotice = message
    this.send({ type: 'notice', message })
  }

  assetUrl(raw: string, base: string): string {
    if (/^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(raw)) return raw
    if (raw.startsWith('#')) return raw
    try {
      const url = new URL(raw, base).href
      if (!this.allowed(url)) return ''
      return `/api/browser-dom/${this.id}/asset/${crypto.createHash('sha256').update(url).digest('hex')}`
    } catch { return '' }
  }

  // Replay is inert: only images/fonts/CSS resources already loaded by Chromium may
  // be read through authenticated Mew routes. No source URL is a fetch capability.
  sanitize(value: unknown, base: string): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sanitize(item, base))
    if (!value || typeof value !== 'object') return value
    const out: Record<string, unknown> = {}
    const node = value as Record<string, unknown>
    for (const [key, item] of Object.entries(node)) {
      if (key === 'attributes' && item && typeof item === 'object' && !Array.isArray(item)) {
        const attrs: Record<string, unknown> = {}
        for (const [name, content] of Object.entries(item)) {
          const lower = name.toLowerCase()
          if (lower.startsWith('on') || ['srcdoc', 'srcset', 'action', 'formaction', 'target', 'formtarget', 'nonce', 'integrity', 'http-equiv', 'content', 'autofocus'].includes(lower)) continue
          if (['src', 'href', 'xlink:href', 'poster', 'background'].includes(lower)) {
            attrs[name] = typeof content === 'string' ? this.assetUrl(content, base) : ''
          } else if (typeof content === 'string' && (lower === 'style' || lower === '_csstext')) {
            attrs[name] = this.css(content, base)
          } else attrs[name] = content
        }
        out[key] = attrs
      } else if (key === 'textContent' && typeof item === 'string' && node.isStyle) out[key] = this.css(item, base)
      else if (key === 'fontSource' && typeof item === 'string' && !node.buffer) out[key] = this.css(item, base)
      else if ((key === 'rule' || key === 'value') && typeof item === 'string') out[key] = this.css(item, base)
      else out[key] = this.sanitize(item, base)
    }
    // These surfaces cannot execute, navigate, or request documents in the viewer.
    if (typeof node.tagName === 'string' && ['script', 'iframe', 'object', 'embed', 'base', 'meta', 'video', 'audio', 'canvas'].includes(node.tagName)) {
      out.tagName = 'div'
      out.attributes = node.tagName === 'iframe' ? { ...(out.attributes as object), 'data-mew-frame': 'true', 'data-mew-unsupported': 'iframe' } : { 'data-mew-unsupported': node.tagName }
      out.childNodes = []
    }
    return out
  }

  private css(css: string, base: string): string {
    return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_all, _quote, url: string) => `url("${this.assetUrl(url, base)}")`)
      .replace(/@import\s+(['"])(.*?)\1/gi, (_all, _quote, url: string) => `@import url("${this.assetUrl(url, base)}")`)
  }

  async asset(id: string): Promise<Asset | null> { return await this.assets.get(id) ?? null }

  async start(): Promise<void> {
    if (!this.startPromise) this.startPromise = this.launch()
    return this.startPromise
  }

  private async launch(): Promise<void> {
    const adoptedPage = !!this.page
    const executablePath = domBrowserExecutable()
    if (!executablePath) throw new Error('서버 Chromium이 없습니다. mew 폴더에서 npx playwright-core install chromium을 실행해 주세요.')
    if (this.general) {
      const profile = await acquireBrowserProfile(this.account, executablePath)
      this.context = profile.context
      this.releaseProfile = profile.release
      if (this.closed) { await profile.release(); return }
      this.page ??= await this.context.newPage()
    } else {
      this.network = await createDomNetworkGate((url) => domTargetAllowed(url, this.hosts, this.callbackOrigin))
      if (this.closed) { await this.network.close(); return }
      this.browser = await chromium.launch({
        executablePath, headless: domBrowserHeadless(), chromiumSandbox: true,
        proxy: { server: this.network.server, bypass: '<-loopback>' },
        args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      })
      if (this.closed) { await this.browser.close(); return }
      this.context = await this.browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block', acceptDownloads: false })
      this.context.setDefaultTimeout(4000)
      await this.context.route('**/*', async (route) => {
        if (domTargetAllowed(route.request().url(), this.hosts, this.callbackOrigin)) await route.continue()
        else { this.notice('로그인 페이지가 허용되지 않은 주소에 연결하려고 했습니다.'); await route.abort('blockedbyclient') }
      })
      await this.context.routeWebSocket('**/*', (socket) => { this.notice('이 검증판은 로그인 페이지의 WebSocket 연결을 아직 지원하지 않습니다.'); socket.close() })
      this.page = await this.context.newPage()
    }
    const page = this.page
    this.cdp = await this.context.newCDPSession(page)
    page.once('close', () => { this.send({ type: 'closed', tabId: this.job }); void this.close() })
    page.on('dialog', (dialog) => {
      this.dialog = dialog
      this.send({ type: 'dialog', dialogType: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() })
    })
    page.on('filechooser', (chooser) => {
      this.chooser = { id: crypto.randomUUID(), value: chooser }
      this.send({ type: 'filechooser', id: this.chooser.id, multiple: chooser.isMultiple() })
    })
    page.on('download', (download) => {
      if (!this.general || this.downloads.size >= 20) { void download.cancel(); this.notice('다운로드를 더 받을 수 없습니다. 탭을 다시 열어 주세요.'); return }
      const id = crypto.randomUUID()
      this.downloads.set(id, download)
      void download.path().then((file) => {
        if (file && !this.closed) this.send({ type: 'download', id, name: download.suggestedFilename(), url: `/api/browser-dom/${this.id}/download/${id}` })
      }).catch(() => this.notice('파일을 내려받지 못했습니다. 다시 시도해 주세요.'))
    })
    page.on('popup', (popup) => {
      if (!this.general) { this.notice('인증 전용 창에서는 별도 팝업을 지원하지 않습니다. 일반 브라우저에서 열어 주세요.'); void popup.close(); return }
      if ([...sessions.values()].filter((session) => session.account === this.account).length >= 20) { this.notice('브라우저 탭은 최대 20개까지 열 수 있습니다.'); void popup.close(); return }
      const child = new DomBrowserSession(this.account, crypto.randomUUID(), popup.url(), [], '', true, popup, this.authJob)
      sessions.set(child.id, child)
      void child.start().then(() => { this.send({ type: 'popup', tab: child.info() }) }).catch(() => child.close())
    })
    page.on('framenavigated', (frame) => {
      // srcdoc/document replacements can reuse a Window without rerunning init scripts.
      if (/^(https?:|about:)/.test(frame.url())) void frame.evaluate(recorder).catch(() => {})
      if (frame !== page.mainFrame()) return
      void this.publishState()
    })
    page.on('request', (request) => {
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return
      this.navigationRequest = request
      this.navigationMessage = undefined
      void this.publishState(true, true)
    })
    page.on('requestfailed', (request) => {
      if (request !== this.navigationRequest || request.failure()?.errorText === 'net::ERR_ABORTED') return
      this.navigationFailed(request.failure()?.errorText ?? '', request.url())
    })
    page.on('domcontentloaded', () => { void this.publishState(false) })
    this.stateTimer = setInterval(() => { if (this.socket) void this.publishState() }, 1000)
    this.stateTimer.unref()
    page.on('response', (response) => {
      const url = response.url()
      const contentType = response.headers()['content-type'] ?? ''
      if (!this.allowed(url) || !/^(image\/|font\/|text\/css|application\/(?:font|x-font|vnd.ms-fontobject))/.test(contentType)) return
      if (Number(response.headers()['content-length'] ?? 0) > MAX_RESOURCE) return
      const id = crypto.createHash('sha256').update(url).digest('hex')
      const previous = this.assets.get(id)
      this.assets.delete(id)
      if (previous) void previous.then((asset) => { if (asset) this.assetBytes -= asset.body.length })
      while (this.assets.size >= 256) {
        const oldest = this.assets.keys().next().value!
        const removed = this.assets.get(oldest)!
        this.assets.delete(oldest)
        void removed.then((asset) => { if (asset) this.assetBytes -= asset.body.length })
      }
      this.assets.set(id, (async () => {
        try {
          let body = await response.body()
          if (this.closed || body.length > MAX_RESOURCE) return null
          if (this.assetBytes + body.length > MAX_CACHE) { this.notice('이 페이지의 자원이 브라우저 메모리 한도를 넘었습니다. 일부 이미지·폰트가 표시되지 않을 수 있습니다.'); return null }
          if (contentType.startsWith('text/css')) body = Buffer.from(this.css(body.toString(), url))
          this.assetBytes += body.length
          return { type: contentType, body }
        } catch { return null }
      })())
    })
    page.on('framedetached', (frame) => {
      const state = this.frames.get(frame)
      if (state) this.send({ type: 'frame-closed', frame: state.id })
      this.frames.delete(frame)
    })
    await page.exposeBinding('__mewDomEmit', async ({ frame }, event: unknown, document: string) => {
      if (this.closed) return
      let state = this.frames.get(frame)
      if (!state) { state = { id: frame === page.mainFrame() ? 'main' : crypto.randomUUID(), generation: 0, document: '' }; this.frames.set(frame, state) }
      if (state.document !== document) { state.document = document; state.generation++; if (frame === page.mainFrame()) this.generation = state.generation }
      let parent: string | undefined
      let parentNode: number | undefined
      const parentFrame = frame.parentFrame()
      if (parentFrame) {
        parent = this.frames.get(parentFrame)?.id
        const element = await frame.frameElement().catch(() => null)
        if (!element || !parent) return
        try { parentNode = await parentFrame.evaluate((node) => (globalThis as unknown as { rrwebRecord: { record: { mirror: { getId: (node: unknown) => number } } } }).rrwebRecord?.record.mirror.getId(node), element) } finally { await element.dispose() }
      }
      this.send({ type: 'event', frame: state.id, parent, parentNode, generation: state.generation, event: this.sanitize(event, frame.url()) })
    })
    await page.addInitScript({ content: recorder })
    // A popup may be a blank window whose opener will write or navigate it later.
    // Never navigate an adopted Page, even when its current URL is about:blank.
    // Initial network loading must not block address changes or popup attachment.
    if (!adoptedPage) void this.navigate(() => page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }), this.url)
    else await Promise.all(page.frames().map((frame) => frame.evaluate(recorder).catch(() => {})))
    await this.publishState()
  }

  async attach(socket: WebSocket): Promise<void> {
    this.clearInputQueue()
    clearTimeout(this.disconnectTimer)
    if (this.general && !this.authJob) clearTimeout(this.timer)
    this.socket?.close(1000, 'Reconnected')
    this.socket = socket
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.clearInputQueue()
      this.socket = undefined
      this.disconnectTimer = setTimeout(() => { void this.close() }, this.general ? 10 * 60_000 : 20_000)
      this.disconnectTimer.unref()
    })
    socket.on('error', () => {})
    socket.on('message', (raw) => {
      if (this.closed || this.socket !== socket || socket.readyState !== WebSocket.OPEN) return
      let input: DomInput
      try { input = JSON.parse(raw.toString()) } catch { socket.close(1008); return }
      if (!input || typeof input !== 'object' || !['click', 'input', 'key', 'scroll', 'resize', 'snapshot', 'navigate', 'back', 'forward', 'reload', 'stop', 'dialog', 'hover', 'close'].includes(input.kind)) { socket.close(1008); return }
      // Hover is transient: never let an obsolete hit-target wait delay a newer gesture.
      if (this.inputKind === 'hover') this.inputAbort?.abort()
      if (input.kind === 'close') { void this.close(); return }
      if (input.kind === 'dialog' || input.kind === 'stop') {
        if (input.kind === 'stop') this.clearInputQueue()
        void this.input(input).catch(() => {})
        return
      }
      if (['navigate', 'back', 'forward', 'reload'].includes(input.kind)) {
        this.clearInputQueue()
        const epoch = this.inputEpoch
        void this.start().then(() => {
          if (this.socket === socket && this.inputEpoch === epoch) return this.input(input)
        }).catch(() => this.notice('주소를 확인하고 다시 시도해 주세요.'))
        return
      }
      // Replace only consecutive state updates for the same target. A click/key
      // or another field is an ordering barrier (especially input -> Enter).
      const last = this.inputQueue.at(-1)
      if (last && ['input', 'scroll', 'resize', 'hover'].includes(input.kind) && last.kind === input.kind
        && last.frame === input.frame && last.generation === input.generation
        && (input.kind === 'hover' || last.id === input.id)) {
        this.inputQueue[this.inputQueue.length - 1] = input
      } else if (this.inputQueue.length >= 100) {
        this.clearInputQueue()
        this.send({ type: 'error', message: '브라우저 입력이 밀려 연결을 멈췄습니다. 다시 연결한 뒤 입력 내용을 확인해 주세요.' })
        socket.close(1013, 'Input queue is full; reconnect')
        return
      } else this.inputQueue.push(input)
      void this.drainInputQueue()
    })
    try {
      const existing = !!this.startPromise
      await this.start()
      await this.publishState(this.loading, true)
      if (this.dialog) this.send({ type: 'dialog', dialogType: this.dialog.type(), message: this.dialog.message(), defaultValue: this.dialog.defaultValue() })
      if (existing) await this.input({ kind: 'snapshot' })
    } catch (error) {
      this.send({ type: 'error', message: error instanceof Error && error.message.startsWith('서버 Chromium') ? error.message : '서버 브라우저를 열지 못했습니다. Chromium 설치와 서버 실행 환경을 확인해 주세요.' })
      await this.close()
    }
  }

  private clearInputQueue(): void {
    this.inputEpoch++
    this.inputQueue.length = 0
    this.inputAbort?.abort()
  }

  private async drainInputQueue(): Promise<void> {
    if (this.drainingInput) return
    this.drainingInput = true
    try {
      while (this.inputQueue.length && !this.closed) {
        const input = this.inputQueue.shift()!
        const epoch = this.inputEpoch
        const controller = new AbortController()
        this.inputAbort = controller
        this.inputKind = input.kind
        try {
          await this.start()
          if (epoch === this.inputEpoch) await this.input(input, controller.signal)
        } catch {
          if (epoch === this.inputEpoch && input.kind !== 'hover') this.send({ type: 'notice', message: '조작을 반영하지 못했습니다. 화면이 바뀌었다면 다시 시도해 주세요.' })
        } finally { this.inputAbort = undefined; this.inputKind = undefined }
      }
    } finally { this.drainingInput = false }
  }

  async upload(id: string, files: Express.Multer.File[]): Promise<void> {
    const chooser = this.chooser
    if (!chooser || chooser.id !== id || this.closed || !files.length || (!chooser.value.isMultiple() && files.length > 1)) throw new Error('파일 선택을 다시 시작해 주세요')
    this.chooser = undefined
    await chooser.value.setFiles(files.map((file) => ({ name: path.basename(file.originalname), mimeType: file.mimetype, buffer: file.buffer })))
  }
  async download(id: string): Promise<{ path: string; name: string } | null> {
    const download = this.downloads.get(id)
    if (!download) return null
    const file = await download.path().catch(() => null)
    return file ? { path: file, name: download.suggestedFilename() } : null
  }

  allowed(url: string): boolean {
    if (!this.general) return domTargetAllowed(url, this.hosts, this.callbackOrigin)
    try { const target = new URL(url); return ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password } catch { return false }
  }

  info() {
    const current = this.page?.url()
    const url = (this.loading ? this.navigationRequest?.url() : undefined)
      || (current && /^https?:/.test(current) ? current : this.navigationRequest?.url() || this.url)
    return { id: this.job, url, title: '', streamUrl: `${DOM_BROWSER_WS}?session=${this.id}` }
  }

  private navigationFailed(error: string, rawUrl: string): void {
    const host = new URL(rawUrl).host
    const reason = /ERR_CONNECTION_REFUSED/.test(error) ? '연결이 거부되었습니다. 대상 서버가 실행 중인지 확인해 주세요.'
      : /ERR_NAME_NOT_RESOLVED/.test(error) ? '주소를 찾을 수 없습니다.'
      : /ERR_.*TIMED_OUT|Timeout/.test(error) ? '응답 시간이 초과되었습니다. 대상 서버와 네트워크를 확인해 주세요.'
      : '페이지를 열지 못했습니다. 주소와 네트워크를 확인해 주세요.'
    this.navigationMessage = `서버에서 ${host}: ${reason}`
    void this.publishState(false, true)
  }

  private async navigate(action: () => Promise<unknown>, url: string): Promise<void> {
    const attempt = ++this.navigationAttempt
    this.navigationMessage = undefined
    // Reading the old document's title can wait behind its scripts or dialog.
    // Start navigation immediately; status collection must never gate leaving it.
    void this.publishState(true, true)
    try { await action() }
    catch (error) {
      if (attempt === this.navigationAttempt && !String(error).includes('ERR_ABORTED')) this.navigationFailed(String(error), url)
    }
    finally { if (attempt === this.navigationAttempt) await this.publishState(false) }
  }

  private async publishState(loading = this.loading, force = false): Promise<void> {
    if (!this.page || this.closed) return
    const revision = ++this.stateRevision
    this.loading = loading
    try {
      const history = await this.cdp?.send('Page.getNavigationHistory')
      const url = this.info().url
      const state = { type: 'page', ...this.info(), title: await this.page.title(), host: new URL(url).host, loading, message: this.navigationMessage,
        canGoBack: !!history && history.currentIndex > 0, canGoForward: !!history && history.currentIndex < history.entries.length - 1 }
      const encoded = JSON.stringify(state)
      if (revision !== this.stateRevision || this.closed) return
      if (force || encoded !== this.lastState) { this.lastState = encoded; this.send(state) }
    } catch { /* Page may be between documents. */ }
  }

  async input(input: DomInput, signal?: AbortSignal): Promise<void> {
    const page = this.page
    if (!page || this.closed || !input || typeof input !== 'object') return
    if (input.kind === 'close') { this.send({ type: 'closed', tabId: this.job }); await this.close(); return }
    if (input.kind === 'dialog') {
      const dialog = this.dialog
      this.dialog = undefined
      if (input.accept) await dialog?.accept(typeof input.value === 'string' ? input.value.slice(0, 16_384) : undefined)
      else await dialog?.dismiss()
      return
    }
    if (input.kind === 'stop') { this.navigationAttempt++; await this.cdp?.send('Page.stopLoading'); await this.publishState(false); return }
    if (['navigate', 'back', 'forward', 'reload'].includes(input.kind)) {
      if (!this.general) return
      if (input.kind === 'navigate') {
        if (typeof input.url !== 'string' || input.url.length > 8192 || !this.allowed(input.url)) throw new Error('HTTP(S) 주소가 필요합니다')
        await this.navigate(() => page.goto(input.url!, { waitUntil: 'domcontentloaded', timeout: 30_000 }), input.url)
      } else if (input.kind === 'back') await this.navigate(() => page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }), page.url())
      else if (input.kind === 'forward') await this.navigate(() => page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }), page.url())
      else {
        const url = this.info().url
        await this.navigate(() => page.url().startsWith('chrome-error:')
          ? page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          : page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }), url)
      }
      await this.publishState(); return
    }
    if (input.kind === 'resize') {
      const width = Math.max(320, Math.min(1600, Math.round(Number(input.width) || 900)))
      const height = Math.max(240, Math.min(1200, Math.round(Number(input.height) || 700)))
      await page.setViewportSize({ width, height }); return
    }
    if (input.kind === 'snapshot') {
      await Promise.all(page.frames().filter((frame) => !input.frame || this.frames.get(frame)?.id === input.frame).map((frame) => frame.evaluate('window.__mewDomSnapshot?.()').catch(() => {}))); return
    }
    const frame = input.frame ? [...this.frames].find(([, state]) => state.id === input.frame)?.[0] : page.mainFrame()
    if (!frame || input.generation !== this.frames.get(frame)?.generation || !Number.isSafeInteger(input.id) || input.id! < 0) return
    const handle = await frame.evaluateHandle((id) => (globalThis as unknown as { __mewDomNode: (id: number) => RemoteNode | null }).__mewDomNode?.(id), input.id!)
    const element = handle.asElement() as ElementHandle | null
    try {
      signal?.throwIfAborted()
      if (input.kind === 'scroll' && Number.isFinite(input.x) && Number.isFinite(input.y)) {
        await handle.evaluate((node, pos) => {
          const target = node?.nodeType === 9 ? node.scrollingElement : node
          if (!node || !target) return
          const scope = globalThis as unknown as { __mewDomScrollRevisions?: WeakMap<object, { token: string; revision: number }> }
          if (pos.token && pos.revision) scope.__mewDomScrollRevisions?.set(node, { token: pos.token, revision: pos.revision })
          target.scrollTo({ left: pos.x, top: pos.y, behavior: 'instant' })
        }, {
          x: Math.max(0, Math.min(100_000, input.x!)), y: Math.max(0, Math.min(100_000, input.y!)),
          token: typeof input.scrollToken === 'string' && input.scrollToken.length <= 64 ? input.scrollToken : undefined,
          revision: Number.isSafeInteger(input.scrollRevision) && input.scrollRevision! > 0 ? input.scrollRevision : undefined,
        })
        return
      }
      if (!element) return
      if (input.kind === 'click') await element.click({ timeout: 2500, signal, button: input.button === 'middle' ? 'middle' : 'left', modifiers: Array.isArray(input.modifiers) ? input.modifiers.filter((key): key is 'Alt' | 'ControlOrMeta' | 'Shift' => ['Alt', 'ControlOrMeta', 'Shift'].includes(key)) : [] })
      // A delayed hover may refer to an element the user has already scrolled past.
      // Playwright's default auto-scroll would pull the page back to that element.
      else if (input.kind === 'hover') await element.hover({ scroll: 'none', timeout: 150, signal })
      else if (input.kind === 'input' && typeof input.value === 'string' && input.value.length <= 16_384) {
        const tag = await element.evaluate((node) => (node as unknown as RemoteNode).tagName)
        if (tag === 'SELECT') await element.selectOption(input.value, { timeout: 2500, signal })
        else await element.fill(input.value, { timeout: 2500, signal })
      } else if (input.kind === 'key' && typeof input.key === 'string' && ['Enter', 'Tab', 'Shift+Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(input.key)) {
        await element.press(input.key, { timeout: 2500, signal })
      }
    } finally { await handle.dispose() }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clearInputQueue()
    clearTimeout(this.timer)
    clearTimeout(this.disconnectTimer)
    clearInterval(this.stateTimer)
    sessions.delete(this.id)
    this.socket?.close(1000, 'Browser closed')
    this.assets.clear()
    await Promise.all([...this.downloads.values()].map(async (download) => { await download.cancel().catch(() => {}); await download.delete().catch(() => {}) }))
    this.downloads.clear()
    if (this.general) { await this.page?.close().catch(() => {}); await this.releaseProfile?.() }
    await this.browser?.close().catch(() => {})
    await this.network?.close()
  }
}

export async function createDomBrowserSession(account: string, job: string, url: string, hosts: readonly string[]): Promise<string> {
  if (!account) throw new Error('로그인 계정이 없습니다')
  const callback = callbackFromLogin(url)
  if (!domTargetAllowed(url, hosts, callback)) throw new Error('허용되지 않은 로그인 주소입니다')
  const existing = [...sessions.values()].find((session) => session.account === account && session.job === job && session.url === url)
  if (existing) return `${DOM_BROWSER_WS}?session=${existing.id}`
  for (const session of sessions.values()) if (session.account === account && session.job === job) await session.close()
  if ([...sessions.values()].filter((session) => session.account === account && !session.general).length >= 3) throw new Error('열린 로그인 브라우저를 먼저 닫아 주세요')
  const session = new DomBrowserSession(account, job, url, hosts, callback)
  sessions.set(session.id, session)
  return `${DOM_BROWSER_WS}?session=${session.id}`
}

/** OAuth shares the normal server profile, but owns its tabs independently of BrowserPanel. */
export async function createDomBrowserAuthSession(account: string, job: string, url: string): Promise<string> {
  if (!account || !job) throw new Error('로그인 작업 정보가 없습니다')
  const existing = [...sessions.values()].find((session) => session.account === account && session.authJob === job && session.job === job)
  if (existing?.url === url) return existing.info().streamUrl
  if (existing) await closeDomBrowserJob(account, job)
  const jobs = new Set([...sessions.values()].filter((session) => session.account === account && session.authJob).map((session) => session.authJob))
  if (jobs.size >= 3) throw new Error('열린 로그인 브라우저를 먼저 닫아 주세요')
  const session = new DomBrowserSession(account, job, url, [], '', true, undefined, job)
  if (url.length > 8192 || !session.allowed(url)) { await session.close(); throw new Error('HTTP(S) 로그인 주소가 필요합니다') }
  sessions.set(session.id, session)
  return session.info().streamUrl
}

function generalTabs(account: string): DomBrowserSession[] { return [...sessions.values()].filter((session) => session.general && !session.authJob && session.account === account) }

export function openDomBrowserTab(account: string, tabId: string, url: string): DomBrowserSession {
  if (!account || !/^[\w-]{1,64}$/.test(tabId)) throw new Error('탭 정보가 올바르지 않습니다')
  const existing = generalTabs(account).find((session) => session.job === tabId)
  if (existing) return existing
  const session = new DomBrowserSession(account, tabId, url, [], '', true)
  if (url.length > 8192 || !session.allowed(url)) { void session.close(); throw new Error('HTTP(S) 주소가 필요합니다') }
  if (generalTabs(account).length >= 20) { void session.close(); throw new Error('브라우저 탭은 최대 20개까지 열 수 있습니다') }
  sessions.set(session.id, session)
  return session
}

export function createDomBrowserRoutes(): express.Express {
  const app = express()
  app.use(requireFeature('browser'))
  app.get('/tabs', (req, res) => res.json(generalTabs(authOf(req).email ?? '').map((session) => session.info())))
  app.post('/tabs', (req, res) => {
    try {
      if (typeof req.body?.id !== 'string' || typeof req.body?.url !== 'string') { res.sendStatus(400); return }
      res.json(openDomBrowserTab(authOf(req).email ?? '', req.body.id, req.body.url).info())
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '브라우저를 열지 못했습니다' }) }
  })
  app.delete('/tabs/:tabId', async (req, res) => {
    const session = generalTabs(authOf(req).email ?? '').find((tab) => tab.job === req.params.tabId)
    await session?.close()
    res.json({ ok: true })
  })
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 4, fields: 0, parts: 4 } })
  app.use('/:id/upload/:chooser', (req, res, next) => {
    const session = sessions.get(String(req.params.id))
    if (!session || session.account !== authOf(req).email) { res.sendStatus(403); return }
    next()
  })
  app.post('/:id/upload/:chooser', upload.array('files', 4), async (req, res) => {
    try { await sessions.get(String(req.params.id))?.upload(String(req.params.chooser), req.files as Express.Multer.File[]); res.json({ ok: true }) }
    catch { res.status(400).json({ error: '파일 선택을 다시 시작해 주세요' }) }
  })
  app.get('/:id/download/:download', async (req, res) => {
    const session = sessions.get(String(req.params.id))
    if (!session || session.account !== authOf(req).email) { res.sendStatus(403); return }
    const file = await session.download(String(req.params.download))
    if (!file) { res.sendStatus(404); return }
    res.setHeader('Cache-Control', 'no-store')
    res.download(file.path, file.name)
  })
  app.get('/:id/asset/:asset', async (req, res) => {
    const session = sessions.get(String(req.params.id))
    if (!session || session.account !== authOf(req).email || Date.now() >= session.expiresAt) { res.sendStatus(403); return }
    const asset = await session.asset(String(req.params.asset))
    if (!asset) { res.sendStatus(404); return }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    res.type(asset.type).send(asset.body)
  })
  return app
}

export function domConnectionAllowed(req: IncomingMessage, auth: RequestAuth, account: string): boolean {
  if (auth.mustChangePassword || !canUse(auth, 'browser') || auth.email !== account) return false
  try {
    const origin = new URL(req.headers.origin ?? '')
    const secure = (req.socket as { encrypted?: boolean } | undefined)?.encrypted || req.headers['x-forwarded-proto'] === 'https'
    return origin.protocol === (secure ? 'https:' : 'http:') && origin.host === req.headers.host
  } catch { return false }
}

export function attachDomBrowserWebSocket(server: Server | Http2SecureServer, getAuth = resolveAuth): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024, perMessageDeflate: false })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== DOM_BROWSER_WS) return
    const session = sessions.get(url.searchParams.get('session') ?? '')
    if (!session || Date.now() >= session.expiresAt || !domConnectionAllowed(req, getAuth(req), session.account)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      watchSocketAccess(ws, req, request => domConnectionAllowed(request, getAuth(request), session.account))
      let alive = true
      ws.on('pong', () => { alive = true })
      const heartbeat = setInterval(() => {
        if (!alive || !domConnectionAllowed(req, getAuth(req), session.account)) { ws.terminate(); return }
        alive = false
        ws.ping()
      }, 30_000)
      heartbeat.unref()
      ws.once('close', () => clearInterval(heartbeat))
      void session.attach(ws)
    })
  })
  server.once('close', () => { wss.close(); void closeDomBrowsers() })
}

export async function closeDomBrowsers(): Promise<void> { await Promise.all([...sessions.values()].map((session) => session.close())) }

export async function closeDomBrowserJob(account: string, job: string): Promise<void> {
  await Promise.all([...sessions.values()].filter((session) => session.account === account && (session.job === job || session.authJob === job)).map((session) => session.close()))
}
