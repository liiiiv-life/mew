import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { prepareDatabaseTable, DatabaseTableError } from '../../../../shared/database-table.ts'
import type { DbView, EditorDbApi } from '../types.ts'

const win = new Window({ url: 'http://localhost' })
const globals = win as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver']) {
  if (!(key in globalThis)) Object.defineProperty(globalThis, key, { value: globals[key], configurable: true })
}
const { Editor } = await import('@tiptap/core')
const { history, undo, redo } = await import('@tiptap/pm/history')
const { Collaboration } = await import('@tiptap/extension-collaboration')
const { yUndoPluginKey } = await import('@tiptap/y-tiptap')
const Y = await import('yjs')
const { serverEditorExtensions } = await import('../serverExtensions.ts')
const { convertTableToDatabase, convertDatabaseToTable, tableDatabaseData, databaseTableNode } = await import('./tableConversion.ts')

const markdown = 'Before\n\n| Name | Note |\n| --- | --- |\n| **Same** | first<br>second |\n| Same | [link](./note.md) |\n\nAfter'
const id = '123e4567-e89b-12d3-a456-426614174000'
function mockApi() {
  let view: DbView
  const calls = { created: 0, removed: [] as string[], allRows: false, table: undefined as unknown }
  const api = {
    async create(_title, table) {
      calls.created++; calls.table = structuredClone(table)
      const data = prepareDatabaseTable(table)
      view = { id, title: 'Converted', kind: 'managed', editable: true, columns: data.columns.map((name, index) => ({ id: String(index), name, type: 'text' })), rows: data.rows.map((row, pos) => ({ id: String(pos), pos, cells: Object.fromEntries(row.map((cell, index) => [String(index), cell])) })) }
      return view
    },
    async getView(_id, options) { calls.allRows = options?.allRows === true; return view },
    async remove(id) { calls.removed.push(id) },
  } as EditorDbApi
  return { api, calls }
}

test('table import keeps original strings and adds a text primary column only when required', () => {
  const input = { columns: ['Name', 'Name', '', 'title'], rows: [['', '3', 'x\ny', 'false'], ['', '003', '', 'true']] }
  assert.deepEqual(prepareDatabaseTable(input), { columns: ['제목', 'Name', 'Name (2)', '열 4', 'title (2)'], rows: [['항목 1', ...input.rows[0]], ['항목 2', ...input.rows[1]]] })
  assert.deepEqual(prepareDatabaseTable({ columns: ['A'], rows: [['one'], ['two']] }), { columns: ['A'], rows: [['one'], ['two']] })
  assert.deepEqual(prepareDatabaseTable({ columns: ['A'], rows: [] }), { columns: ['A'], rows: [] })
  for (const value of [null, {}, { columns: [], rows: [] }, { columns: ['A'], rows: [[null]] }, { columns: ['A'], rows: [['x', 'y']] }, { columns: ['A'], rows: [['\0']] }, { columns: ['A'], rows: Array.from({ length: 10_001 }, () => ['x']) }]) assert.throws(() => prepareDatabaseTable(value), DatabaseTableError)
  assert.deepEqual(input.rows[0], ['', '3', 'x\ny', 'false'])
})

for (const collaborative of [false, true]) test(`conversions are isolated undo/redo steps with ${collaborative ? 'Yjs' : 'ProseMirror'} history`, async () => {
  const ydoc = new Y.Doc()
  const editor = new Editor({ element: win.document.createElement('div') as never, extensions: [...serverEditorExtensions(), ...(collaborative ? [Collaboration.configure({ document: ydoc })] : [])], content: markdown })
  try {
    if (collaborative) {
      editor.commands.setContent(markdown)
      yUndoPluginKey.getState(editor.state).undoManager.clear()
    } else editor.registerPlugin(history())
    const step = (action: 'undo' | 'redo') => collaborative ? editor.commands[action]() : (action === 'undo' ? undo : redo)(editor.state, editor.view.dispatch)
    editor.view.dispatch(editor.state.tr.insertText('!', 2))
    const original = editor.state.doc.toJSON(), tablePos = editor.state.doc.firstChild!.nodeSize
    const { api, calls } = mockApi()
    await convertTableToDatabase(editor, tablePos, api)
    assert.equal(editor.state.doc.nodeAt(tablePos)!.type.name, 'database')
    assert.deepEqual(calls.table, { columns: ['Name', 'Note'], rows: [['Same', 'first\nsecond'], ['Same', 'link']] })
    const database = editor.state.doc.toJSON()
    assert.equal(step('undo'), true)
    assert.deepEqual(editor.state.doc.toJSON(), original, 'the preceding edit and rich table survive undo')
    assert.equal(step('redo'), true)
    assert.deepEqual(editor.state.doc.toJSON(), database)
    assert.equal(calls.created, 1, 'redo reuses the same database')
    await convertDatabaseToTable(editor, tablePos, api)
    assert.equal(calls.allRows, true)
    assert.deepEqual(tableDatabaseData(editor.state.doc.nodeAt(tablePos)!), { columns: ['제목', 'Name', 'Note'], rows: [['항목 1', 'Same', 'first\nsecond'], ['항목 2', 'Same', 'link']] })
    assert.equal(step('undo'), true)
    assert.deepEqual(editor.state.doc.toJSON(), database)
    assert.equal(step('undo'), true)
    assert.deepEqual(editor.state.doc.toJSON(), original)
    assert.equal(step('redo'), true)
    assert.equal(step('redo'), true)
    assert.deepEqual(calls.removed, [], 'undo and redo never delete referenced data')
  } finally { editor.destroy(); ydoc.destroy() }
})

