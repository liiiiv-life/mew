import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLIFrameElement', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { value: (win as unknown as Record<string, unknown>)[key], configurable: true })
}
// happy-dom does not lay out elements; visibility is supplied for this keyboard fixture.
win.HTMLElement.prototype.checkVisibility = function () { return !this.closest('[hidden]') }
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@mew/shortcuts') return { url: new URL('../../packages/shortcuts/src/numberedTab.ts', import.meta.url).href, shortCircuit: true }
  if (specifier === '../utils/numbered-panel-tabs') return { url: new URL('../utils/numbered-panel-tabs.ts', import.meta.url).href, shortCircuit: true }
  return nextResolve(specifier, context)
} })
const [{ act }, { createRoot }, { useFocusedWorkspacePanel }] = await Promise.all([
  import('react'), import('react-dom/client'), import('./use-focused-workspace-panel.ts'),
])
function Harness() { useFocusedWorkspacePanel(); return null }

test('Ctrl/Cmd+숫자는 포커스된 분할 패널의 표시 순서로 전환하고 PTY 입력을 차단한다', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  host.innerHTML = `<section data-workspace-panel="editor" data-dock-panel="editor:a"><div data-dock-tab-bar><button role="tab">A1</button><button role="tab">A2</button></div><textarea></textarea></section>
    <section data-workspace-panel="editor" data-dock-panel="editor:b"><div data-dock-tab-bar><button role="tab">B1</button><button role="tab">B2</button></div><textarea></textarea></section>
    <section data-workspace-panel="terminal" data-dock-panel="terminal:a"><div data-dock-tab-bar><button role="tab">T1</button><button role="tab">T2</button></div></section>
    <div data-workspace-panel="terminal" data-dock-body="terminal:a"><textarea></textarea></div>
    <section data-workspace-panel="tasks"><header data-dock-tab-bar><div role="tab">Title</div><div role="tablist"><button role="tab">List</button><button role="tab">Calendar</button></div></header><textarea></textarea></section>
    <section data-workspace-panel="sidebar"><button data-numbered-tab>Files</button><button data-numbered-tab>Search</button><textarea></textarea></section>
    <div role="dialog"><textarea></textarea></div>`
  const mount = document.createElement('div'); host.append(mount)
  const root = createRoot(mount)
  const selected: string[] = []
  for (const button of host.querySelectorAll('button')) button.addEventListener('click', () => selected.push(button.textContent!))
  let received = 0
  host.addEventListener('keydown', () => received++)
  const press = (input: HTMLElement, init: KeyboardEventInit = {}) => {
    input.focus()
    const event = new window.KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true, ...init })
    input.dispatchEvent(event)
    return event
  }
  try {
    await act(async () => { root.render((await import('react')).createElement(Harness)) })
    const inputs = host.querySelectorAll('textarea')
    await act(async () => {
      for (let i = 0; i < 5; i++) assert.equal(press(inputs[i]).defaultPrevented, true)
    })
    assert.deepEqual(selected, ['A2', 'B2', 'T2', 'Calendar', 'Search'])
    assert.equal(received, 0)
    await act(async () => {
      for (let i = 0; i < 5; i++) assert.equal(press(inputs[i], { ctrlKey: false, altKey: true }).defaultPrevented, false, 'Alt+number is reserved for project tabs')
    })
    await act(async () => {
      assert.equal(press(inputs[2], { key: '9', code: 'Digit9' }).defaultPrevented, true)
      assert.equal(press(inputs[2], { key: '™', code: 'Digit2' }).defaultPrevented, true)
      for (const extra of [{ altKey: true }, { ctrlKey: false }, { shiftKey: true }, { isComposing: true }, { key: '0', code: 'Digit0' }]) {
        assert.equal(press(inputs[2], extra).defaultPrevented, false)
      }
      assert.equal(press(inputs[5]).defaultPrevented, true)
    })
    assert.deepEqual(selected, ['A2', 'B2', 'T2', 'Calendar', 'Search', 'T2'])
    await act(async () => {
      for (const extra of [{ ctrlKey: true }, { ctrlKey: false, metaKey: true }, { ctrlKey: true, code: 'Numpad2' }]) {
        assert.equal(press(inputs[1], { altKey: false, ...extra }).defaultPrevented, true)
      }
      const count = selected.length
      assert.equal(press(inputs[5], { altKey: false, ctrlKey: true }).defaultPrevented, true, 'modal consumes browser selection without changing background')
      assert.equal(selected.length, count)
    })
    assert.deepEqual(selected.slice(-3), ['B2', 'B2', 'B2'])
    // Closing or covering the remembered panel must not redirect to another one.
    const body = host.querySelector<HTMLElement>('[data-dock-body]')!
    body.hidden = true
    await act(async () => { assert.equal(press(inputs[2]).defaultPrevented, true) })
    assert.equal(selected.at(-1), 'T2')
    body.setAttribute('inert', '')
    await act(async () => { assert.equal(press(inputs[2]).defaultPrevented, true) })
    await act(async () => { assert.equal(press(inputs[2], { altKey: false, ctrlKey: true }).defaultPrevented, true) })
    assert.equal(selected.at(-1), 'T2')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

test('Alt+Q/E는 포커스된 패널의 이전·다음 탭으로 순환하며 수정키·IME·모달은 제외한다', async () => {
  const host = document.createElement('div'); document.body.append(host)
  host.innerHTML = `<section data-workspace-panel="editor" data-dock-panel="editor:a"><div data-dock-tab-bar><button role="tab" aria-selected="true">A1</button><button role="tab">A2</button><button role="tab">A3</button></div><textarea></textarea></section>
    <section data-workspace-panel="terminal" data-dock-panel="terminal:a"><div data-dock-tab-bar><button role="tab" aria-selected="true">T1</button><button role="tab">T2</button></div></section>
    <div data-workspace-panel="terminal" data-dock-body="terminal:a"><textarea></textarea></div>
    <section data-workspace-panel="sidebar"><button data-numbered-tab aria-pressed="true">Files</button><button data-numbered-tab>Search</button><textarea></textarea></section>
    <section data-workspace-panel="memo"><textarea></textarea></section>
    <div role="dialog"><textarea></textarea></div>`
  const mount = document.createElement('div'); host.append(mount)
  const root = createRoot(mount)
  const selected: string[] = []
  for (const button of host.querySelectorAll('button')) button.addEventListener('click', () => {
    const attribute = button.hasAttribute('data-numbered-tab') ? 'aria-pressed' : 'aria-selected'
    for (const sibling of button.parentElement!.querySelectorAll('button')) sibling.setAttribute(attribute, String(sibling === button))
    selected.push(button.textContent!)
  })
  let received = 0
  host.addEventListener('keydown', () => received++)
  const inputs = host.querySelectorAll('textarea')
  const press = (input: HTMLElement, code: string, extra: KeyboardEventInit = {}) => {
    input.focus()
    const event = new window.KeyboardEvent('keydown', { key: code === 'KeyQ' ? 'q' : 'e', code, altKey: true, bubbles: true, cancelable: true, ...extra })
    input.dispatchEvent(event)
    return event
  }
  try {
    await act(async () => { root.render((await import('react')).createElement(Harness)) })
    await act(async () => {
      for (const code of ['KeyQ', 'KeyE', 'KeyE']) assert.equal(press(inputs[0], code).defaultPrevented, true)
      for (const code of ['KeyE', 'KeyE', 'KeyQ']) assert.equal(press(inputs[1], code, { key: '´' }).defaultPrevented, true)
      assert.equal(press(inputs[2], 'KeyQ').defaultPrevented, true)
      assert.equal(press(inputs[2], 'KeyE').defaultPrevented, true)
      assert.equal(press(inputs[3], 'KeyE').defaultPrevented, true)
    })
    assert.deepEqual(selected, ['A3', 'A1', 'A2', 'T2', 'T1', 'T2', 'Search', 'Files'])
    assert.equal(received, 0)
    await act(async () => {
      for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }]) {
        assert.equal(press(inputs[0], 'KeyE', extra).defaultPrevented, false)
      }
      assert.equal(press(inputs[4], 'KeyQ').defaultPrevented, false)
    })
    assert.equal(selected.length, 8)
  } finally {
    await act(async () => root.unmount()); host.remove()
  }
})
