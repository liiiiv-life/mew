import test from 'node:test'
import assert from 'node:assert/strict'
import { placeSlashMenu } from './slashMenuPosition.ts'

test('opens below when the full menu fits', () => {
  const layout = placeSlashMenu({ top: 100, bottom: 120, left: 20 }, { top: 0, left: 0, width: 390, height: 800 }, 400)
  assert.equal(layout.top, 126)
  assert.equal(layout.maxHeight, 288)
})

test('keyboard-reduced viewport opens above the slash', () => {
  const layout = placeSlashMenu({ top: 320, bottom: 340, left: 20 }, { top: 0, left: 0, width: 390, height: 380 }, 400)
  assert.equal(layout.top, 26)
  assert.equal(layout.top + layout.maxHeight, 314)
})

test('viewport panning and narrow screens constrain the menu and allow scrolling', () => {
  const layout = placeSlashMenu({ top: 260, bottom: 280, left: 300 }, { top: 100, left: 40, width: 240, height: 210 }, 400)
  assert.equal(layout.top, 108)
  assert.equal(layout.maxHeight, 146)
  assert.equal(layout.left, 48)
  assert.equal(layout.width, 224)
})

test('short filtered results can still fit below', () => {
  const layout = placeSlashMenu({ top: 220, bottom: 240, left: 20 }, { top: 0, left: 0, width: 390, height: 380 }, 40)
  assert.equal(layout.top, 246)
  assert.equal(layout.maxHeight, 40)
})
