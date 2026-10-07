import { openMewSocket } from './remote-transport.ts'
import { uiText } from '@mew/ui/i18n-core'
import { getBinding, matchesShortcut, numberedTabIndex, adjacentPanelTabDirection } from '@mew/shortcuts'
import { Replayer } from '@rrweb/replay'
import { EventType, IncrementalSource, ReplayerEvents, NodeType, type eventWithTime } from '@rrweb/types'

export type DomBrowserTab = { id: string; url: string; title: string; streamUrl: string }
export type DomBrowserStatus = { state: 'connecting' | 'ready' | 'error'; message?: string; host?: string; url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean; popup?: DomBrowserTab; closed?: boolean; fileChooser?: { id: string; multiple: boolean }; download?: { id: string; name: string; url: string }; dialog?: { dialogType: string; message: string; defaultValue: string } }
export type DomBrowserController = (() => void) & { command: (kind: string, extra?: Record<string, unknown>) => void }

type Packet = { type: string; frame?: string; parent?: string; parentNode?: number; generation: number; event: eventWithTime }
type ScrollPosition = { x: number; y: number; revision: number }
type ScrollUpdate = { id: number; x: number; y: number; mewScroll?: { token: string; revision: number } }
const scrollElement = (node: Node) => node.nodeType === 9 ? (node as Document).scrollingElement : node as HTMLElement

type Surface = { generation: number; parent?: string; parentNode?: number; renderer?: ReturnType<typeof createFrame>; queue: eventWithTime[] }

