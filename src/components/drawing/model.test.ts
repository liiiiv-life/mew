import assert from 'node:assert/strict'
import test from 'node:test'
import { DrawingHistory, cloneDocument, createDocument, createObject, expandSelection, normalizeDocument, reorderObjects } from './model.ts'
import { hitTestObject, normalizePathObject, objectBounds, objectCenter, objectLocalToWorld, objectWorldToLocal, pathData, resizeObjectFromHandle, resizeSelection, rotateSelection, screenToWorld, selectionBounds, snapPoint, translateSelection, worldToScreen } from './geometry.ts'
import { drawingExportBounds, parseSvgDocument, serializeSvg } from './svg.ts'

function near(actual: number, expected: number, epsilon = 1e-7) { assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be near ${expected}`) }

test('viewport conversion and grid snapping work on both sides of the origin', () => {
  const viewport = { x: 402, y: 210, zoom: 1.7 }, point = { x: -90, y: 140 }
  const result = screenToWorld(worldToScreen(point, viewport), viewport)
  near(result.x, point.x); near(result.y, point.y)
  assert.deepEqual(snapPoint({ x: -31, y: 39 }, 20), { x: -40, y: 40 })
})

test('local coordinate conversions preserve rotated object positions', () => {
  const object = createObject('rect', { x: -70, y: 80, width: 100, height: 40, rotation: 73 })
  const local = { x: 17, y: 19 }
  const result = objectWorldToLocal(object, objectLocalToWorld(object, local))
  near(result.x, local.x); near(result.y, local.y)
})

test('rotated bounds account for rectangles, ellipses and cubic extrema', () => {
  const rect = createObject('rect', { x: 0, y: 0, width: 100, height: 20, rotation: 90 })
  const rb = objectBounds(rect)
  near(rb.x, 40); near(rb.y, -40); near(rb.width, 20); near(rb.height, 100)
  const eb = objectBounds(createObject('ellipse', { x: 0, y: 0, width: 100, height: 20, rotation: 90 }))
  near(eb.width, 20); near(eb.height, 100)
  const curve = createObject('path', { x: 0, y: 0, width: 100, height: 0, points: [{ x: 0, y: 0, out: { x: 0, y: 100 } }, { x: 100, y: 0, in: { x: 100, y: 100 } }] })
  const cb = objectBounds(curve)
  near(cb.x, 0); near(cb.width, 100); near(cb.height, 75)
})

test('path serialization retains asymmetric cubic controls and closed paths', () => {
  assert.equal(pathData([{ x: 0, y: 0, out: { x: 3, y: 10 } }, { x: 20, y: 2, in: { x: 19, y: 8 } }], true), 'M 0 0 C 3 10 19 8 20 2 L 0 0 Z')
  assert.equal(pathData([]), '')
  assert.equal(pathData([{ x: NaN, y: Infinity }]), 'M 0 0')
})

test('corner resize keeps the rotated opposite corner fixed', () => {
  const object = createObject('rect', { x: -50, y: -10, width: 100, height: 40, rotation: 37 })
  const anchor = objectLocalToWorld(object, { x: 0, y: 0 })
  const target = objectLocalToWorld(object, { x: 180, y: 70 })
  const next = resizeObjectFromHandle(object, 'se', target)
  near(next.width, 180); near(next.height, 70)
  const retained = objectLocalToWorld(next, { x: 0, y: 0 })
  near(retained.x, anchor.x); near(retained.y, anchor.y)
})

test('edge resizing changes only its axis and preserves cubic control proportions', () => {
  const object = createObject('path', { x: 10, y: 20, width: 100, height: 80, rotation: 25, points: [{ x: 0, y: 0, out: { x: 25, y: 20 } }, { x: 100, y: 80 }] })
  const next = resizeObjectFromHandle(object, 'e', objectLocalToWorld(object, { x: 200, y: 40 }))
  near(next.width, 200); near(next.height, 80)
  near(next.points![0].out!.x, 50); near(next.points![0].out!.y, 20)
  const oldAnchor = objectLocalToWorld(object, { x: 0, y: 40 }), nextAnchor = objectLocalToWorld(next, { x: 0, y: 40 })
  near(oldAnchor.x, nextAnchor.x); near(oldAnchor.y, nextAnchor.y)
})

test('centered aspect resizing preserves center and proportions', () => {
  const object = createObject('rect', { x: -50, y: -25, width: 100, height: 50, rotation: 12 })
  const next = resizeObjectFromHandle(object, 'se', objectLocalToWorld(object, { x: 180, y: 100 }), { fromCenter: true, preserveAspect: true })
  near(next.width / next.height, 2)
  near(objectCenter(next).x, objectCenter(object).x); near(objectCenter(next).y, objectCenter(object).y)
})

test('pen completion rebases nodes and handles without changing world geometry', () => {
  const object = createObject('path', { x: 0, y: 0, width: 0, height: 0, rotation: 27, points: [{ x: -100, y: -20, out: { x: -100, y: 80 } }, { x: 0, y: -20, in: { x: 0, y: 80 } }] })
  const next = normalizePathObject(object)
  near(next.width, 100); near(next.height, 75)
  for (let index = 0; index < object.points!.length; index++) {
    const before = objectLocalToWorld(object, object.points![index]), after = objectLocalToWorld(next, next.points![index])
    near(before.x, after.x); near(before.y, after.y)
    const handle = object.points![index].out ?? object.points![index].in!
    const nextHandle = next.points![index].out ?? next.points![index].in!
    const bh = objectLocalToWorld(object, handle), ah = objectLocalToWorld(next, nextHandle)
    near(bh.x, ah.x); near(bh.y, ah.y)
  }
  const beforeBounds = objectBounds(object), afterBounds = objectBounds(next)
  near(beforeBounds.x, afterBounds.x); near(beforeBounds.y, afterBounds.y)
  near(beforeBounds.width, afterBounds.width); near(beforeBounds.height, afterBounds.height)
})

test('numeric width changes use the local frame of a rotated object', () => {
  const object = createObject('rect', { id: 'rect', x: -50, y: -25, width: 100, height: 50, rotation: 45 })
  const next = resizeSelection([object], ['rect'], object, { x: -100, y: -25, width: 200, height: 50 })[0]
  near(next.width, 200); near(next.height, 50); near(next.rotation, 45)
  near(objectCenter(next).x, 0); near(objectCenter(next).y, 0)
  const moved = translateSelection([next], ['rect'], { x: -30, y: 20 })[0]
  near(moved.x, -130); near(moved.y, -5)
})

test('resizing horizontal lines can add a vertical dimension', () => {
  const object = createObject('line', { x: 0, y: 0, width: 100, height: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] })
  const next = resizeObjectFromHandle(object, 'se', { x: 140, y: 60 })
  near(next.width, 140); near(next.height, 60)
  assert.deepEqual(next.points, [{ x: 0, y: 0 }, { x: 140, y: 60 }])
})

test('text edge and numeric resize retain nominal font size and independent glyph scales', () => {
  const object = createObject('text', { id: 'text', x: 0, y: 0, width: 100, height: 48, text: 'Hello\nWorld', fontSize: 20, textScaleX: 1.5, textScaleY: .75 })
  const wide = resizeObjectFromHandle(object, 'e', { x: 200, y: 24 })
  near(wide.width, 200); near(wide.height, 48)
  near(wide.textScaleX!, 3); near(wide.textScaleY!, .75); near(wide.fontSize!, 20)
  const tall = resizeObjectFromHandle(wide, 's', { x: 100, y: 96 })
  near(tall.textScaleX!, 3); near(tall.textScaleY!, 1.5); near(tall.fontSize!, 20)
  const numeric = resizeSelection([object], ['text'], object, { x: -50, y: 0, width: 200, height: 48 })[0]
  near(numeric.textScaleX!, 3); near(numeric.textScaleY!, .75); near(numeric.rotation, object.rotation)
  const document = { ...createDocument(), objects: [tall] }
  const svg = serializeSvg(document)
  assert.ok(svg.includes('transform="scale(3 1.5)"'))
  assert.deepEqual(parseSvgDocument(svg), document)
})

test('text scale-only edits enter history and older text drawings default to unit scales', () => {
  const document = { ...createDocument(), objects: [createObject('text', { text: 'Hello' })] }
  const history = new DrawingHistory(document)
  history.commit({ ...document, objects: document.objects.map(object => ({ ...object, textScaleX: 2 })) })
  near(history.current.objects[0].textScaleX!, 2)
  near(history.undo().objects[0].textScaleX!, 1)
  delete document.objects[0].textScaleX; delete document.objects[0].textScaleY
  const restored = normalizeDocument(document)!
  near(restored.objects[0].textScaleX!, 1); near(restored.objects[0].textScaleY!, 1)
  document.objects[0].textScaleX = -.5; document.objects[0].textScaleY = 100_000
  const safe = normalizeDocument(document)!
  near(safe.objects[0].textScaleX!, .01); near(safe.objects[0].textScaleY!, 1000)
})

test('selection scaling and rotation preserve relative centers', () => {
  const a = createObject('rect', { id: 'a', x: -100, y: -50, width: 50, height: 50 }), b = createObject('rect', { id: 'b', x: 0, y: 0, width: 50, height: 50 })
  assert.equal(selectionBounds([], []), null)
  const bounds = selectionBounds([a, b])!
  const resized = resizeSelection([a, b], ['a', 'b'], bounds, { x: bounds.x, y: bounds.y, width: bounds.width * 2, height: bounds.height * 2 })
  near(resized[0].width, 100); near(resized[1].x, 100)
  const rotated = rotateSelection([a, b], ['a', 'b'], 90, { x: 0, y: 0 })
  near(objectCenter(rotated[0]).x, 25); near(objectCenter(rotated[0]).y, -75)
  near(rotated[0].rotation, 90)
})

test('hit testing distinguishes unfilled shapes and follows curved segments', () => {
  const object = createObject('rect', { x: 0, y: 0, width: 100, height: 100, fill: 'none', rotation: 45 })
  assert.equal(hitTestObject(object, objectCenter(object)), false)
  assert.equal(hitTestObject(object, objectLocalToWorld(object, { x: 1, y: 40 })), true)
  const curve = createObject('path', { x: 0, y: 0, width: 100, height: 0, points: [{ x: 0, y: 0, out: { x: 0, y: 100 } }, { x: 100, y: 0, in: { x: 100, y: 100 } }] })
  assert.equal(hitTestObject(curve, { x: 50, y: 75 }), true)
  assert.equal(hitTestObject(curve, { x: 50, y: 0 }), false)
})

test('path hit bounds include rotated control hulls, stroke tolerance and filled interiors', () => {
  const curve = createObject('path', { x: -120, y: 40, width: 100, height: 0, rotation: 63, points: [{ x: 0, y: 0, out: { x: 0, y: 100 } }, { x: 100, y: 0, in: { x: 100, y: 100 } }] })
  assert.equal(hitTestObject(curve, objectLocalToWorld(curve, { x: 50, y: 75 })), true)
  assert.equal(hitTestObject(curve, objectLocalToWorld(curve, { x: 0, y: -4 }), 5), true)
  assert.equal(hitTestObject(curve, objectLocalToWorld(curve, { x: 400, y: 500 })), false)
  const polygon = createObject('path', { x: 0, y: 0, width: 100, height: 100, fill: '#fff', closed: true, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }] })
  assert.equal(hitTestObject(polygon, { x: 50, y: 40 }), true)
})

test('group expansion and layering retain groups and selected relative order', () => {
  const objects = ['a', 'b', 'c', 'd', 'e'].map(id => createObject('rect', { id, ...(['b', 'c'].includes(id) ? { groupId: 'g' } : {}) }))
  const ids = (items: typeof objects) => items.map(item => item.id).join('')
  assert.deepEqual(expandSelection(objects, ['c']), ['b', 'c'])
  assert.equal(ids(reorderObjects(objects, ['b'], 'forward')), 'adbce')
  assert.equal(ids(reorderObjects(objects, ['c'], 'backward')), 'bcade')
  assert.equal(ids(reorderObjects(objects, ['a', 'd'], 'front')), 'bcead')
  assert.equal(ids(reorderObjects(objects, ['e'], 'back')), 'eabcd')
  assert.equal(ids(reorderObjects(objects, ['b', 'c'], 'front')), 'adebc')
})

test('undo and redo use immutable snapshots and drop only the redo branch', () => {
  const initial = createDocument(), history = new DrawingHistory(initial, 3)
  initial.objects.push(createObject('rect'))
  assert.equal(history.current.objects.length, 0)
  history.commit(initial)
  initial.objects[0].x = 1000
  assert.equal(history.current.objects[0].x, 0)
  const second = history.current; second.objects.push(createObject('ellipse')); history.commit(second)
  assert.equal(history.undo().objects.length, 1); assert.equal(history.canRedo, true)
  assert.equal(history.redo().objects.length, 2)
  history.undo()
  const branch = history.current; branch.objects[0].x = 20; history.commit(branch)
  assert.equal(history.canRedo, false); assert.equal(history.current.objects[0].x, 20)
  assert.equal(history.undo().objects[0].x, 0)
})

test('SVG preserves editable content, escapes XML, embeds raster images and excludes editor grid', () => {
  const document = createDocument()
  document.objects.push(createObject('text', { id: 'text', x: -200, y: -30, text: '<script>alert("a&b")</script>\n한글', fontFamily: 'Noto Sans KR' }))
  document.objects.push(createObject('image', { src: 'data:image/png;base64,aGVsbG8=', x: 50, y: 50 }))
  const svg = serializeSvg(document, { background: '#fff', fontCss: '@font-face {font-family:"Example";src:url(data:font/woff2;base64,YQ==)}' })
  assert.ok(svg.includes('<metadata id="mew-drawing">'))
  assert.ok(svg.includes('&lt;script&gt;')); assert.equal(svg.includes('<script>'), false)
  assert.ok(svg.includes('<image href="data:image/png;base64,aGVsbG8="'))
  assert.ok(svg.includes('<defs><style>')); assert.equal(svg.includes('<pattern'), false)
  assert.deepEqual(parseSvgDocument(svg), normalizeDocument(document))
})

test('SVG export includes rotated stroke bounds and handles empty drawings', () => {
  const document = createDocument()
  assert.deepEqual(drawingExportBounds(document), { x: -256, y: -192, width: 512, height: 384 })
  document.objects.push(createObject('rect', { x: -100, y: -100, width: 100, height: 50, rotation: 90, strokeWidth: 10 }))
  const bounds = drawingExportBounds(document, 10)
  near(bounds.x, -90); near(bounds.y, -140); near(bounds.width, 80); near(bounds.height, 130)
})

test('invalid and unsafe imported drawings are rejected or normalized', () => {
  const document = createDocument()
  document.objects = [createObject('rect', { x: Infinity, y: NaN, width: -1, fill: 'url(https://example.com/image)' })]
  const normalized = normalizeDocument(document)!
  assert.equal(normalized.objects[0].x, 0); assert.equal(normalized.objects[0].y, 0)
  assert.equal(normalized.objects[0].width, 0); assert.equal(normalized.objects[0].fill, 'none')
  assert.equal(normalizeDocument({ ...document, version: 2 }), null)
  assert.equal(normalizeDocument({ ...document, objects: [createObject('image', { src: 'https://example.com/a.png' })] }), null)
  assert.equal(normalizeDocument({ ...document, objects: [createObject('image', { src: 'data:image/svg+xml;base64,YQ==' })] }), null)
  assert.equal(parseSvgDocument('<svg><script>alert(1)</script></svg>'), null)
  assert.equal(parseSvgDocument('<svg><metadata id="mew-drawing">{bad}</metadata></svg>'), null)
  assert.deepEqual(cloneDocument(document).objects[0].x, Infinity)
})
