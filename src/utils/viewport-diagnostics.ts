import { getVirtualKeyboard } from '@mew/ui/virtual-keyboard'
import { getUiLocale, subscribeUiLocale } from '@mew/ui/i18n-core'

const labels = {
  ko: ['화면 진단 복사', '복사됨', '진단 파일 저장됨'],
  en: ['Copy viewport diagnostics', 'Copied', 'Diagnostics downloaded'],
  ja: ['画面診断をコピー', 'コピーしました', '診断ファイルを保存しました'],
  'zh-CN': ['复制屏幕诊断', '已复制', '已保存诊断文件'],
} as const

/** Explicit opt-in, local-only diagnostics. Never reads text, URLs or input values. */
export function installViewportDiagnostics(win: Window = window) {
  const doc = win.document
  const button = doc.createElement('button')
  button.type = 'button'
  button.dataset.viewportDiagnostics = ''
  button.dataset.tip = button.ariaLabel = labels[getUiLocale()][0]
  const stopLocale = subscribeUiLocale(() => { button.dataset.tip = button.ariaLabel = labels[getUiLocale()][0] })
  button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>'
  button.style.cssText = 'position:fixed;z-index:2147483000;top:calc(env(safe-area-inset-top,0px) + 112px);right:8px;width:40px;height:40px;display:grid;place-items:center;padding:0;border:1px solid var(--color-edge-bright);border-radius:6px;background:var(--color-surface-solid,#202030);color:var(--color-ink,#fff);cursor:pointer;touch-action:manipulation'
  const status = doc.createElement('span')
  status.setAttribute('role', 'status')
  status.style.cssText = 'position:absolute;right:44px;white-space:nowrap;font-size:12px;background:var(--color-surface-solid,#202030);color:var(--color-ink,#fff);padding:2px 6px;border-radius:4px'
  status.hidden = true
  button.append(status)
  const safeArea = doc.createElement('span')
  safeArea.setAttribute('aria-hidden', 'true')
  safeArea.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
  button.append(safeArea)
  doc.body.append(button)

  const keyboard = getVirtualKeyboard(win)
  const started = win.performance.now()
  const round = (n: number) => Math.round(n * 100) / 100
  const rect = (box: DOMRectReadOnly) => ({ x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) })
  const metrics = () => {
    const viewport = win.visualViewport
    return {
      fullscreen: Boolean(doc.fullscreenElement),
      inner: { width: win.innerWidth, height: win.innerHeight },
      root: { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight, box: rect(doc.documentElement.getBoundingClientRect()) },
      visual: viewport ? { width: round(viewport.width), height: round(viewport.height), scale: viewport.scale, offsetTop: round(viewport.offsetTop), offsetLeft: round(viewport.offsetLeft) } : null,
      keyboard: keyboard ? { overlaysContent: keyboard.overlaysContent, box: rect(keyboard.boundingRect) } : null,
      appHeight: doc.documentElement.style.getPropertyValue('--app-height'),
      focusedTag: doc.activeElement?.tagName ?? null,
    }
  }
  const events: { ms: number; event: string; metrics: ReturnType<typeof metrics> }[] = []
  const record = (event: string) => {
    events.push({ ms: round(win.performance.now() - started), event, metrics: metrics() })
    if (events.length > 80) events.shift()
  }
  const targets: [EventTarget, string][] = [
    [win, 'resize'], [doc, 'fullscreenchange'], [doc, 'focusin'], [doc, 'focusout'],
    ...(win.visualViewport ? [[win.visualViewport, 'resize'], [win.visualViewport, 'scroll']] as [EventTarget, string][] : []),
    ...(keyboard ? [[keyboard, 'geometrychange']] as [EventTarget, string][] : []),
  ]
  const onEvent = (event: Event) => record(`${event.target === win.visualViewport ? 'visual:' : ''}${event.type}`)
  for (const [target, event] of targets) target.addEventListener(event, onEvent)
  const observer = new ResizeObserver(() => record('root:resize'))
  observer.observe(doc.documentElement)
  record('start')

  function snapshot() {
    const elements: object[] = []
    const ids = new Map<Element, number>()
    const describe = (element: Element) => {
      let id = ids.get(element)
      if (id !== undefined) return id
      id = elements.length
      ids.set(element, id)
      const style = win.getComputedStyle(element)
      elements.push({
        tag: element.tagName,
        box: rect(element.getBoundingClientRect()),
        style: {
          backgroundColor: style.backgroundColor, color: style.color,
          position: style.position, zIndex: style.zIndex, opacity: style.opacity,
          overflowX: style.overflowX, overflowY: style.overflowY,
          transform: style.transform, contain: style.contain, isolation: style.isolation,
          hasBackgroundImage: style.backgroundImage !== 'none',
          hasFilter: style.filter !== 'none', hasBackdropFilter: style.backdropFilter !== 'none',
        },
      })
      return id
    }
    const regions = Object.fromEntries([
      ['html', doc.documentElement], ['body', doc.body], ['root', doc.getElementById('root')],
      ['workspace', doc.querySelector('.mew-workspace')], ['composer', doc.querySelector('[data-agent-composer]')],
      ['fullscreen', doc.fullscreenElement], ['focused', doc.activeElement],
    ].map(([name, element]) => [name, element instanceof Element ? describe(element) : null]))
    // Sampling the painted area's DOM lets a screenshot's band be compared to
    // actual hit targets and their styles without collecting their contents.
    const viewport = win.visualViewport
    const bottom = Math.min(win.innerHeight, (viewport?.offsetTop ?? 0) + (viewport?.height ?? win.innerHeight))
    const width = Math.min(win.innerWidth, doc.documentElement.clientWidth)
    const xs = [0.1, 0.5, 0.9].map(fraction => Math.max(0, Math.min(width - 1, Math.floor(width * fraction))))
    const rows: { y: number; hits: number[][] }[] = []
    for (let y = 0; y < bottom; y += Math.max(4, Math.ceil(bottom / 240))) {
      rows.push({ y, hits: xs.map(x => doc.elementsFromPoint(x, y)
        .filter(element => !button.contains(element)).slice(0, 3).map(describe)) })
    }
    const safe = win.getComputedStyle(safeArea)
    return {
      format: 'mew-viewport-diagnostics/1',
      userAgent: win.navigator.userAgent, devicePixelRatio: win.devicePixelRatio,
      screen: { width: win.screen.width, height: win.screen.height, availHeight: win.screen.availHeight, orientation: win.screen.orientation?.type },
      safeArea: { top: safe.paddingTop, right: safe.paddingRight, bottom: safe.paddingBottom, left: safe.paddingLeft },
      current: metrics(), events: events.slice(), regions, elements, samples: { xs, rows },
    }
  }

  let disposed = false
  let busy = false
  let timer = 0
  const keepFocus = (event: Event) => event.preventDefault()
  button.addEventListener('pointerdown', keepFocus)
  const onClick = async () => {
    if (busy) return
    busy = true
    // Capture before clipboard/download browser UI can change the viewport.
    const report = JSON.stringify(snapshot())
    let message: 1 | 2 = 1
    try {
      await win.navigator.clipboard.writeText(report)
    } catch {
      if (disposed) return
      message = 2
      const url = URL.createObjectURL(new Blob([report], { type: 'application/json' }))
      const link = doc.createElement('a')
      link.href = url
      link.download = 'mew-viewport-diagnostics.json'
      link.click()
      URL.revokeObjectURL(url)
    } finally { busy = false }
    if (disposed) return
    status.textContent = labels[getUiLocale()][message]
    status.hidden = false
    win.clearTimeout(timer)
    timer = win.setTimeout(() => { status.hidden = true }, 2000)
  }
  button.addEventListener('click', onClick)
  return () => {
    disposed = true
    win.clearTimeout(timer)
    observer.disconnect()
    stopLocale()
    for (const [target, event] of targets) target.removeEventListener(event, onEvent)
    button.removeEventListener('pointerdown', keepFocus)
    button.removeEventListener('click', onClick)
    button.remove()
  }
}
