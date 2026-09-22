import test from 'node:test'
import assert from 'node:assert/strict'
import { adjacentDockPanel, MOBILE_DOCK_ORDER, moveDockPanel, normalizeMobileDockOrder } from './mobile-dock.ts'

test('dock order preserves customization and appends the new feature entry before desktop', () => {
  assert.deepEqual(normalizeMobileDockOrder(null), MOBILE_DOCK_ORDER)
  assert.deepEqual(normalizeMobileDockOrder(['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'desktop']), MOBILE_DOCK_ORDER)
  assert.deepEqual(normalizeMobileDockOrder(['git', 'git', 'unknown', 'editor']), ['git', 'editor', 'sidebar', 'agent', 'terminal', 'browser', 'features', 'desktop', 'rag'])
  assert.deepEqual(normalizeMobileDockOrder(['browser', 'sidebar', 'editor', 'agent', 'terminal', 'git']), ['browser', 'sidebar', 'editor', 'agent', 'terminal', 'git', 'features', 'desktop', 'rag'])
  assert.deepEqual(moveDockPanel([...MOBILE_DOCK_ORDER], 'desktop', 'sidebar'), ['desktop', 'sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'rag'])
})
test('swipes use adjacent allowed panels, preserve custom order and stop at either end', () => {
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'editor', -1), 'sidebar')
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'editor', 1), 'agent')
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'browser', 1), 'features')
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'features', 1), 'desktop')
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'sidebar', -1), undefined)
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'desktop', 1), 'rag')
  assert.equal(adjacentDockPanel(['editor', 'desktop', 'sidebar'], 'editor', 1), 'desktop')
  assert.equal(adjacentDockPanel(['sidebar', 'editor'], 'editor', 1), undefined)
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'rag', 1), undefined)
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'chat', 1), undefined)
  assert.equal(adjacentDockPanel([], 'editor', 1), undefined)
})
