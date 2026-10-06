import test from 'node:test'
import assert from 'node:assert/strict'
import { adjacentDockPanel, MOBILE_DOCK_ORDER, moveDockPanel, normalizeMobileDockOrder, normalizeHiddenDockPanels, visibleDockPanels } from './mobile-dock.ts'

test('dock order preserves customization and inserts new entries before desktop', () => {
  assert.deepEqual(normalizeMobileDockOrder(null), MOBILE_DOCK_ORDER)
  assert.deepEqual(normalizeMobileDockOrder(MOBILE_DOCK_ORDER.filter(id => id !== 'tasks')), MOBILE_DOCK_ORDER)
  assert.deepEqual(normalizeMobileDockOrder(['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'desktop']), MOBILE_DOCK_ORDER)
  assert.deepEqual(normalizeMobileDockOrder(['git', 'git', 'unknown', 'editor']), ['git', 'editor', 'sidebar', 'agent', 'terminal', 'browser', 'features', 'debugger', 'desktop', 'memo', 'tasks'])
  assert.deepEqual(normalizeMobileDockOrder(['browser', 'sidebar', 'editor', 'agent', 'terminal', 'git']), ['browser', 'sidebar', 'editor', 'agent', 'terminal', 'git', 'features', 'debugger', 'desktop', 'memo', 'tasks'])
  assert.deepEqual(moveDockPanel([...MOBILE_DOCK_ORDER], 'desktop', 'sidebar'), ['desktop', 'sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'debugger', 'memo', 'tasks'])
})
test('swipes use adjacent allowed panels, preserve custom order and stop at either end', () => {
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'editor', -1), 'sidebar')
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'editor', 1), 'agent')
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'browser', 1), 'features')
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'features', 1), 'debugger')
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'sidebar', -1), undefined)
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'desktop', 1), 'memo')
  assert.equal(adjacentDockPanel(['editor', 'desktop', 'sidebar'], 'editor', 1), 'desktop')
  assert.equal(adjacentDockPanel(['sidebar', 'editor'], 'editor', 1), undefined)
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'memo', 1), 'tasks')
  assert.equal(adjacentDockPanel(MOBILE_DOCK_ORDER, 'chat', 1), undefined)
  assert.equal(adjacentDockPanel([], 'editor', 1), undefined)
})

test('task entries persist and retired RAG entries disappear without changing the customized dock order', () => {
  const saved = ['memo', 'tasks', 'rag', 'git', 'editor', 'sidebar', 'agent', 'terminal', 'browser', 'features', 'debugger', 'desktop', 'rag']
  assert.deepEqual(normalizeMobileDockOrder(saved), ['memo', 'tasks', 'git', 'editor', 'sidebar', 'agent', 'terminal', 'browser', 'features', 'debugger', 'desktop'])
})

test('visibility filters preferences and permissions without losing stored order', () => {
  assert.deepEqual(normalizeHiddenDockPanels(null), [])
  assert.deepEqual(normalizeHiddenDockPanels(['agent', 'agent', 'rag', 3, null]), ['agent'])
  const order = normalizeMobileDockOrder(['git', 'agent', 'editor'])
  assert.deepEqual(visibleDockPanels(order, ['editor', 'agent', 'git'], ['agent']), ['git', 'editor'])
  assert.deepEqual(visibleDockPanels(order, ['editor', 'agent', 'git'], ['git', 'editor', 'agent']), [])
  assert.deepEqual(visibleDockPanels(order, ['editor', 'agent', 'git'], []), ['git', 'agent', 'editor'])
})