/** Original scripts execute exclusively in Chromium; each remote frame has an inert replica. */
export function mountDomBrowser(root: HTMLElement, streamUrl: string, status: (value: DomBrowserStatus) => void): DomBrowserController {
  const url = new URL(streamUrl, location.href)
  if (url.origin !== location.origin || url.pathname !== '/api/browser-dom/ws') throw new Error(uiText("브라우저 주소가 올바르지 않습니다"))
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = openMewSocket(url)
  const surfaces = new Map<string, Surface>()
  let disposed = false
  let terminalError = false
  let pageState: Partial<DomBrowserStatus> = {}
  let notice: string | undefined
  let mounting = false
  const send = (message: Record<string, unknown>) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)) }
  const report = (value: DomBrowserStatus) => status({ ...pageState, ...value })
  const destroy = (id: string) => {
    for (const [childId, child] of surfaces) if (child.parent === id) destroy(childId)
    surfaces.get(id)?.renderer?.dispose()
    surfaces.delete(id)
  }
  const mountPending = () => {
    if (disposed || mounting) return
    mounting = true
    try {
      for (const [id, surface] of surfaces) {
        if (surface.renderer) continue
        const parent = surface.parent ? surfaces.get(surface.parent)?.renderer : undefined
        const host = id === 'main' ? root : parent?.node(surface.parentNode!) as HTMLElement | null
        if (!host || !host.isConnected || (id !== 'main' && !host.hasAttribute('data-mew-frame'))) continue
        if (id !== 'main') {
          host.removeAttribute('data-mew-unsupported')

        }
        surface.renderer = createFrame(host, (value) => send({ ...value, frame: id, generation: surface.generation }), () => {
          if (id === 'main') report({ state: 'ready', message: notice })
          // A parent full snapshot replaces iframe placeholders. Rebuild child snapshots.
          for (const [childId, child] of surfaces) if (child.parent === id && child.renderer) {
            child.renderer.dispose(); child.renderer = undefined; child.queue = []
            send({ kind: 'snapshot', frame: childId })
          }
          queueMicrotask(mountPending)
        }, () => queueMicrotask(mountPending), (event) => {
          // Replica iframe keys do not bubble to Mew. While expanded, give the
          // shared overlay stack first refusal before forwarding Esc remotely.
          if (!root.closest('[data-dock-maximized]')) return false
          return !window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, repeat: event.repeat }))
        })
        const queued = surface.queue.splice(0)
        for (const event of queued) surface.renderer.event(event)
      }
    } finally { mounting = false }
  }
  const resize = () => {
    const rect = root.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) send({ kind: 'resize', width: rect.width, height: rect.height })
  }
  const observer = new ResizeObserver(resize)
  observer.observe(root)
  socket.onopen = () => { report({ state: 'connecting' }); resize() }
  socket.onmessage = (message) => {
    if (disposed) return
    try {
      const packet = JSON.parse(message.data)
      if (packet.type === 'error') { terminalError = true; report({ state: 'error', message: packet.message }); return }
      if (packet.type === 'notice') { notice = packet.message; report({ state: surfaces.get('main')?.renderer ? 'ready' : 'connecting', message: notice }); return }
      if (packet.type === 'popup') { report({ state: 'ready', popup: packet.tab }); return }
      if (packet.type === 'closed') { terminalError = true; report({ state: 'error', closed: true }); return }
      if (packet.type === 'filechooser') { report({ state: 'ready', fileChooser: packet }); return }
      if (packet.type === 'download') { report({ state: 'ready', download: packet }); return }
      if (packet.type === 'dialog') { report({ state: 'ready', dialog: packet }); return }
      if (packet.type === 'page') {
        pageState = { url: packet.url, title: packet.title, host: packet.host, canGoBack: packet.canGoBack, canGoForward: packet.canGoForward }
        notice = packet.message
        report({ state: packet.message ? 'error' : packet.loading || !surfaces.get('main')?.renderer ? 'connecting' : 'ready', message: notice }); return
      }
      if (packet.type === 'frame-closed') { destroy(packet.frame); return }
      if (packet.type !== 'event') return
      const { frame = 'main', parent, parentNode, generation, event } = packet as Packet
      let surface = surfaces.get(frame)
      if (surface && surface.generation !== generation) { destroy(frame); surface = undefined }
      if (!surface) {
        if (surfaces.size >= 100) return
        surface = { generation, parent, parentNode, queue: [] }; surfaces.set(frame, surface)
      }
      if (surface.renderer) surface.renderer.event(event)
      else {
        if (event.type === EventType.FullSnapshot) surface.queue = surface.queue.filter((value) => value.type === EventType.Meta)
        if (surface.queue.length < 1000) surface.queue.push(event)
        mountPending()
      }
    } catch { terminalError = true; report({ state: 'error', message: uiText("브라우저 화면을 복원하지 못했습니다. 다시 연결해 주세요.") }) }
  }
  socket.onerror = () => { terminalError = true; report({ state: 'error', message: uiText("브라우저에 연결하지 못했습니다. 다시 연결해 주세요.") }) }
  socket.onclose = () => { if (!disposed && !terminalError) report({ state: 'error', message: uiText("연결이 끊겼습니다. 다시 연결해 주세요.") }) }
  return Object.assign(() => {
    disposed = true
    observer.disconnect()
    for (const id of surfaces.keys()) destroy(id)
    socket.close()
    root.replaceChildren()
  }, { command: (kind: string, extra: Record<string, unknown> = {}) => send({ kind, ...extra }) })
}

