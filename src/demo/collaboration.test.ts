import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { createDemoCollaboration } from './collaboration.ts'
import { DemoWorkspaceStore } from './workspace-store.ts'
import type { CollaborationSession } from '../runtime/app-runtime.ts'

test('local collaboration keeps editor documents in sync with the shared workspace', async t => {
  const browser = new Window({ url: 'http://demo.test' })
  const global = globalThis as unknown as Record<string, unknown>
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const key of ['window', 'self', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver']) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value: (browser as unknown as Record<string, unknown>)[key] ?? browser })
  }
  const store = new DemoWorkspaceStore(), provider = createDemoCollaboration(store)
  t.after(async () => {
    provider.close(); store.close(); await browser.happyDOM.abort()
    for (const [key, original] of originals) { if (original) Object.defineProperty(globalThis, key, original); else delete global[key] }
  })
  let document: CollaborationSession | undefined
  const connection = provider.open({ project: '.workspace', path: store.demoFilePath, authEmail: 'visitor@example.test' }, session => { document = session })
  const deadline = Date.now() + 5000
  while (!document?.synced) { assert.ok(Date.now() < deadline, 'local collaboration initialized'); await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.equal(document.connected, true)
  assert.match(document.ydoc.getXmlFragment('default').toString(), /Mew를 Mew 안에서 둘러보세요/)
  let alias: CollaborationSession | undefined
  const other = provider.open({ project: 'docs', path: 'welcome.md', authEmail: 'visitor@example.test' }, session => { alias = session })
  assert.equal(alias?.ydoc, document.ydoc, 'project aliases share one canonical document')
  const updated = store.readFile(store.demoFilePath).content + '\n\n## Agent update\n\nA shared workspace change.\n'
  store.writeFile(store.demoFilePath, updated)
  assert.match(document.ydoc.getXmlFragment('default').toString(), /A shared workspace change/)
  assert.equal(document.ydoc.getText('content').toString(), updated)
  const identity = document.ydoc
  connection.close(); other.close()
  provider.open({ project: '.workspace', path: store.demoFilePath, authEmail: 'visitor@example.test' }, session => { document = session })
  assert.equal(document.ydoc, identity, 'closing a pane preserves its local CRDT identity')
  let code: CollaborationSession | undefined
  provider.open({ project: '.workspace', path: 'src/main.tsx', authEmail: 'visitor@example.test' }, session => { code = session })
  assert.equal(code?.synced, true)
  store.writeFile('src/main.tsx', 'export const demo = true\n')
  assert.equal(code?.ydoc.getText('content').toString(), 'export const demo = true\n')

  store.openWorkspace(`${store.workspacePath}/docs`)
  const nestedProvider = createDemoCollaboration(store)
  try {
    let nested: CollaborationSession | undefined
    nestedProvider.open({ project: '.workspace', path: 'welcome.md', authEmail: 'visitor@example.test' }, session => { nested = session })
    const nestedDeadline = Date.now() + 5000
    while (!nested?.synced) { assert.ok(Date.now() < nestedDeadline, 'nested collaboration initialized'); await new Promise(resolve => setTimeout(resolve, 10)) }
    assert.match(nested.ydoc.getXmlFragment('default').toString(), /A shared workspace change/)
    assert.equal(nested.ydoc.getText('content').toString(), updated)
    const nestedContent = updated + '\nA change from the nested workspace.\n'
    store.writeFile('welcome.md', nestedContent)
    assert.match(nested.ydoc.getXmlFragment('default').toString(), /A change from the nested workspace/)
    assert.equal(nested.ydoc.getText('content').toString(), nestedContent)
    assert.equal(document.ydoc.getText('content').toString(), nestedContent, 'old rooms keep their canonical identity when the workspace changes')
  } finally { nestedProvider.close() }
})
