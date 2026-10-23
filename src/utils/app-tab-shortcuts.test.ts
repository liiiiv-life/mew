import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { value: (win as unknown as Record<string, unknown>)[key], configurable: true })
}
win.HTMLElement.prototype.checkVisibility = function () { return !this.closest('[hidden]') }
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('./') && context.parentURL?.includes('/packages/shortcuts/src/') && !/\.[a-z]+$/.test(specifier)) return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (url.endsWith('/packages/shortcuts/src/index.ts')) return { ...result, source: String(result.source).replace("from './shortcuts.json'", "from './shortcuts.json' with { type: 'json' }") }
    return result
  },
})
const [{ captureAppTabShortcuts }, { useFocusedShortcutScope }, { createElement, useRef, act }, { createRoot }] = await Promise.all([
  import('./app-tab-shortcuts.ts'), import('../../packages/shortcuts/src/focusedShortcutScope.ts'), import('react'), import('react-dom/client'),
])
const { activateNumberedPanelTab, activateAdjacentPanelTab } = await import('./numbered-panel-tabs.ts')

test('에이전트 빈 영역 선택과 키보드 탭 전환 직후 닫기가 에디터로 새지 않는다', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const closed: string[] = []
  let active = 'first'
  function AgentSurface({ bar = false }: { bar?: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useFocusedShortcutScope(ref, { closeTab: () => { closed.push(active); return true } })
    return createElement('div', { ref, 'data-workspace-panel': 'agent', [bar ? 'data-dock-panel' : 'data-dock-body']: 'agent:split' },
      bar ? createElement('div', { 'data-dock-tab-bar': true }, ...['first', 'second'].map(id => createElement('button', {
        key: id, role: 'tab', 'aria-selected': id === active,
        onClick: () => {
          active = id
          for (const tab of host.querySelectorAll('[role="tab"]')) tab.setAttribute('aria-selected', String(tab.textContent === id))
          host.querySelector<HTMLTextAreaElement>('[data-dock-body] textarea')!.blur()
        },
      }, id))) : createElement('textarea'),
    )
  }
  await act(async () => root.render(createElement('div', null,
    createElement('textarea', { 'data-workspace-panel': 'editor' }),
    createElement(AgentSurface, { bar: true }), createElement(AgentSurface),
    createElement('div', { role: 'dialog' }, createElement('button')),
  )))
  const stop = captureAppTabShortcuts({ closeEditorTab: () => closed.push('editor'), create: () => {} })
  const press = (init: KeyboardEventInit = {}) => {
    const event = new window.KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true, cancelable: true, ...init })
    document.activeElement!.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
  }
  try {
    const editor = host.querySelector<HTMLTextAreaElement>('[data-workspace-panel="editor"]')!
    const body = host.querySelector<HTMLElement>('[data-dock-body]')!
    const input = body.querySelector('textarea')!
    editor.focus()
    body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    press()
    assert.deepEqual(closed, ['first'], 'pointer-selected agent surface takes precedence over stale editor focus')
    editor.blur()
    press()
    assert.deepEqual(closed, ['first', 'first'], 'body focus retains the selected agent surface')
    input.focus()
    activateNumberedPanelTab(body, 1)
    assert.equal(document.activeElement?.textContent, 'second', 'keyboard selection moves focus to the selected tab')
    press({ ctrlKey: false, metaKey: true })
    assert.equal(closed.at(-1), 'second')
    activateAdjacentPanelTab(body, 1)
    assert.equal(document.activeElement?.textContent, 'first')
    press()
    assert.equal(closed.at(-1), 'first')
    const count = closed.length
    body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    body.hidden = true
    press()
    body.hidden = false
    body.setAttribute('inert', '')
    press()
    body.removeAttribute('inert')
    press({ repeat: true })
    press({ isComposing: true })
    host.querySelector<HTMLButtonElement>('[role="dialog"] button')!.focus()
    press()
    assert.equal(closed.length, count)
    editor.focus()
    press()
    assert.equal(closed.at(-1), 'editor')
  } finally {
    stop()
    await act(async () => root.unmount())
    host.remove()
  }
})

