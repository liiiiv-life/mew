import assert from 'node:assert/strict'
import test from 'node:test'
import { addDockGroup, defaultDockTree, closeDockGroup, dockIds, dockRects, emptyDock, insertDock, normalizeDock, pruneDock, removeDock, type DockGroup, type DockNode } from './dock-layout.ts'
const groups: DockGroup[] = [{ id: 'editor', kind: 'editor' }, { id: 'agent', kind: 'agent' }, { id: 'terminal', kind: 'terminal' }, { id: 'memo', kind: 'memo' }]
const stacked: DockNode = { axis: 'col', ratio: .6, first: { id: 'editor' }, second: { id: 'agent' } }
test('desktop defaults stack terminal below editor, git above agent, and tasks below features', () => {
  const all: DockGroup[] = [...groups, { id: 'git', kind: 'git' }, { id: 'features', kind: 'features' }, { id: 'tasks', kind: 'tasks' }]
  const tree = defaultDockTree({ id: 'editor' }, all)
  const rects = dockRects(tree, { x: 0, y: 0, width: 1568, height: 900 })
  assert.equal(rects.editor.x, rects.terminal.x)
  assert.equal(rects.editor.width, rects.terminal.width)
  assert.ok(rects.terminal.y > rects.editor.y)
  assert.equal(rects.git.x, rects.agent.x)
  assert.equal(rects.git.width, rects.agent.width)
  assert.ok(rects.agent.y > rects.git.y)
  assert.equal(rects.features.x, rects.tasks.x)
  assert.ok(rects.tasks.y > rects.features.y)
  assert.ok(rects.features.x > rects.git.x)
  assert.ok(rects.editor.width > rects.git.width * 1.9)
  const core = dockRects(pruneDock(tree, new Set(['editor', 'terminal', 'agent', 'git'])), { x: 0, y: 0, width: 1200, height: 900 })
  assert.ok(Math.abs(core.editor.width - (1200 - 4) * 2 / 3) < 1e-9)
  assert.deepEqual(normalizeDock({ ...emptyDock(), groups: all, tree }).tree, tree)
})
test('default geometry retains editor splits and hidden panel slots', () => {
  const editors: DockNode = { axis: 'row', ratio: .6, first: { id: 'editor' }, second: { id: 'editor:second' } }
  const tree = defaultDockTree(editors, groups)
  const hidden = pruneDock(tree, new Set(['editor', 'editor:second', 'agent']))
  const rects = dockRects(hidden, { x: 0, y: 0, width: 1200, height: 800 })
  assert.equal(rects.editor.height, 800)
  assert.equal(rects.agent.height, 800)
  assert.deepEqual(pruneDock(tree, new Set(['editor', 'editor:second'])), editors)
  assert.ok(dockIds(tree).includes('terminal'))
})
test('panels mounted after a saved layout use their default neighbor without rearranging saved branches', () => {
  const coreGroups: DockGroup[] = [...groups, { id: 'git', kind: 'git' }, { id: 'features', kind: 'features' }, { id: 'tasks', kind: 'tasks' }]
  const saved: DockNode = { axis: 'row', ratio: .72, first: { id: 'editor' }, second: { id: 'agent' } }
  let tree = addDockGroup(saved, { id: 'terminal', kind: 'terminal' }, coreGroups)
  tree = addDockGroup(tree, { id: 'git', kind: 'git' }, coreGroups)
  assert.equal('ratio' in tree && tree.ratio, .72)
  const rects = dockRects(tree, { x: 0, y: 0, width: 1200, height: 800 })
  assert.equal(rects.editor.width, (1200 - 4) * .72)
  assert.equal(rects.terminal.x, rects.editor.x)
  assert.equal(rects.git.x, rects.agent.x)
  assert.ok(rects.agent.y > rects.git.y)
  tree = addDockGroup(tree, { id: 'tasks', kind: 'tasks' }, coreGroups)
  tree = addDockGroup(tree, { id: 'features', kind: 'features' }, coreGroups)
  tree = addDockGroup(tree, { id: 'memo', kind: 'memo' }, coreGroups)
  const extended = dockRects(tree, { x: 0, y: 0, width: 1600, height: 800 })
  assert.ok(extended.tasks.y > extended.features.y)
  assert.equal(extended.memo.height, 800)
  assert.deepEqual(saved, { axis: 'row', ratio: .72, first: { id: 'editor' }, second: { id: 'agent' } })
})
test('a panel moves without duplication and empty branches collapse', () => {
  const tree = insertDock(stacked, 'terminal', 'agent', 'right', groups)
  const moved = insertDock(tree, 'terminal', 'editor', 'top', groups)!
  assert.deepEqual(dockIds(moved).sort(), ['agent', 'editor', 'terminal'])
  assert.deepEqual(removeDock(removeDock(moved, 'agent'), 'terminal'), { id: 'editor' })
})
test('hidden panels do not occupy space and saved geometry survives reopening', () => {
  const tree = insertDock(stacked, 'memo', 'editor', 'left', groups)!
  assert.deepEqual(pruneDock(tree, new Set(['editor'])), { id: 'editor' })
  assert.deepEqual(dockIds(tree), ['memo', 'editor', 'agent'])
  const rects = dockRects(pruneDock(tree, new Set(['editor', 'memo'])), { x: 0, y: 0, width: 1000, height: 700 })
  assert.equal(rects.memo.height, 700)
  assert.equal(rects.editor.height, 700)
})
test('persisted invalid layouts are bounded and deduplicated', () => {
  const state = normalizeDock({ ...emptyDock(), groups: [null, false, ...groups], tree: { axis: 'col', ratio: -2, first: { id: 'memo' }, second: { axis: 'row', ratio: .5, first: { id: 'editor' }, second: { id: 'editor' } } } })
  assert.deepEqual(state.tree, { axis: 'col', ratio: .15, first: { id: 'memo' }, second: { id: 'editor' } })
  assert.deepEqual(normalizeDock({ version: 500 }), emptyDock())
})
test('splitting a tab into a new group retains the original group', () => {
  const tree = insertDock(stacked, 'agent:detached', 'agent', 'bottom', [...groups, { id: 'agent:detached', kind: 'agent' }])!
  assert.deepEqual(dockIds(tree), ['editor', 'agent', 'agent:detached'])
  const rects = dockRects(tree, { x: 0, y: 0, width: 1000, height: 800 })
  assert.ok(rects['agent:detached'].y > rects.agent.y)
})

