import assert from 'node:assert/strict'
import test from 'node:test'
import { mostRecentTabPath, nextTabNavigation, recordPaneActivation, remapTabNavigation } from './editor-tab-navigation.ts'

test('activation order follows logical tabs across replacement, reordering and removal', () => {
  const one = { id: 'one', path: '1.md' }, two = { id: 'two', path: '2.md' }, three = { id: 'three', path: '3.md' }
  let pane = { tabs: [one, two, three], activePath: '3.md', activeTabId: 'three', recentTabIds: ['three', 'two', 'one'] }
  pane = recordPaneActivation(pane, { ...pane, activePath: '1.md', activeTabId: 'one' })
  const four = { id: 'four', path: '4.md' }
  pane = recordPaneActivation(pane, { ...pane, tabs: [...pane.tabs, four], activePath: '4.md', activeTabId: 'four' })
  assert.equal(mostRecentTabPath(pane, [three, two, one]), '1.md')
  const renamed = { ...one, path: 'renamed.md' }
  pane = recordPaneActivation(pane, { ...pane, tabs: [three, two, renamed], activePath: 'renamed.md', activeTabId: 'one' })
  assert.deepEqual(pane.recentTabIds, ['one', 'three', 'two'])
  assert.equal(mostRecentTabPath(pane, [two, three]), '3.md')
})

test('back/forward move the cursor and a new visit discards the forward branch', () => {
  const first = { path: 'a.md' }
  const second = { path: 'b.md', navigation: nextTabNavigation(first, 'b.md') }
  const third = { path: 'c.md', navigation: nextTabNavigation(second, 'c.md') }
  const back = { path: 'b.md', navigation: nextTabNavigation(third, 'b.md', 1) }
  assert.deepEqual(back.navigation, { entries: ['a.md', 'b.md', 'c.md'], index: 1 })
  assert.deepEqual(nextTabNavigation(back, 'd.md'), { entries: ['a.md', 'b.md', 'd.md'], index: 2 })
  assert.deepEqual(nextTabNavigation(back, 'b.md'), back.navigation)
})

test('renamed and deleted history paths preserve the current cursor and collapse identical neighbours', () => {
  const history = { entries: ['a.md', 'folder/b.md', 'c.md', 'future.md'], index: 2 }
  assert.deepEqual(remapTabNavigation(history, path => path.replace('folder/', 'renamed/')), { entries: ['a.md', 'renamed/b.md', 'c.md', 'future.md'], index: 2 })
  assert.deepEqual(remapTabNavigation(history, path => path === 'a.md' || path === 'future.md' ? null : path), { entries: ['folder/b.md', 'c.md'], index: 1 })
  assert.deepEqual(remapTabNavigation({ entries: ['a.md', 'b.md', 'c.md'], index: 1 }, path => path === 'b.md' ? 'a.md' : path), { entries: ['a.md', 'c.md'], index: 0 })
})
