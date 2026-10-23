import { uiText } from '@mew/ui/i18n-core'
import { EditorView, runScopeHandlers, type Panel, type ViewUpdate } from '@codemirror/view'
import {
  SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery,
  replaceAll, replaceNext, selectMatches, setSearchQuery,
} from '@codemirror/search'

const COUNT_LIMIT = 10_000
const SELECTION_LIMIT = 1_000
const expandedPanels = new WeakMap<EditorView, boolean>()

// Iconoir NavArrow·Xmark·CheckSquare geometry for CodeMirror's DOM-owned panel.
const icons = {
  toggle: 'M9 6L15 12L9 18',
  prev: 'M6 15L12 9L18 15',
  next: 'M6 9L12 15L18 9',
  close: 'M7 17L17 7M7 7L17 17',
  select: 'M3 3H21V21H3ZM7 12.5L10 15.5L17 8.5',
}

export class CodeSearchPanel implements Panel {
  readonly dom: HTMLDivElement
  readonly top = true
  readonly pos = 80
  private readonly view: EditorView
  private readonly searchField: HTMLInputElement
  private readonly replaceField: HTMLInputElement
  private readonly replaceRow: HTMLDivElement
  private readonly count: HTMLSpanElement
  private readonly buttons = new Map<string, HTMLButtonElement>()
  private query: SearchQuery
  private expanded = false
  private matches: { from: number; to: number }[] = []
  private truncated = false