function splitAgentState() {
  return {
    ...emptyDock(),
    groups: [...groups, { id: 'agent:split', kind: 'agent' as const }],
    tree: { axis: 'row' as const, ratio: .5, first: { id: 'agent' }, second: { id: 'agent:split' } },
    tabs: { 'agent:a2': 'agent:split' },
    active: { agent: 'a1', 'agent:split': 'a2' },
  }
}
test('closing the default panel keeps the sibling open and gives it the entire former split', () => {
  const next = closeDockGroup(splitAgentState(), 'agent', ['a1'], 'agent:split')
  assert.deepEqual(next.tree, { id: 'agent:split' })
  assert.deepEqual(next.tabs, { 'agent:a1': 'agent:split', 'agent:a2': 'agent:split' })
  assert.equal(next.active['agent:split'], 'a2')
  assert.equal(dockRects(next.tree, { x: 0, y: 0, width: 900, height: 600 })['agent:split'].width, 900)
  assert.deepEqual(normalizeDock(next).tree, next.tree)
})
test('closing a detached panel removes its saved split and preserves the default panel tabs', () => {
  const next = closeDockGroup(splitAgentState(), 'agent:split', ['a2'], 'agent')
  assert.deepEqual(next.tree, { id: 'agent' })
  assert.equal(next.tabs['agent:a2'], 'agent')
  assert.equal(next.active.agent, 'a1')
  assert.ok(!next.groups.some((group) => group.id === 'agent:split'))
})
test('closing the last panel preserves tabs for reopening without preserving an empty split', () => {
  const first = closeDockGroup(splitAgentState(), 'agent', ['a1'], 'agent:split')
  const closed = closeDockGroup(first, 'agent:split', ['a1', 'a2'])
  assert.equal(closed.tree, null)
  assert.deepEqual(closed.tabs, { 'agent:a1': 'agent', 'agent:a2': 'agent' })
  assert.ok(closed.groups.some((group) => group.id === 'agent'))
  assert.ok(!closed.groups.some((group) => group.id === 'agent:split'))
})

test('memo and task layouts persist without losing neighboring panels', () => {
  const state = normalizeDock({ version: 1, groups: [{ id: 'memo', kind: 'memo' }, { id: 'tasks', kind: 'tasks' }, { id: 'editor', kind: 'editor' }], tree: { axis: 'row', ratio: .5, first: { id: 'tasks' }, second: { axis: 'row', ratio: .5, first: { id: 'memo' }, second: { id: 'editor' } } } })
  assert.deepEqual(state.groups.map(g => g.id), ['memo', 'tasks', 'editor'])
  assert.deepEqual(dockIds(state.tree), ['tasks', 'memo', 'editor'])
})

test('retired browser panels disappear from saved geometry and tab assignments', () => {
  const state = normalizeDock({ version: 1, groups: [{ id: 'browser', kind: 'browser' }, { id: 'browser:split', kind: 'browser' }, { id: 'editor', kind: 'editor' }], tree: { axis: 'row', ratio: .5, first: { id: 'browser' }, second: { id: 'editor' } }, tabs: { 'browser:one': 'browser', 'browser:two': 'browser:split', 'editor:main': 'editor' }, active: { browser: 'one', 'browser:split': 'two', editor: 'main' } })
  assert.deepEqual(state.groups, [{ id: 'editor', kind: 'editor' }])
  assert.deepEqual(state.tree, { id: 'editor' })
  assert.deepEqual(state.tabs, { 'editor:main': 'editor' })
  assert.deepEqual(state.active, { editor: 'main' })
})
