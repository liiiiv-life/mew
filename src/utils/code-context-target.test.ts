import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState, Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { Window } from 'happy-dom'
import { prepareCodeContext, type CodeContextSession } from './code-context-target.ts'

const win = new Window({ url: 'http://localhost' })
for (const key of ['window', 'document', 'DOMParser', 'navigator']) {
  Object.defineProperty(globalThis, key, { value: (win as unknown as Record<string, unknown>)[key], configurable: true })
}
function fixture(readOnly = false) {
  let state = EditorState.create({ doc: 'alpha bravo\nsecond line\n', extensions: EditorState.readOnly.of(readOnly) })
  let position = 3
  let current = true
  const sessions = new Set<CodeContextSession>()
  const contentDOM = document.createElement('div')
  contentDOM.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} })
  const transactions: Transaction[] = []
  const view = {
    get state() { return state }, contentDOM,
    posAtCoords: () => position,
    focus() {},
    dispatch(spec: Parameters<EditorState['update']>[0] | Transaction) {
      const transaction = spec instanceof Transaction ? spec : state.update(spec)
      transactions.push(transaction)
      state = transaction.state
      if (transaction.docChanged) for (const session of sessions) session.map(transaction.changes)
    },
  } as unknown as EditorView
  return {
    view, transactions,
    clickAt: (at: number) => { position = at },
    invalidate: () => { current = false },
    prepare(x = 10, y = 10) {
      let session: CodeContextSession
      session = prepareCodeContext(view, x, y, () => current, () => sessions.delete(session))
      sessions.add(session)
      return session.target
    },
  }
}
function clipboard(value: object) { Object.defineProperty(navigator, 'clipboard', { value, configurable: true }) }

test('CodeMirror context preserves a selection, maps it across changes, and copies exact source text', async () => {
  const test = fixture()
  test.view.dispatch({ selection: { anchor: 0, head: 5 } })
  const target = test.prepare()
  let copied = ''
  clipboard({ writeText: async (text: string) => { copied = text } })
  assert.equal(target.hasSelection, true)
  test.view.dispatch({ changes: { from: 0, insert: 'XX' }, selection: { anchor: 12 } })
  assert.equal(target.restoreSelection(), true)
  assert.equal(test.view.state.sliceDoc(test.view.state.selection.main.from, test.view.state.selection.main.to), 'alpha')
  assert.equal(await target.copy(), true)
  assert.equal(copied, 'alpha')
  target.dispose()
  assert.equal(target.restoreSelection(), false)
})

test('CodeMirror document margins target the beginning or the end instead of the old caret', () => {
  const test = fixture()
  test.view.dispatch({ selection: { anchor: 6 } })
  const top = test.prepare(10, -20)
  assert.equal(test.view.state.selection.main.head, 0)
  top.dispose()
  const bottom = test.prepare(10, 120)
  assert.equal(test.view.state.selection.main.head, test.view.state.doc.length)
  bottom.dispose()
})

test('clicking outside the selection collapses to that line; empty lines cannot be comment targets', () => {
  const test = fixture()
  test.view.dispatch({ selection: { anchor: 0, head: 5 } })
  test.clickAt(15)
  const target = test.prepare()
  assert.equal(target.hasSelection, false)
  assert.equal(test.view.state.selection.main.head, 15)
  assert.equal(target.canComment, true)
  assert.equal(target.selectCommentTarget(), true)
  assert.equal(test.view.state.sliceDoc(test.view.state.selection.main.from, test.view.state.selection.main.to), 'second line')
  target.dispose()
  test.clickAt(test.view.state.doc.length)
  const empty = test.prepare()
  assert.equal(empty.canComment, false)
  assert.equal(empty.selectCommentTarget(), false)
  empty.dispose()
})

test('cut, paste, delete and select all use native CodeMirror transactions', async () => {
  const test = fixture()
  let copied = ''
  clipboard({ writeText: async (text: string) => { copied = text }, readText: async () => 'new' })
  test.view.dispatch({ selection: { anchor: 0, head: 5 } })
  const target = test.prepare()
  assert.equal(await target.cut(), true)
  assert.equal(copied, 'alpha')
  assert.equal(test.view.state.doc.toString(), ' bravo\nsecond line\n')
  assert.equal(await target.paste(), true)
  assert.equal(test.view.state.doc.toString(), 'new bravo\nsecond line\n')
  assert.equal(test.transactions.at(-1)?.isUserEvent('input.paste'), true)
  assert.equal(target.selectAll(), true)
  // A menu session retains its original mapped selection until a new session is created.
  target.dispose()
  test.clickAt(3)
  const all = test.prepare()
  assert.equal(all.deleteSelection(), true)
  assert.equal(test.view.state.doc.toString(), '')
  all.dispose()
})

test('readonly context allows copying and select-all, while all mutation commands decline', async () => {
  const test = fixture(true)
  let copied = ''
  clipboard({ writeText: async (text: string) => { copied = text } })
  test.view.dispatch({ selection: { anchor: 0, head: 5 } })
  const target = test.prepare()
  assert.equal(target.editable, false)
  assert.equal(await target.copy(), true)
  assert.equal(copied, 'alpha')
  assert.equal(await target.cut(), false)
  assert.equal(await target.paste(), false)
  assert.equal(target.deleteSelection(), false)
  assert.equal(target.selectAll(), true)
  target.dispose()
})

test('disposing delayed clipboard actions and replacing the view prevent late mutations', async () => {
  const test = fixture()
  let finishWrite: (() => void) | undefined
  let finishRead: ((text: string) => void) | undefined
  clipboard({ writeText: () => new Promise<void>((resolve) => { finishWrite = resolve }), readText: () => new Promise<string>((resolve) => { finishRead = resolve }) })
  test.view.dispatch({ selection: { anchor: 0, head: 5 } })
  const cut = test.prepare()
  const result = cut.cut()
  cut.dispose()
  finishWrite!()
  assert.equal(await result, false)
  assert.equal(test.view.state.doc.toString(), 'alpha bravo\nsecond line\n')
  const paste = test.prepare()
  const pasted = paste.paste()
  test.invalidate()
  finishRead!('replacement')
  assert.equal(await pasted, false)
  assert.equal(test.view.state.doc.toString(), 'alpha bravo\nsecond line\n')
  paste.dispose()
})

test('CodeMirror cut aborts if selected text changes while clipboard permission is pending', async () => {
  const test = fixture()
  let finish: (() => void) | undefined
  clipboard({ writeText: () => new Promise<void>((resolve) => { finish = resolve }) })
  test.view.dispatch({ selection: { anchor: 0, head: 5 } })
  const target = test.prepare()
  const result = target.cut()
  test.view.dispatch({ changes: { from: 2, insert: 'X' } })
  finish!()
  assert.equal(await result, false)
  assert.equal(test.view.state.doc.toString(), 'alXpha bravo\nsecond line\n')
  target.dispose()
})
