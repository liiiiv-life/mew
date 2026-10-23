import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DemoError, DemoWorkspaceStore } from './workspace-store.ts'

test('each visitor owns isolated files, settings, history and reset', () => {
  const first = new DemoWorkspaceStore(), second = new DemoWorkspaceStore()
  const initial = first.readFile('welcome.md', 'docs').content
  first.writeFile('welcome.md', initial + '\nMy idea\n', 'docs')
  first.setState('ui', { nested: { active: 'welcome.md' } })
  first.commit('Write an idea')
  assert.equal(second.readFile('welcome.md', 'docs').content, initial)
  assert.equal(second.gitLog().commits.length, 1)
  assert.equal(second.getState('ui', null), null)
  first.reset()
  assert.equal(first.readFile('welcome.md', 'docs').content, initial)
  assert.equal(first.gitWorkingTree().files.length, 0)
  assert.equal(first.gitLog().commits.length, 1)
  assert.equal(first.getState('ui', null), null)
})

test('workspace, documents and absolute references share file content and version', () => {
  const store = new DemoWorkspaceStore()
  const a = store.readFile('docs/welcome.md'), b = store.readFile('welcome.md', 'docs')
  assert.deepEqual(a.version, b.version)
  assert.equal(store.canonicalFilePath('welcome.md', 'docs'), 'docs/welcome.md')
  store.writeFile(`${store.workspacePath}/docs/welcome.md`, 'A changed document')
  assert.equal(store.readFile('welcome.md', 'docs').content, 'A changed document')
  assert.notEqual(store.readFile('welcome.md', 'docs').version.tag, a.version.tag)
  assert.equal(store.readFile('welcome.md', 'docs').path, 'welcome.md')
})

test('file mutations update lazy/full trees and Git from one state', () => {
  const store = new DemoWorkspaceStore(), events: string[] = []
  const unsubscribe = store.subscribe(event => events.push(event.type))
  store.createDirectory('ideas')
  store.writeFile('ideas/notes.md', '# Next idea\n')
  assert.equal(store.tree().find(node => node.path === 'ideas')?.children, undefined)
  assert.equal(store.tree('.workspace', '', true).find(node => node.path === 'ideas')?.children?.[0].path, 'ideas/notes.md')
  assert.equal(store.gitWorkingTree().files.find(file => file.path === 'ideas/notes.md')?.status, '?')
  const copied = store.movePath('ideas', 'ideas-copy', '.workspace', true)
  assert.equal(copied, 'ideas-copy')
  store.movePath('ideas/notes.md', 'ideas/renamed.md')
  assert.equal(store.readFile('ideas/renamed.md').content, '# Next idea\n')
  store.deletePath('ideas-copy')
  assert.throws(() => store.readFile('ideas-copy/notes.md'), { status: 404 })
  assert.ok(events.includes('files') && events.includes('git'))
  unsubscribe(); const previous = events.length
  store.writeFile('ideas/renamed.md', 'No listener')
  assert.equal(events.length, previous)
})

test('selected commits preserve unselected changes and exact prior file versions', () => {
  const store = new DemoWorkspaceStore(), original = store.readFile('README.md').content
  const firstHash = store.gitLog().commits[0].hash
  store.writeFile('README.md', original + '\nA new idea\n')
  store.writeFile('src/new.ts', 'export const idea = 1\n')
  assert.match(store.gitDiff('README.md').diff, /\+A new idea/)
  const result = store.commit('Document the idea', 'One selected file.', ['README.md'])
  assert.equal(store.gitWorkingTree().files.length, 1)
  assert.equal(store.gitWorkingTree().files[0].path, 'src/new.ts')
  assert.equal(store.gitCommit(result.hash).snapshot['README.md'], original + '\nA new idea\n')
  assert.equal(store.gitCommit(firstHash).snapshot['README.md'], original)
  assert.match(store.gitDiff('README.md', result.hash).diff, /\+A new idea/)
  store.discard(['src/new.ts'])
  assert.equal(store.gitWorkingTree().files.length, 0)
  store.deletePath('README.md')
  assert.equal(store.gitWorkingTree().files[0].status, 'D')
  store.discard(['README.md'])
  assert.equal(store.readFile('README.md').content, original + '\nA new idea\n')
})