test('pending conversion follows edits before the table and rejects changed or removed source nodes', async () => {
  for (const change of ['before', 'inside', 'delete', 'readonly']) {
    const editor = new Editor({ element: win.document.createElement('div') as never, extensions: serverEditorExtensions(), content: markdown })
    const { api, calls } = mockApi(), create = api.create
    let finish!: () => void
    api.create = async (...args) => { await new Promise<void>(resolve => { finish = resolve }); return create(...args) }
    const pos = editor.state.doc.firstChild!.nodeSize, source = editor.state.doc.nodeAt(pos)!
    try {
      const conversion = convertTableToDatabase(editor, pos, api)
      await convertTableToDatabase(editor, pos, api)
      if (change === 'before') editor.view.dispatch(editor.state.tr.insertText('prefix', 1))
      if (change === 'inside') editor.view.dispatch(editor.state.tr.insertText('x', pos + 4))
      if (change === 'delete') editor.view.dispatch(editor.state.tr.delete(pos, pos + source.nodeSize))
      if (change === 'readonly') editor.setEditable(false)
      const changed = editor.state.doc.toJSON()
      finish()
      if (change === 'before') {
        await conversion
        assert.equal(editor.state.doc.nodeAt(pos + 6)!.type.name, 'database')
        assert.deepEqual(calls.removed, [])
      } else {
        await assert.rejects(conversion, /원본이 변경/)
        assert.deepEqual(editor.state.doc.toJSON(), changed)
        assert.deepEqual(calls.removed, [id])
      }
      assert.equal(calls.created, 1, 'repeated commands cannot create duplicate databases')
    } finally { editor.destroy() }
  }
})

test('database snapshots preserve displayed values and convert a header-only table', () => {
  const editor = new Editor({ element: win.document.createElement('div') as never, extensions: serverEditorExtensions() })
  try {
    const view: DbView = { id, title: 'Source', kind: 'external', editable: false, columns: ['Title', 'Number', 'Check', 'Tags', 'Empty'].map((name, index) => ({ id: String(index), name, type: 'text' })), rows: [{ id: 'a', pos: 0, cells: { 0: 'text\nline', 1: 42, 2: false, 3: ['A', 'B'], 4: null } }] }
    assert.deepEqual(tableDatabaseData(databaseTableNode(editor.schema, view)).rows, [['text\nline', '42', 'false', 'A, B', '']])
    assert.deepEqual(tableDatabaseData(databaseTableNode(editor.schema, { ...view, rows: [] })).rows, [])
    const paragraph = (text: string) => editor.schema.nodes.paragraph.create(null, editor.schema.text(text))
    const row = editor.schema.nodes.tableRow, cell = editor.schema.nodes.tableCell, header = editor.schema.nodes.tableHeader
    const body = row.create(null, [cell.create(null, paragraph('A')), cell.create(null, paragraph('B'))])
    const merged = editor.schema.nodes.table.create(null, [row.create(null, header.create({ colspan: 2 }, paragraph('Merged'))), body])
    assert.deepEqual(tableDatabaseData(merged), { columns: ['Merged', ''], rows: [['A', 'B']] })
    assert.deepEqual(tableDatabaseData(editor.schema.nodes.table.create(null, [body])), { columns: ['', ''], rows: [['A', 'B']] })
  } finally { editor.destroy() }
})
