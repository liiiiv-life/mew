import { createElement, useEffect, useId, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DialogFrame } from '@mew/ui'
import { uiText, subscribeUiLocale } from '@mew/ui/i18n-core'

let nextId = 0
let queue: Promise<unknown> = Promise.resolve()

// Keep Mermaid's global configuration and temporary SVG work sequential.
function renderDiagram(source: string) {
  const result = queue.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
      maxTextSize: 50000, maxEdges: 500, theme: 'default',
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'flowchart', 'theme', 'themeCSS', 'dompurifyConfig'],
      htmlLabels: false, flowchart: { htmlLabels: false } })
    return mermaid.render(`mew-diagram-${++nextId}`, source)
  })
  queue = result.catch(() => {})
  return result
}

function DiagramDialog({ source, onClose }: { source: string; onClose: () => void }) {
  const titleId = useId()
  const [result, setResult] = useState<{ source: string; svg?: string; error?: boolean }>()
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void renderDiagram(source).then(({ svg }) => {
        if (!cancelled) setResult({ source, svg })
      }).catch(() => { if (!cancelled) setResult({ source, error: true }) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [source])
  const current = result?.source === source ? result : undefined
  const header =
    createElement('div', { className: 'diagram-dialog-header' },
      createElement('span', { id: titleId }, uiText('다이어그램')),
      createElement('button', { type: 'button', className: 'diagram-dialog-close', onClick: onClose,
        'aria-label': uiText('닫기'), 'data-tip': uiText('닫기'),
        dangerouslySetInnerHTML: { __html: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg>' } }))
  const preview = createElement('div', { className: 'diagram-preview', role: current?.svg ? 'img' : 'status',
      'aria-label': current?.svg ? uiText('다이어그램') : undefined,
      ...(current?.svg ? { dangerouslySetInnerHTML: { __html: current.svg } } : {}) },
    current?.svg ? undefined : uiText(current?.error
      ? '다이어그램을 표시할 수 없습니다. 코드를 확인해 주세요.' : '다이어그램을 불러오는 중…'))
  // oxlint-disable-next-line react/no-children-prop -- createElement must satisfy DialogFrame's required children type.
  return createElement(DialogFrame, { labelledBy: titleId, onClose, className: 'diagram-dialog', children: createElement('div', { className: 'diagram-dialog-content' }, header, preview) })
}

export function createDiagramPreview(dom: HTMLElement, pre: HTMLElement, language: unknown, source: string) {
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'diagram-source-toggle'
  toggle.contentEditable = 'false'
  toggle.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'
  let root: Root | undefined
  let host: HTMLElement | undefined
  let lastSource = source
  const close = () => {
    root?.render(null)
    toggle.setAttribute('aria-expanded', 'false')
  }
  const render = () => root?.render(createElement(DiagramDialog, { source: lastSource, onClose: close }))
  const labels = () => {
    toggle.setAttribute('aria-label', uiText('다이어그램 보기'))
    toggle.dataset.tip = uiText('다이어그램 보기')
    if (toggle.getAttribute('aria-expanded') === 'true') render()
  }
  toggle.setAttribute('aria-haspopup', 'dialog')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.addEventListener('mousedown', event => event.preventDefault())
  toggle.addEventListener('click', () => {
    if (!root) {
      host = document.createElement('div')
      document.body.appendChild(host)
      root = createRoot(host)
    }
    toggle.focus()
    toggle.setAttribute('aria-expanded', 'true')
    render()
  })
  dom.append(toggle)
  labels()
  const unsubscribe = subscribeUiLocale(labels)
  function update(language: unknown, source: string) {
    lastSource = source
    const active = language === 'mermaid'
    toggle.hidden = !active
    dom.classList.toggle('is-diagram', active)
    pre.hidden = false
    if (!active) close()
    else if (toggle.getAttribute('aria-expanded') === 'true') render()
  }
  update(language, source)
  return { update, contains: (target: Node) => toggle.contains(target),
    destroy: () => { root?.unmount(); host?.remove(); unsubscribe() } }
}