  constructor(view: EditorView) {
    this.view = view
    this.query = getSearchQuery(view.state)
    this.expanded = expandedPanels.get(view) ?? false
    const doc = view.dom.ownerDocument
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
      const node = doc.createElement(tag)
      node.className = className
      return node
    }
    const button = (name: string, content: string, action: () => void, icon = false) => {
      const node = element('button', 'mew-code-search-button')
      node.type = 'button'
      node.name = name
      if (icon) {
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
        for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value)
        const path = doc.createElementNS(svg.namespaceURI, 'path')
        path.setAttribute('d', content)
        svg.append(path)
        node.append(svg)
      } else {
        node.textContent = content
      }
      node.addEventListener('click', action)
      this.buttons.set(name, node)
      return node
    }
    const field = (name: string) => {
      const node = element('input', 'mew-code-search-input')
      node.type = 'text'
      node.name = name
      node.autocomplete = 'off'
      node.spellcheck = false
      node.setAttribute('autocapitalize', 'off')
      node.setAttribute('form', '')
      node.addEventListener('input', () => this.commit())
      return node
    }

    this.dom = element('div', 'cm-search mew-code-search')
    this.dom.setAttribute('role', 'search')
    this.dom.addEventListener('keydown', event => this.keydown(event))
    const row = element('div', 'mew-code-search-row')
    const toggle = button('toggleReplace', icons.toggle, () => {
      this.expanded = !this.expanded
      expandedPanels.set(view, this.expanded)
      this.refresh()
      this.view.requestMeasure()
    }, true)
    const searchBox = element('div', 'mew-code-search-field')
    this.searchField = field('search')
    this.searchField.setAttribute('main-field', 'true')
    const options = element('div', 'mew-code-search-options')
    for (const [name, text, option] of [
      ['case', 'Aa', 'caseSensitive'], ['word', 'ab', 'wholeWord'], ['re', '.*', 'regexp'],
    ] as const) {
      const control = button(name, text, () => this.commit({ [option]: !this.query[option] }))
      control.classList.add('mew-code-search-option')
      options.append(control)
    }
    searchBox.append(this.searchField, options)
    const actions = element('div', 'mew-code-search-actions')
    this.count = element('span', 'mew-code-search-count')
    this.count.setAttribute('role', 'status')
    this.count.setAttribute('aria-live', 'polite')
    this.count.setAttribute('aria-atomic', 'true')
    actions.append(this.count,
      button('prev', icons.prev, () => { findPrevious(view) }, true),
      button('next', icons.next, () => { findNext(view) }, true),
      button('select', icons.select, () => { selectMatches(view); view.focus() }, true),
      button('close', icons.close, () => { closeSearchPanel(view) }, true),
    )
    row.append(toggle, searchBox, actions)
    this.replaceRow = element('div', 'mew-code-search-row mew-code-search-replace')
    this.replaceField = field('replace')
    const replaceBox = element('div', 'mew-code-search-field')
    replaceBox.append(this.replaceField)
    const replacements = element('div', 'mew-code-search-actions')
    replacements.append(
      button('replace', '', () => { replaceNext(view) }),
      button('replaceAll', '', () => { replaceAll(view) }),
    )
    this.replaceRow.append(element('span', ''), replaceBox, replacements)
    this.dom.append(row, this.replaceRow)
    this.searchField.value = this.query.search
    this.replaceField.value = this.query.replace
    this.countMatches()
    this.refresh()
  }

  private commit(options: Partial<SearchQuery> = {}) {
    const query = new SearchQuery({ ...this.query, search: this.searchField.value, replace: this.replaceField.value, ...options })
    if (!query.eq(this.query)) this.view.dispatch({ effects: setSearchQuery.of(query) })
  }

  private keydown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) return
    if (runScopeHandlers(this.view, event, 'search-panel')) {
      event.preventDefault()
      if (event.key === 'Escape') event.stopPropagation()
    } else if (event.key === 'Enter' && event.target === this.searchField) {
      event.preventDefault()
      ;(event.shiftKey ? findPrevious : findNext)(this.view)
    } else if (event.key === 'Enter' && event.target === this.replaceField) {
      event.preventDefault()
      replaceNext(this.view)
    }
  }

  private countMatches() {
    this.matches = []
    this.truncated = false
    if (!this.query.valid) return
    const cursor = this.query.getCursor(this.view.state)
    for (let match = cursor.next(); !match.done; match = cursor.next()) {
      if (this.matches.length === COUNT_LIMIT) { this.truncated = true; break }
      this.matches.push({ from: match.value.from, to: match.value.to })
    }
  }

  private refresh() {
    const label = (name: string, text: string, tip = text) => {
      const node = this.buttons.get(name)!
      node.setAttribute('aria-label', text)
      node.dataset.tip = tip
      return node
    }
    const readOnly = this.view.state.readOnly
    const toggle = label('toggleReplace', uiText(this.expanded ? '바꾸기 접기' : '바꾸기 펼치기'))
    toggle.setAttribute('aria-expanded', String(this.expanded))
    toggle.style.visibility = readOnly ? 'hidden' : ''
    this.replaceRow.hidden = readOnly || !this.expanded
    this.dom.dataset.expanded = String(this.expanded)
    this.dom.setAttribute('aria-label', uiText('찾기'))
    for (const [field, text] of [[this.searchField, uiText('찾기')], [this.replaceField, uiText('바꾸기')]] as const) {
      field.placeholder = text
      field.setAttribute('aria-label', text)
    }
    label('case', uiText('대소문자 구분')).setAttribute('aria-pressed', String(this.query.caseSensitive))
    label('word', uiText('단어 단위')).setAttribute('aria-pressed', String(this.query.wholeWord))
    label('re', uiText('정규식 사용')).setAttribute('aria-pressed', String(this.query.regexp))
    label('prev', uiText('이전 매치'), uiText('이전 매치 (Shift+Enter)'))
    label('next', uiText('다음 매치'), uiText('다음 매치 (Enter)'))
    label('select', uiText('모두 선택'), this.matches.length > SELECTION_LIMIT ? `${uiText('모두 선택')} (≤1,000)` : uiText('모두 선택'))
    label('close', uiText('검색 닫기'), uiText('닫기 (Esc)'))
    label('replace', uiText('바꾸기'), uiText('현재 매치 바꾸기 (Enter)')).textContent = uiText('바꾸기')
    label('replaceAll', uiText('모두 바꾸기')).textContent = uiText('모두 바꾸기')
    const invalid = !!this.query.search && !this.query.valid
    this.searchField.setAttribute('aria-invalid', String(invalid))
    this.dom.dataset.invalid = String(invalid)
    const selection = this.view.state.selection.main
    const index = this.matches.findIndex(match => match.from === selection.from && match.to === selection.to)
    const count = invalid ? uiText('정규식 오류:').replace(/[:：]$/, '') : !this.query.search ? '' : !this.matches.length ? uiText('결과 없음') : `${index < 0 ? '–' : index + 1} / ${this.matches.length}${this.truncated ? '+' : ''}`
    if (this.count.textContent !== count) this.count.textContent = count
    for (const name of ['prev', 'next', 'select', 'replace', 'replaceAll']) {
      this.buttons.get(name)!.disabled = !this.matches.length || (readOnly && name.startsWith('replace'))
    }
    if (this.matches.length > SELECTION_LIMIT) this.buttons.get('select')!.disabled = true
  }

  mount() { this.searchField.select() }

  update(update: ViewUpdate) {
    const query = getSearchQuery(update.state)
    const changed = !query.eq(this.query)
    if (changed) {
      this.query = query
      if (this.searchField.value !== query.search) this.searchField.value = query.search
      if (this.replaceField.value !== query.replace) this.replaceField.value = query.replace
    }
    if (changed || update.docChanged) this.countMatches()
    if (changed || update.docChanged || update.selectionSet || update.transactions.some(tr => tr.reconfigured)) this.refresh()
  }
}

