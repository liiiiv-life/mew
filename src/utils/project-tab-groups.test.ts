import test from 'node:test'
import assert from 'node:assert/strict'
import { moveProjectTab, normalizeProjectTabLayout, projectTabDropZone } from '../../shared/project-tab-groups.ts'

const empty = () => ({ paths: ['/a', '/b', '/c', '/d'], groups: [] })

test('the middle 50% groups; both outer quarters insert', () => {
  assert.equal(projectTabDropZone(124.9, 100, 100), 'before')
  assert.equal(projectTabDropZone(125, 100, 100), 'group')
  assert.equal(projectTabDropZone(175, 100, 100), 'group')
  assert.equal(projectTabDropZone(175.1, 100, 100), 'after')
})

test('create, append, reorder inside, transfer and extract without losing paths', () => {
  let layout = moveProjectTab(empty(), '/a', { type: 'group', path: '/b' }, 'one')
  assert.deepEqual(layout, { paths: ['/b', '/a', '/c', '/d'], groups: [{ id: 'one', paths: ['/b', '/a'], collapsed: false }] })
  layout.groups[0].collapsed = true
  layout = moveProjectTab(layout, '/c', { type: 'group', path: '/b' }, 'unused')
  assert.deepEqual(layout.groups[0], { id: 'one', paths: ['/b', '/a', '/c'], collapsed: false })
  layout = moveProjectTab(layout, '/c', { type: 'insert', path: '/b', side: 'before' }, 'unused')
  assert.deepEqual(layout.groups[0].paths, ['/c', '/b', '/a'])
  layout = moveProjectTab(layout, '/b', { type: 'group', path: '/d' }, 'two')
  assert.deepEqual(layout.groups.map(g => g.paths), [['/c', '/a'], ['/d', '/b']])
  layout = moveProjectTab(layout, '/a', { type: 'group', path: '/d' }, 'unused')
  assert.deepEqual(layout.paths, ['/c', '/d', '/b', '/a'])
  assert.deepEqual(layout.groups.map(g => g.paths), [['/d', '/b', '/a']])
  layout = moveProjectTab(layout, '/d', { type: 'end' }, 'unused')
  assert.deepEqual(layout.paths, ['/c', '/b', '/a', '/d'])
  assert.deepEqual(layout.groups[0].paths, ['/b', '/a'])
  layout = moveProjectTab(layout, '/a', { type: 'end' }, 'unused')
  assert.deepEqual(layout.groups, [])
  assert.deepEqual([...layout.paths].sort(), empty().paths)
})

test('group outer edges extract a member or insert an independent tab', () => {
  const layout = normalizeProjectTabLayout(empty().paths, [{ id: 'g', paths: ['/a', '/b', '/c'] }])
  const extracted = moveProjectTab(layout, '/a', { type: 'insert', path: '/a', side: 'before', outsideGroup: true }, 'unused')
  assert.deepEqual(extracted.paths, ['/a', '/b', '/c', '/d'])
  assert.deepEqual(extracted.groups[0].paths, ['/b', '/c'])
  const last = moveProjectTab(layout, '/c', { type: 'insert', path: '/c', side: 'after', outsideGroup: true }, 'unused')
  assert.deepEqual(last.paths, ['/a', '/b', '/c', '/d'])
  assert.deepEqual(last.groups[0].paths, ['/a', '/b'])
  const inserted = moveProjectTab(layout, '/d', { type: 'insert', path: '/b', side: 'after', outsideGroup: true }, 'unused')
  assert.deepEqual(inserted.paths, ['/a', '/b', '/c', '/d'])
  assert.deepEqual(inserted.groups[0].paths, ['/a', '/b', '/c'])
})

test('legacy, stale, duplicate and malformed state keeps each open path once', () => {
  assert.deepEqual(normalizeProjectTabLayout(empty().paths, undefined), empty())
  const layout = normalizeProjectTabLayout(['/a', '/b', '/c', '/a', '/d'], [null,
    { id: 'one', paths: ['/c', '/a', '/gone', '/a'], collapsed: true },
    { id: 'one', paths: ['/b', '/d'] },
    { id: 'invalid space', paths: ['/b', '/d'] },
    { id: 'two', paths: ['/a', '/b', '/d'] },
  ])
  assert.deepEqual(layout.paths, ['/a', '/c', '/b', '/d'])
  assert.deepEqual(layout.groups, [{ id: 'one', paths: ['/a', '/c'], collapsed: true }, { id: 'two', paths: ['/b', '/d'], collapsed: false }])
  assert.deepEqual(normalizeProjectTabLayout(['/c', '/b'], layout.groups).groups, [])
  assert.deepEqual(moveProjectTab(layout, '/gone', { type: 'end' }, 'new'), layout)
  assert.deepEqual(moveProjectTab(layout, '/a', { type: 'group', path: '/c' }, 'new'), layout)
})
