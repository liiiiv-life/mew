import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { captureCommandMenuShortcut, focusFirstCommand, navigateCommandMenu } from './command-menu-keyboard.ts'

test('Ctrl+E consumes browser/editor input, ignores modifiers and repeats, and cleans up', async () => {
  const win = new Window()
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true })
  const { registerKeyboardCapture } = await import('../../packages/shortcuts/src/keyboardCapture.ts')
  const input = win.document.createElement('textarea')
  win.document.body.append(input)
  let opened = 0
  let received = 0
  input.addEventListener('keydown', () => received++)
  const release = captureCommandMenuShortcut(() => opened++)
  const press = (extra: KeyboardEventInit = {}) => {
    const event = new win.KeyboardEvent('keydown', { key: 'e', code: 'KeyE', ctrlKey: true, bubbles: true, cancelable: true, ...extra })
    input.dispatchEvent(event)
    return event.defaultPrevented
  }
  try {
    assert.equal(press(), true)
    assert.equal(press({ key: 'ㄷ' }), true)
    assert.equal(opened, 2)
    assert.equal(received, 0)
    assert.equal(press({ repeat: true }), true)
    assert.equal(opened, 2)
    for (const extra of [{ ctrlKey: false }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { key: 'q', code: 'KeyQ' }]) {
      assert.equal(press(extra), false)
    }
    const releaseRemote = registerKeyboardCapture(event => {
      event.preventDefault(); event.stopImmediatePropagation(); return true
    })
    try { assert.equal(press(), true); assert.equal(opened, 2) } finally { releaseRemote() }
    release()
    assert.equal(press(), false)
  } finally { release(); await win.happyDOM.close() }
})

test('arrows move between command rows and actions, wrap, and skip disabled buttons', async () => {
  const win = new Window()
  const menu = win.document.createElement('div')
  menu.innerHTML = '<div data-command-row><button>A</button><button>Run A</button><button>Terminal A</button></div>'
    + '<div data-command-row><button disabled>B</button><button disabled>Run B</button><button>Terminal B</button></div>'
    + '<div data-command-row><button>Add</button></div>'
  win.document.body.append(menu)
  let activated = ''
  menu.addEventListener('click', event => { activated = (event.target as unknown as HTMLButtonElement).textContent! })
  menu.addEventListener('keydown', event => navigateCommandMenu(event as unknown as KeyboardEvent, menu as unknown as HTMLElement))
  const active = () => win.document.activeElement?.textContent
  const press = (key: string, extra: KeyboardEventInit = {}) => {
    const event = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
    win.document.activeElement!.dispatchEvent(event)
    return event.defaultPrevented
  }
  try {
    focusFirstCommand(menu as unknown as HTMLElement)
    assert.equal(active(), 'A')
    assert.equal(press('ArrowRight'), true); assert.equal(active(), 'Run A')
    press('ArrowRight'); assert.equal(active(), 'Terminal A')
    press('ArrowDown'); assert.equal(active(), 'Terminal B')
    press('ArrowDown'); assert.equal(active(), 'Add')
    press('ArrowDown'); assert.equal(active(), 'A')
    press('ArrowUp'); assert.equal(active(), 'Add')
    press('Home'); assert.equal(active(), 'A')
    press('ArrowLeft'); assert.equal(active(), 'Terminal A')
    press('End'); assert.equal(active(), 'Add')
    assert.equal(press('ArrowUp', { isComposing: true }), false); assert.equal(active(), 'Add')
    assert.equal(press('Enter'), false, 'native button activation stays available')
    ;(win.document.activeElement as unknown as HTMLButtonElement).click()
    assert.equal(activated, 'Add')
    assert.equal(press('Tab'), false, 'Tab remains available to leave the dropdown')
  } finally { await win.happyDOM.close() }
})
