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
