import test from 'node:test'
import assert from 'node:assert/strict'
import { KEY_CODES } from '../../native/remote-desktop/keys.mjs'
import { DEFAULT_GAME_KEYS, FULL_KEY_ROWS, NAVIGATION_KEYS, NUMPAD_KEYS, screenKeyboardInput, screenKeyboardSettings } from './desktop-screen-keyboard.ts'

test('screen keyboard settings validate saved modes, deduplicate keys and recover corrupted layouts', () => {
  assert.deepEqual(screenKeyboardSettings(null), { mode: 'full', gameKeys: DEFAULT_GAME_KEYS, keyboardOnly: false })
  assert.deepEqual(screenKeyboardSettings({ mode: 'game', gameKeys: ['KeyW', 'KeyW', 'Space', '../../bad', 4] }), { mode: 'game', gameKeys: ['KeyW', 'Space'], keyboardOnly: false })
  assert.deepEqual(screenKeyboardSettings({ mode: 'broken', gameKeys: [] }), { mode: 'full', gameKeys: DEFAULT_GAME_KEYS, keyboardOnly: false })
  assert.equal(screenKeyboardSettings({ gameKeys: Object.keys(KEY_CODES) }).gameKeys.length, 24)
  assert.equal(screenKeyboardSettings({ keyboardOnly: true }).keyboardOnly, true)
  assert.equal(screenKeyboardSettings({ keyboardOnly: 'true' }).keyboardOnly, false)
  const keys = [...FULL_KEY_ROWS.flat(), ...NAVIGATION_KEYS, ...NUMPAD_KEYS]
  assert.equal(new Set(keys).size, 106)
  assert.ok(keys.every(key => Object.hasOwn(KEY_CODES, key)))
})

test('simultaneous pointers retain shared holds and release only their own keys', () => {
  const events: [string, boolean][] = [], keys = screenKeyboardInput((...event) => events.push(event))
  keys.down(1, 'KeyW'); keys.down(2, 'Space'); keys.down(3, 'KeyW')
  keys.up(1)
  assert.deepEqual(events, [['KeyW', true], ['Space', true]])
  keys.up(3); keys.up(2); keys.up(2)
  assert.deepEqual(events.slice(-2), [['KeyW', false], ['Space', false]])
  keys.down(4, 'not-a-key')
  assert.equal(events.length, 4)
})

test('latched modifiers combine with other keys and all ownership clears at lifecycle boundaries', () => {
  const events: [string, boolean][] = [], keys = screenKeyboardInput((...event) => events.push(event))
  keys.toggle('ControlLeft'); keys.down(1, 'KeyC'); keys.up(1)
  assert.deepEqual(events, [['ControlLeft', true], ['KeyC', true], ['KeyC', false]])
  keys.release(); keys.release()
  assert.deepEqual(events.at(-1), ['ControlLeft', false])
  keys.down(1, 'KeyW'); keys.reset(); keys.up(1)
  assert.deepEqual(events.at(-1), ['KeyW', true], 'reset follows an external release without emitting duplicate input')
  keys.toggle('ShiftLeft'); keys.down(2, 'KeyW'); keys.unlatch('ShiftLeft')
  assert.deepEqual(events.at(-1), ['ShiftLeft', false], 'canceling a modifier preserves another held key')
  keys.up(2)
  assert.deepEqual(events.at(-1), ['KeyW', false])
})
