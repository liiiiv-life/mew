import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopGeometry, rotateDelta, sensitivity, type Rotation } from './desktop-view.ts'

test('all rotations preserve clicks through fit, zoom, pan and letterboxing', () => {
  for (const rotation of [0, 90, 180, 270] as Rotation[]) for (const viewport of [[390, 760], [1440, 800]]) {
    const g = desktopGeometry(viewport[0], viewport[1], 1920, 1080, rotation, { x: 24, y: -18, scale: 2 })
    for (const [x, y] of [[0, 0], [1, 1], [.23, .81], [.5, .5]]) {
      const point = g.project(x, y), back = g.unproject(point.x, point.y)
      assert.ok(Math.abs(back.x - x) < 1e-10 && Math.abs(back.y - y) < 1e-10)
    }
    assert.ok(g.content.width <= viewport[0] + 1e-10 && g.content.height <= viewport[1] + 1e-10)
  }
  const portrait = desktopGeometry(390, 760, 1920, 1080, 90, { x: 0, y: 0, scale: 1 })
  assert.ok(portrait.content.height > portrait.content.width)
  assert.ok(portrait.unproject(-50, 380).y > 1, 'letterbox/outside coordinates stay outside until explicitly clamped')
})

test('a rightward joystick stroke stays rightward on every rotated view', () => {
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const native = rotateDelta(60, 0, ((360 - rotation) % 360) as Rotation)
    const screen = rotateDelta(native.x, native.y, rotation)
    assert.equal(screen.x, 60); assert.equal(Math.abs(screen.y), 0)
  }
})

test('sensitivity defaults to triple speed and invalid stored values are bounded', () => {
  for (const value of [null, undefined, '4', NaN, Infinity, {}]) assert.equal(sensitivity(value), 3)
  assert.equal(sensitivity(.1), .5); assert.equal(sensitivity(100), 6); assert.equal(sensitivity(1.7), 1.7)
})