function createFrame(root: HTMLElement, send: (message: Record<string, unknown>) => void, ready: () => void, changed: () => void, escape: (event: KeyboardEvent) => boolean) {
  let player: Replayer | undefined
  let meta: eventWithTime | undefined
  let disposeInput: (() => void) | undefined
  const drafts = new Set<number>()
  const scrollToken = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16)).join('-')
  let scrollRevision = 0
  let scrollPositions = new WeakMap<Node, ScrollPosition>()
  const scrollTimers = new Map<Node, ReturnType<typeof setTimeout>>()
  const applyScroll = (data: ScrollUpdate) => {
    const node = player?.getMirror().getNode(data.id)
    if (!node) return
    const previous = scrollPositions.get(node)
    // A local move owns this node until the source has processed that revision.
    // Check at replay time too: a newer gesture may follow packet arrival.
    if (previous?.revision && (data.mewScroll?.token !== scrollToken || data.mewScroll.revision < previous.revision)) return
    const element = scrollElement(node)
    if (!element) return
    element.scrollTo({ left: data.x, top: data.y, behavior: 'instant' })
    // Read back the clamped position. Its asynchronous scroll event is an echo,
    // not another user gesture. Never animate a streamed scroll sample.
    scrollPositions.set(node, { x: element.scrollLeft, y: element.scrollTop, revision: previous?.revision ?? 0 })
  }
  const bindInput = () => {
    disposeInput?.()
    const doc = player?.iframe.contentDocument
    if (!doc || !player) return
    const mirror = player.getMirror()
    const idOf = (event: Event) => mirror.getId(event.composedPath()[0] as Node)
    const click = (event: MouseEvent) => {
      if (event.button !== 0 && event.button !== 1) return
      const node = event.composedPath()[0] as HTMLElement
      const id = idOf(event)
      if (id < 0) return
      const editable = node.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=file]),textarea,select,[contenteditable=true]')
      if (!editable) event.preventDefault()
      event.stopPropagation()
      send({ kind: 'click', id, button: event.button === 1 ? 'middle' : 'left', modifiers: [event.altKey && 'Alt', (event.ctrlKey || event.metaKey) && 'ControlOrMeta', event.shiftKey && 'Shift'].filter(Boolean) })
    }
    const input = (event: Event) => {
      const node = event.composedPath()[0] as HTMLInputElement
      if (!node.matches?.('input,textarea,select,[contenteditable=true]')) return
      if (node.type === 'checkbox' || node.type === 'radio') return
      const id = idOf(event)
      if (id < 0) return
      drafts.add(id)
      send({ kind: 'input', id, value: node.isContentEditable ? node.textContent ?? '' : node.value })
    }
    const key = (event: KeyboardEvent) => {
      if (!event.isComposing && (matchesShortcut(event, getBinding('toggleMemo')) || numberedTabIndex(event) !== null || adjacentPanelTabDirection(event) !== null)) {
        const forwarded = new KeyboardEvent('keydown', {
          key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
          altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, bubbles: true, cancelable: true,
        })
        if (!window.dispatchEvent(forwarded)) { event.preventDefault(); event.stopPropagation(); return }
      }
      if (event.isComposing || !['Enter', 'Escape', 'Tab'].includes(event.key)) return
      if (event.key === 'Escape' && escape(event)) { event.preventDefault(); event.stopPropagation(); return }
      if (event.key === 'Enter' && (event.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (event.key !== 'Tab') event.preventDefault()
      send({ kind: 'key', id: idOf(event), key: event.key === 'Tab' && event.shiftKey ? 'Shift+Tab' : event.key })
    }
    const submit = (event: Event) => event.preventDefault()
    let hoverTimer: ReturnType<typeof setTimeout> | undefined
    const scroll = (event: Event) => {
      clearTimeout(hoverTimer)
      const node = event.target as Node
      const id = mirror.getId(node)
      const element = scrollElement(node)
      if (id < 0 || !element) return
      const previous = scrollPositions.get(node)
      const x = element.scrollLeft, y = element.scrollTop
      if (previous?.x === x && previous.y === y) return
      const revision = ++scrollRevision
      scrollPositions.set(node, { x, y, revision })
      clearTimeout(scrollTimers.get(node))
      // Each scroll container has its own timer; nested panes must not cancel
      // the final position of the document or of another pane.
      scrollTimers.set(node, setTimeout(() => {
        scrollTimers.delete(node)
        send({ kind: 'scroll', id, x, y, scrollToken, scrollRevision: revision })
      }, 50))
    }
    const hover = (event: MouseEvent) => {
      const id = idOf(event)
      clearTimeout(hoverTimer)
      if (id >= 0) hoverTimer = setTimeout(() => send({ kind: 'hover', id }), 80)
    }
    const blur = (event: Event) => drafts.delete(idOf(event))
    doc.addEventListener('mouseover', hover, true)
    doc.addEventListener('click', click, true)
    doc.addEventListener('auxclick', click, true)
    doc.addEventListener('input', input, true)
    doc.addEventListener('change', input, true)
    doc.addEventListener('keydown', key, true)
    doc.addEventListener('submit', submit, true)
    doc.addEventListener('scroll', scroll, true)
    doc.addEventListener('focusout', blur, true)
    disposeInput = () => {
      for (const timer of scrollTimers.values()) clearTimeout(timer)
      scrollTimers.clear()
      clearTimeout(hoverTimer)
      doc.removeEventListener('mouseover', hover, true)
      doc.removeEventListener('click', click, true)
      doc.removeEventListener('auxclick', click, true)
      doc.removeEventListener('input', input, true)
      doc.removeEventListener('change', input, true)
      doc.removeEventListener('keydown', key, true)
      doc.removeEventListener('submit', submit, true)
      doc.removeEventListener('scroll', scroll, true)
      doc.removeEventListener('focusout', blur, true)
    }
  }

  return {
    node: (id: number) => player?.getMirror().getNode(id),
    event: (incoming: eventWithTime) => {
      let event = incoming
      // Each child document has its own renderer. rrweb also emits same-origin
      // iframe documents in the parent stream; replaying one into a DIV placeholder
      // makes rrweb rebuild (and clear) the parent's Document.
      if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation) {
        if (event.data.isAttachIframe) return
        event = { ...event, data: { ...event.data, adds: event.data.adds.filter((mutation) => mutation.node.type !== NodeType.Document) } }
      }
      // Use receipt time; server and phone clocks need not agree.
      event.timestamp = Date.now()
      // Route scroll samples through the replay timeline so preceding DOM
      // mutations exist, while bypassing rrweb's smooth-scroll animation.
      if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Scroll) {
        event = { type: EventType.Custom, timestamp: event.timestamp, data: { tag: 'mew:scroll', payload: event.data } }
      }
      if (event.type === EventType.Meta) { meta = event; player?.addEvent(event); return }
      if (event.type === EventType.FullSnapshot && !player) {
        const rect = root.getBoundingClientRect()
        const initialMeta = meta ?? { type: EventType.Meta, timestamp: event.timestamp, data: { href: '', width: rect.width, height: rect.height } }
        player = new Replayer([initialMeta, event], {
          root, liveMode: true, mouseTail: false, showWarning: false, showDebug: false,
          triggerFocus: false, useVirtualDom: false, UNSAFE_replayCanvas: false,
          insertStyleRules: [
            '* { scroll-behavior: auto !important; }',
            ':where([data-mew-frame]) { display:inline-block; width:300px; height:150px; overflow:hidden; }',
            ':where([data-mew-frame][hidden]) { display:none; }',

            `[data-mew-unsupported="iframe"]::after,[data-mew-unsupported="canvas"]::after,[data-mew-unsupported="video"]::after,[data-mew-unsupported="audio"]::after,[data-mew-unsupported="object"]::after,[data-mew-unsupported="embed"]::after { content: ${JSON.stringify(uiText("이 콘텐츠는 표시할 수 없습니다"))}; display:block; padding:12px; color:#555; background:#f5f5f5; font:13px sans-serif; }`,
          ],
        })
        player.iframe.title = uiText("서버 웹페이지")
        player.iframe.setAttribute('sandbox', 'allow-same-origin')
        player.iframe.referrerPolicy = 'no-referrer'
        player.on(ReplayerEvents.FullsnapshotRebuilded, () => {
          scrollPositions = new WeakMap()
          bindInput()
          // rrweb restores snapshot offsets immediately after this callback.
          queueMicrotask(() => {
            const mirror = player?.getMirror()
            for (const id of mirror?.getIds() ?? []) {
              const node = mirror!.getNode(id)
              if (!node || (node.nodeType !== 9 && node.nodeType !== 1)) continue
              const element = scrollElement(node)
              if (element && (element.scrollLeft || element.scrollTop || node.nodeType === 9)) {
                scrollPositions.set(node, { x: element.scrollLeft, y: element.scrollTop, revision: 0 })
              }
            }
          })
          ready()
        })
        player.on(ReplayerEvents.CustomEvent, (event) => {
          const custom = event as Extract<eventWithTime, { type: EventType.Custom }>
          if (custom.data.tag === 'mew:scroll') applyScroll(custom.data.payload as ScrollUpdate)
        })
        player.on(ReplayerEvents.EventCast, changed)
        player.enableInteract()
        player.startLive(event.timestamp)
        return
      }
      if (!player) return
      // An older server echo must not replace a newer local keystroke (including IME).
      if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Input) {
        const node = player.getMirror().getNode(event.data.id) as HTMLInputElement | null
        if (drafts.has(event.data.id) || (node?.tagName === 'INPUT' && node.type === 'password')) return
      }
      player.addEvent(event)
    },
    dispose: () => { disposeInput?.(); player?.destroy(); root.replaceChildren() },
  }
}
