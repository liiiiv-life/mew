import type { Editor } from '@tiptap/core'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { NodeSelection, type Transaction } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { yUndoPluginKey } from '@tiptap/y-tiptap'
import { uiText } from '@mew/ui/i18n-core'
import type { DatabaseOptions } from './databaseSchema'
import type { DatabaseTableData, DbView, EditorDbApi } from '../types'

export function editorDatabaseApi(editor: Editor): EditorDbApi | undefined {
  return (editor.extensionManager.extensions.find(extension => extension.name === 'database')?.options as DatabaseOptions | undefined)?.api?.db
}

export function tableDatabaseData(table: PMNode): DatabaseTableData {
  const map = TableMap.get(table), seen = new Set<number>()
  const rows = Array.from({ length: map.height }, (_, row) => Array.from({ length: map.width }, (_, column) => {
    const pos = map.map[row * map.width + column]
    if (seen.has(pos)) return ''
    seen.add(pos)
    const cell = table.nodeAt(pos)!
    return cell.textBetween(0, cell.content.size, '\n', node => node.type.name === 'hardBreak' ? '\n' : String(node.attrs.alt ?? ''))
  }))
  let header = true
  table.firstChild?.forEach(cell => { if (cell.type.name !== 'tableHeader') header = false })
  return { columns: header ? rows[0] : Array.from({ length: map.width }, () => ''), rows: header ? rows.slice(1) : rows }
}

export function databaseTableNode(schema: Schema, view: DbView): PMNode {
  const cell = (text: string, header = false) => {
    const content: PMNode[] = []
    text.split(/\r?\n/).forEach((line, index) => {
      if (index) content.push(schema.nodes.hardBreak.create())
      if (line) content.push(schema.text(line))
    })
    return (header ? schema.nodes.tableHeader : schema.nodes.tableCell).create(null, schema.nodes.paragraph.create(null, content))
  }
  const text = (value: unknown): string => value == null ? '' : Array.isArray(value) ? value.map(text).join(', ') : String(value)
  return schema.nodes.table.create(null, [
    schema.nodes.tableRow.create(null, view.columns.map(column => cell(column.name, true))),
    ...view.rows.map(row => schema.nodes.tableRow.create(null, view.columns.map(column => cell(text(row.cells[column.id]))))),
  ])
}

const pending = new WeakMap<Editor, Set<PMNode>>()
export function isTableConversionPending(editor: Editor, node: PMNode): boolean { return pending.get(editor)?.has(node) ?? false }

function trackNode(editor: Editor, pos: number, node: PMNode) {
  const nodes = pending.get(editor) ?? new Set<PMNode>()
  pending.set(editor, nodes); nodes.add(node)
  let position = pos, changed = false
  const track = ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return
    const mapped = transaction.mapping.mapResult(position, 1)
    position = mapped.pos
    changed ||= mapped.deleted || !transaction.doc.nodeAt(position)?.eq(node)
  }
  editor.on('transaction', track)
  return {
    position() {
      if (editor.isDestroyed || !editor.isEditable || changed || !editor.state.doc.nodeAt(position)?.eq(node)) throw new Error(uiText('전환 중 원본이 변경되었습니다. 다시 시도하세요.'))
      return position
    },
    dispose() { editor.off('transaction', track); nodes.delete(node) },
  }
}

function replaceNode(editor: Editor, pos: number, source: PMNode, replacement: PMNode) {
  const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager
  undoManager?.stopCapturing()
  const tr = closeHistory(editor.state.tr.replaceWith(pos, pos + source.nodeSize, replacement))
  tr.setSelection(NodeSelection.create(tr.doc, pos))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.dispatch(closeHistory(editor.state.tr))
  undoManager?.stopCapturing()
  editor.view.focus()
}

export async function convertTableToDatabase(editor: Editor, pos: number, api: EditorDbApi): Promise<void> {
  const source = editor.state.doc.nodeAt(pos)
  if (!editor.isEditable || source?.type.name !== 'table' || isTableConversionPending(editor, source)) return
  const table = tableDatabaseData(source), tracked = trackNode(editor, pos, source)
  let created: DbView | undefined, inserted = false
  try {
    created = await api.create(uiText('제목 없음'), table)
    replaceNode(editor, tracked.position(), source, editor.schema.nodes.database.create({ dbId: created.id }))
    inserted = true
  } finally {
    tracked.dispose()
    if (created && !inserted) await api.remove(created.id)
  }
}

export async function convertDatabaseToTable(editor: Editor, pos: number, api: EditorDbApi): Promise<void> {
  const source = editor.state.doc.nodeAt(pos)
  if (!editor.isEditable || source?.type.name !== 'database' || isTableConversionPending(editor, source)) return
  const tracked = trackNode(editor, pos, source)
  try {
    const view = await api.getView(source.attrs.dbId, { allRows: true })
    replaceNode(editor, tracked.position(), source, databaseTableNode(editor.schema, view))
  } finally { tracked.dispose() }
}