export const codeSearchPanelTheme = EditorView.theme({
  '.cm-panel.mew-code-search': {
    containerType: 'inline-size', containerName: 'mew-code-search',
    display: 'grid', gridTemplateColumns: '24px minmax(0, 1fr) auto',
    padding: '6px', fontFamily: 'var(--font-sans)', fontSize: '12px',
  },
  '.mew-code-search-row': { display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: 'subgrid', alignItems: 'center', gap: '4px' },
  '.mew-code-search-row[hidden]': { display: 'none' },
  '.mew-code-search-replace': { marginTop: '4px' },
  '.mew-code-search-field': {
    display: 'flex', alignItems: 'center', minWidth: '0', height: '30px',
    backgroundColor: 'var(--color-surface-deep)', border: '1px solid var(--color-edge-strong)', borderRadius: '5px',
  },
  '.mew-code-search-field:focus-within': { borderColor: 'var(--color-accent)' },
  '.mew-code-search[data-invalid=true] .mew-code-search-field:has([name=search])': { borderColor: 'var(--color-danger-strong)' },
  '.mew-code-search .mew-code-search-input': {
    flex: '1', minWidth: '0', width: '0', height: '100%', margin: '0', padding: '0 8px', border: 'none', outline: 'none',
    background: 'transparent', color: 'var(--color-ink)', font: 'inherit', caretColor: 'var(--color-ink)',
  },
  '.mew-code-search-input::placeholder': { color: 'var(--color-ink-muted)' },
  '.mew-code-search-options, .mew-code-search-actions': { display: 'flex', alignItems: 'center', gap: '2px' },
  '.mew-code-search-options': { paddingRight: '2px' },
  '.mew-code-search .mew-code-search-button': {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0',
    height: '26px', minWidth: '26px', padding: '0 5px', margin: '0', border: 'none', borderRadius: '4px',
    background: 'transparent', color: 'var(--color-ink-secondary)', font: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.mew-code-search .mew-code-search-button[name=close]': { position: 'static', padding: '0 5px', margin: '0', background: 'transparent', font: 'inherit' },
  '.mew-code-search .mew-code-search-button:hover:not(:disabled)': { backgroundColor: 'var(--color-surface-hover)', color: 'var(--color-ink)' },
  '.mew-code-search .mew-code-search-button:focus-visible': { outline: '2px solid var(--color-accent)', outlineOffset: '-2px' },
  '.mew-code-search .mew-code-search-button:disabled': { opacity: '0.35', cursor: 'default' },
  '.mew-code-search .mew-code-search-option': { fontFamily: 'var(--font-mono)', fontSize: '12px', height: '24px', minWidth: '24px', padding: '0 3px' },
  '.mew-code-search .mew-code-search-option[aria-pressed=true]': { color: 'var(--color-ink-on-accent)', backgroundColor: 'var(--color-accent)' },
  '.mew-code-search .mew-code-search-option[aria-pressed=true]:hover': { color: 'var(--color-ink-on-accent)', backgroundColor: 'var(--color-accent)' },
  '.mew-code-search-option[name=word]': { textDecoration: 'underline', textUnderlineOffset: '3px' },
  '.mew-code-search [name=toggleReplace] svg': { transform: 'rotate(0deg)' },
  '.mew-code-search[data-expanded=true] [name=toggleReplace] svg': { transform: 'rotate(90deg)' },
  '.mew-code-search-count': { minWidth: '44px', padding: '0 5px', color: 'var(--color-ink-secondary)', textAlign: 'center', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  '.mew-code-search[data-invalid=true] .mew-code-search-count': { color: 'var(--color-danger-strong)' },
  '@container mew-code-search (max-width: 480px)': {
    '.mew-code-search-row': { gridTemplateColumns: '24px minmax(0, 1fr)' },
    '.mew-code-search-actions': { gridColumn: '2', justifyContent: 'flex-end' },
    '.mew-code-search-count': { marginRight: 'auto', paddingLeft: '8px' },
  },
  '@media (pointer: coarse)': {
    '.mew-code-search .mew-code-search-button': { minWidth: '30px', height: '30px' },
    '.mew-code-search-field': { height: '34px' },
  },
})