test('outside paths, conflicts and descendant moves cannot corrupt a workspace', () => {
  const store = new DemoWorkspaceStore(), original = store.readFile('README.md').content
  for (const path of ['../private', '/etc/passwd', 'docs/../../private', 'bad\\file', 'bad\0file']) assert.throws(() => store.writeFile(path, 'bad'), DemoError)
  assert.throws(() => store.writeFile('README.md', 'replacement', '.workspace', 'stale content'), { status: 409 })
  assert.throws(() => store.movePath('docs', 'docs/nested'), DemoError)
  assert.throws(() => store.deletePath(''), DemoError)
  assert.throws(() => store.writeFile('README.md/ghost/note.md', 'bad'), { status: 409 })
  assert.throws(() => store.tree('.workspace', 'README.md/ghost'), { status: 404 })
  assert.equal(store.readFile('README.md').content, original)
  assert.equal(store.gitWorkingTree().files.length, 0)
})

test('opening an example folder changes relative file scope while preserving canonical files', () => {
  const store = new DemoWorkspaceStore()
  store.openWorkspace(`${store.workspacePath}/src`)
  assert.equal(store.workspaceInfo().path, `${store.workspacePath}/src`)
  assert.equal(store.readFile('main.tsx').content, store.readFile(`${store.workspacePath}/src/main.tsx`).content)
  store.writeFile('notes.md', 'A local note')
  store.openWorkspace(store.workspacePath)
  assert.equal(store.readFile('src/notes.md').content, 'A local note')
  assert.equal(store.readFile('welcome.md', 'docs').path, 'welcome.md')
})

test('Git paths remain repository-relative after opening a nested workspace', () => {
  const store = new DemoWorkspaceStore(), initial = store.readFile('welcome.md', 'docs').content
  store.openWorkspace(`${store.workspacePath}/docs`)
  store.writeFile('welcome.md', '# Updated\n')
  assert.deepEqual(store.gitWorkingTree().files, [{ path: 'docs/welcome.md', status: 'M' }])
  assert.match(store.gitDiff('docs/welcome.md').diff, /\+# Updated/)
  const committed = store.commit('Update a nested workspace document', '', ['docs/welcome.md'])
  assert.match(store.gitDiff('docs/welcome.md', committed.hash).diff, /\+# Updated/)
  store.writeFile('welcome.md', '# Updated again\n')
  store.discard(['docs/welcome.md'])
  assert.equal(store.readFile('welcome.md').content, '# Updated\n')
  assert.equal(store.gitWorkingTree().files.length, 0)
  assert.equal(store.gitCommit(store.gitLog().commits[1].hash).snapshot['docs/welcome.md'], initial)
})

test('settings snapshots cannot mutate the store through shared references', () => {
  const store = new DemoWorkspaceStore(), input = { items: ['first'] }
  store.setState('settings', input)
  input.items.push('outside')
  const result = store.getState('settings', { items: [] as string[] }); result.items.push('inside')
  assert.deepEqual(store.getState('settings', null), { items: ['first'] })
})

test('history snapshots cannot mutate a commit through nested array or object references', () => {
  const store = new DemoWorkspaceStore(), log = store.gitLog(), hash = log.commits[0].hash
  log.commits[0].parents.push('outside')
  log.commits[0].refs.push('outside')
  log.commits[0].subject = 'outside'
  const detail = store.gitCommit(hash)
  detail.snapshot['README.md'] = 'outside'; detail.files[0].path = 'outside'
  assert.deepEqual(store.gitLog().commits[0].parents, [])
  assert.deepEqual(store.gitLog().commits[0].refs, ['HEAD -> main'])
  assert.equal(store.gitLog().commits[0].subject, 'Open Mew demo snapshot')
  assert.equal(store.gitCommit(hash).snapshot['README.md'], store.readFile('README.md').content)
  assert.notEqual(store.gitCommit(hash).files[0].path, 'outside')
})
