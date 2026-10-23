import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { captureUpdatesShortcut } from './updates-shortcut.ts'

test('Ctrl/Cmd+U opens updates before input handlers and releases its listener on cleanup', async () => {
  const window = new Window()
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true })
  const { registerKeyboardCapture } = await import('../../packages/shortcuts/src/keyboardCapture.ts')
  const input = window.document.createElement('textarea')
  window.document.body.append(input)
  let opened = 0
  let received = 0
  input.addEventListener('keydown', event => { received++; event.stopPropagation() })
  const stop = captureUpdatesShortcut(() => opened++)
  const press = (init: KeyboardEventInit = {}) => {
    const event = new window.KeyboardEvent('keydown', { key: 'u', code: 'KeyU', ctrlKey: true, bubbles: true, cancelable: true, ...init })
    input.dispatchEvent(event)
    return event.defaultPrevented
  }
  try {
    assert.equal(press(), true)
    assert.equal(press({ ctrlKey: false, metaKey: true }), true)
    assert.equal(opened, 2)
    assert.equal(received, 0)
    assert.equal(press({ repeat: true }), true)
    assert.equal(opened, 2)
    for (const init of [{ ctrlKey: false }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { key: 'i' }]) {
      assert.equal(press(init), false)
    }
    assert.equal(opened, 2)
    const releaseRemote = registerKeyboardCapture(event => {
      event.preventDefault()
      event.stopImmediatePropagation()
      return true
    })
    try {
      assert.equal(press(), true)
      assert.equal(opened, 2, 'exclusive remote input keeps priority')
    } finally { releaseRemote() }
    stop()
    assert.equal(press(), false)
    assert.equal(opened, 2)
  } finally {
    stop()
    await window.happyDOM.close()
  }
})
