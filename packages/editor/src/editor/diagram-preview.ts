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

export function createDiagramPreview(dom: HTMLElement, pre: HTMLElement, language: unknown, source: string, editable = true) {
  const preview = document.createElement('div')
  preview.className = 'diagram-preview'
  preview.contentEditable = 'false'
  preview.setAttribute('role', 'img')
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'diagram-source-toggle'
  toggle.contentEditable = 'false'
  let editing = false, active = false, destroyed = false, revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSource = '', lastLanguage: unknown
  const labels = () => {
    toggle.textContent = uiText(editing ? '다이어그램 보기' : editable ? '코드 편집' : '코드 보기')
    toggle.setAttribute('aria-expanded', String(editing))
    preview.setAttribute('aria-label', uiText('다이어그램'))
  }
  const visibility = () => { pre.hidden = active && !editing; labels() }
  toggle.addEventListener('mousedown', event => event.preventDefault())
  toggle.addEventListener('click', () => { editing = !editing; visibility() })
  dom.append(toggle, preview)
  const unsubscribe = subscribeUiLocale(labels)
  function update(language: unknown, source: string) {
    if (lastLanguage === language && lastSource === source) return
    lastLanguage = language; lastSource = source
    active = language === 'mermaid'
    toggle.hidden = preview.hidden = !active
    dom.classList.toggle('is-diagram', active)
    visibility()
    clearTimeout(timer)
    const current = ++revision
    if (!active) return
    preview.textContent = uiText('다이어그램을 불러오는 중…')
    timer = setTimeout(() => {
      void renderDiagram(source).then(({ svg }) => {
        if (destroyed || revision !== current) return
        preview.innerHTML = svg
      }).catch(() => {
        if (destroyed || revision !== current) return
        preview.textContent = uiText('다이어그램을 표시할 수 없습니다. 코드를 확인해 주세요.')
        editing = true; visibility()
      })
    }, 250)
  }
  update(language, source)
  return { update, contains: (target: Node) => toggle.contains(target) || preview.contains(target),
    destroy: () => { destroyed = true; ++revision; clearTimeout(timer); unsubscribe() } }
}
