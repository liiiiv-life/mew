import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'KeyboardEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { value: (win as unknown as Record<string, unknown>)[key], configurable: true })
}
win.HTMLElement.prototype.checkVisibility = function () { return !this.closest('[hidden]') }
win.localStorage.setItem('mew:shortcuts', JSON.stringify({ toggleChat: 'Ctrl+Alt+J' }))
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
const { captureCommentShortcut } = await import('./comment-shortcut.ts')
const { getBinding, setBinding, resetBinding, registerKeyboardCapture } = await import('@mew/shortcuts')

function surface(kind = 'hotview') {
  const panel = document.createElement('div')
  panel.dataset.workspacePanel = 'editor'
  const editor = document.createElement('div')
  editor.className = kind === 'hotview' ? 'ProseMirror' : 'cm-editor'
  const input = document.createElement('div')
  input.contentEditable = 'true'
  input.tabIndex = 0
  input.textContent = '선택할 본문'
  editor.append(input)
  panel.append(editor)
  document.body.append(panel)
  return { panel, editor, input }
}
function press(target: Element, init: KeyboardEventInit = {}) {
  const event = new window.KeyboardEvent('keydown', { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

test('Ctrl/Cmd+Shift+C consumes the file editor event in capture before editor and browser handlers', () => {
  assert.equal(getBinding('addComment'), 'Ctrl+Shift+C')
  assert.equal(getBinding('toggleChat'), 'Ctrl+Alt+J', 'changing the default leaves saved user preferences intact')
  const view = surface()
  let opened = 0
  let propagated = 0
  let selectionAtOpen = ''
  view.input.addEventListener('keydown', () => { propagated++ })
  const stop = captureCommentShortcut({ enabled: () => true, startComment: () => { opened++; selectionAtOpen = window.getSelection()?.toString() ?? ''; return true } })
  try {
    view.input.focus()
    const range = document.createRange()
    range.selectNodeContents(view.input)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    assert.equal(press(view.input).defaultPrevented, true)
    assert.equal(selectionAtOpen, '선택할 본문')
    assert.equal(press(view.input, { ctrlKey: false, metaKey: true }).defaultPrevented, true)
    assert.equal(opened, 2)
    assert.equal(propagated, 0)
    for (const init of [{ repeat: true }, { isComposing: true }]) assert.equal(press(view.input, init).defaultPrevented, true)
    assert.equal(opened, 2)
    for (const init of [{ shiftKey: false }, { altKey: true }, { ctrlKey: false }, { key: 'X', code: 'KeyX' }]) assert.equal(press(view.input, init).defaultPrevented, false)
    assert.equal(opened, 2)
    stop()
    assert.equal(press(view.input).defaultPrevented, false)
  } finally { stop(); view.panel.remove(); window.getSelection()?.removeAllRanges() }
})

test('the editor consumes the shortcut when there is no selection or the readonly comment action declines', () => {
  const view = surface('plain')
  let attempts = 0
  const stop = captureCommentShortcut({ enabled: () => true, startComment: () => { attempts++; return false } })
  try {
    view.input.contentEditable = 'false'
    view.input.focus()
    assert.equal(press(view.input).defaultPrevented, true)
    assert.equal(attempts, 1)
  } finally { stop(); view.panel.remove() }
})

test('a noncollapsed selection in the same visible editor works when focus falls back to body', () => {
  const view = surface()
  let opened = 0
  const stop = captureCommentShortcut({ enabled: () => true, startComment: () => { opened++; return true } })
  try {
    view.input.focus()
    view.input.blur()
    const range = document.createRange()
    range.selectNodeContents(view.input)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    assert.equal(press(document.body).defaultPrevented, true)
    assert.equal(opened, 1)
    window.getSelection()!.collapse(view.input.firstChild, 1)
    assert.equal(press(document.body).defaultPrevented, false)
    assert.equal(opened, 1)
  } finally { stop(); view.panel.remove(); window.getSelection()?.removeAllRanges() }
})

test('native CodeMirror search controls do not reuse the stale document selection for comments', () => {
  const view = surface('plain')
  let opened = 0
  const stop = captureCommentShortcut({ enabled: () => true, startComment: () => { opened++; return true } })
  const search = document.createElement('div')
  search.className = 'cm-search'
  view.editor.append(search)
  try {
    const range = document.createRange()
    range.selectNodeContents(view.input)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    for (const tag of ['input', 'textarea', 'select', 'button']) {
      const control = document.createElement(tag)
      search.append(control)
      control.focus()
      assert.equal(press(control).defaultPrevented, false, tag)
      if (control instanceof window.HTMLInputElement) {
        control.type = 'checkbox'
        assert.equal(press(control).defaultPrevented, false, 'checkbox')
      }
    }
    assert.equal(opened, 0)
    view.input.contentEditable = 'false'
    view.input.focus()
    assert.equal(press(view.input).defaultPrevented, true, 'readonly document content remains in the comment shortcut scope')
    assert.equal(opened, 1)
  } finally { stop(); view.panel.remove(); window.getSelection()?.removeAllRanges() }
})

test('guest or unavailable comments, other inputs, hidden views, and exclusive surfaces do not open file comments', () => {
  const view = surface()
  let enabled = false
  let opened = 0
  const stop = captureCommentShortcut({ enabled: () => enabled, startComment: () => { opened++; return true } })
  const outside = document.createElement('textarea')
  document.body.append(outside)
  try {
    assert.equal(press(view.input).defaultPrevented, false)
    enabled = true
    for (const attribute of ['inert', 'hidden', 'data-agent-session', 'data-login-desktop']) {
      view.panel.setAttribute(attribute, '')
      assert.equal(press(view.input).defaultPrevented, false, attribute)
      view.panel.removeAttribute(attribute)
    }
    view.panel.setAttribute('role', 'dialog')
    assert.equal(press(view.input).defaultPrevented, false)
    view.panel.removeAttribute('role')
    view.panel.classList.add('xterm')
    assert.equal(press(view.input).defaultPrevented, false)
    view.panel.classList.remove('xterm')
    assert.equal(press(outside).defaultPrevented, false)
    view.panel.dataset.workspacePanel = 'memo'
    assert.equal(press(view.input).defaultPrevented, false)
    assert.equal(opened, 0)
  } finally { stop(); view.panel.remove(); outside.remove() }
})

test('saved custom comment bindings are preserved, including an explicit legacy Alt+Shift+C preference', () => {
  const view = surface()
  let opened = 0
  const stop = captureCommentShortcut({ enabled: () => true, startComment: () => { opened++; return true } })
  try {
    assert.deepEqual(setBinding('addComment', 'Alt+Shift+C'), { ok: true })
    assert.equal(getBinding('addComment'), 'Alt+Shift+C')
    assert.equal(press(view.input).defaultPrevented, false)
    assert.equal(press(view.input, { ctrlKey: false, altKey: true }).defaultPrevented, true)
    assert.equal(opened, 1)
    assert.deepEqual(setBinding('addComment', 'Ctrl+Alt+K'), { ok: true })
    assert.equal(press(view.input, { key: 'K', code: 'KeyK', shiftKey: false, altKey: true }).defaultPrevented, true)
    assert.equal(opened, 2)
    assert.equal(JSON.parse(win.localStorage.getItem('mew:shortcuts')!).toggleChat, 'Ctrl+Alt+J')
    resetBinding('addComment')
    assert.equal(getBinding('addComment'), 'Ctrl+Shift+C')
  } finally { stop(); resetBinding('addComment'); view.panel.remove() }
})

test('the common exclusive keyboard capture retains priority over file comments', () => {
  const view = surface()
  let opened = 0
  const stop = captureCommentShortcut({ enabled: () => true, startComment: () => { opened++; return true } })
  const remoteEvents: string[] = []
  const releaseRemote = registerKeyboardCapture(event => {
    remoteEvents.push(event.type)
    event.preventDefault()
    event.stopImmediatePropagation()
    return true
  })
  try {
    assert.equal(press(view.input).defaultPrevented, true)
    view.input.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true, bubbles: true }))
    assert.deepEqual(remoteEvents, ['keydown', 'keyup'])
    assert.equal(opened, 0)
    releaseRemote()
    assert.equal(press(view.input).defaultPrevented, true)
    assert.equal(opened, 1)
  } finally { releaseRemote(); stop(); view.panel.remove() }
})