test('새 파일은 에디터·사이드바에서만 생성하고 패널의 빈 영역에서도 해당 새 탭 행동을 유지한다', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const actions: string[] = []
  function Panel({ kind, handles = true }: { kind: string; handles?: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    useFocusedShortcutScope(ref, { newTab: () => { if (!handles) return false; actions.push(kind); return true } })
    return createElement('section', { 'data-workspace-panel': kind }, createElement('div', { ref }, createElement('textarea'), createElement('div', { 'data-blank': kind })))
  }
  await act(async () => root.render(createElement('div', null,
    createElement('section', { 'data-workspace-panel': 'editor' }, createElement('textarea')),
    createElement('section', { 'data-workspace-panel': 'sidebar', 'data-sidebar': true }, createElement('textarea'), createElement('div', { 'data-blank': 'sidebar' })),
    createElement(Panel, { kind: 'agent' }), createElement(Panel, { kind: 'terminal' }), createElement(Panel, { kind: 'browser' }), createElement(Panel, { kind: 'unhandled', handles: false }),
    createElement('section', { 'data-workspace-panel': 'chat' }, createElement('textarea')),
    createElement('div', { role: 'dialog' }, createElement('textarea')),
  )))
  const stop = captureAppTabShortcuts({ closeEditorTab: () => {}, create: (_event, kind, target) => actions.push(`${target.closest<HTMLElement>('[data-workspace-panel]')!.dataset.workspacePanel}:${kind}`) })
  let received = 0
  host.addEventListener('keydown', () => received++)
  const press = (target: Element, key = 'n', init: KeyboardEventInit = {}) => {
    const event = new window.KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, ctrlKey: true, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
  }
  try {
    for (const kind of ['editor', 'sidebar', 'agent', 'terminal', 'browser', 'unhandled', 'chat']) {
      const input = host.querySelector<HTMLElement>(`[data-workspace-panel="${kind}"] textarea`)!
      input.focus()
      press(input)
      press(input, 't', { ctrlKey: false, metaKey: true })
      press(input, 'n', { shiftKey: true })
    }
    assert.deepEqual(actions, ['editor:file', 'editor:file', 'editor:folder', 'sidebar:file', 'sidebar:file', 'sidebar:folder', 'agent', 'agent', 'terminal', 'terminal', 'browser', 'browser'])
    for (const kind of ['agent', 'terminal', 'sidebar']) {
      const blank = host.querySelector(`[data-blank="${kind}"]`)!
      blank.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
      ;(document.activeElement as HTMLElement).blur()
      press(document.body)
    }
    assert.deepEqual(actions.slice(-3), ['agent', 'terminal', 'sidebar:file'])
    const frame = document.createElement('iframe')
    host.querySelector('[data-blank="browser"]')!.append(frame)
    frame.focus()
    const forwarded = new window.KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, cancelable: true })
    window.dispatchEvent(forwarded)
    assert.equal(forwarded.defaultPrevented, true)
    assert.equal(actions.at(-1), 'browser')
    const input = host.querySelector<HTMLElement>('[data-workspace-panel="agent"] textarea')!
    input.focus()
    const count = actions.length
    press(input, 'n', { repeat: true })
    press(input, 'n', { isComposing: true })
    input.closest<HTMLElement>('section')!.hidden = true
    press(document.body)
    input.closest<HTMLElement>('section')!.hidden = false
    const dialog = host.querySelector<HTMLElement>('[role="dialog"] textarea')!
    dialog.focus()
    press(dialog)
    assert.equal(actions.length, count)
    assert.equal(received, 0)
  } finally {
    stop()
    await act(async () => root.unmount())
    host.remove()
  }
})

test('닫힌 탭 복원은 포커스된 표면으로 전달하고 반복·IME·모달·숨긴 패널에서는 실행하지 않는다', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const actions: string[] = []
  function Panel({ kind }: { kind: string }) {
    const ref = useRef<HTMLDivElement>(null)
    useFocusedShortcutScope(ref, { reopenTab: () => { actions.push(kind); return true } })
    return createElement('div', { ref, 'data-kind': kind }, createElement('textarea'), createElement('div', { 'data-blank': kind }))
  }
  await act(async () => root.render(createElement('div', null,
    createElement(Panel, { kind: 'agent' }), createElement(Panel, { kind: 'terminal' }),
    createElement('div', { role: 'dialog' }, createElement('textarea')),
    createElement('input'),
  )))
  let files = 0
  const stop = captureAppTabShortcuts({ closeEditorTab: () => {}, create: () => files++ })
  let received = 0
  host.addEventListener('keydown', () => received++)
  const press = (target: Element, init: KeyboardEventInit = {}) => {
    const event = new window.KeyboardEvent('keydown', { key: 'T', code: 'KeyT', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
  }
  try {
    for (const kind of ['agent', 'terminal']) {
      const input = host.querySelector<HTMLElement>(`[data-kind="${kind}"] textarea`)!
      input.focus()
      press(input)
      press(input, { ctrlKey: false, metaKey: true })
      press(input, { repeat: true })
      press(input, { isComposing: true })
      input.closest<HTMLElement>('[data-kind]')!.hidden = true
      press(input)
      input.closest<HTMLElement>('[data-kind]')!.hidden = false
      const blank = host.querySelector(`[data-blank="${kind}"]`)!
      blank.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
      input.blur()
      press(document.body)
    }
    host.querySelector<HTMLElement>('[role="dialog"] textarea')!.focus()
    press(document.activeElement!)
    host.querySelector<HTMLInputElement>('input')!.focus()
    press(document.activeElement!)
    assert.deepEqual(actions, ['agent', 'agent', 'agent', 'terminal', 'terminal', 'terminal'])
    assert.equal(files, 0)
    assert.equal(received, 0, 'reserved keys never reach the terminal or editor')
  } finally {
    stop()
    await act(async () => root.unmount())
    host.remove()
  }
})
