import type { DbColumn, DbColumnType, DbEvent, DbView } from '../../packages/editor/src/types.ts'
import { DATABASE_INITIAL_ROWS, DATABASE_TEXT_COLUMN_NAME } from '../../shared/database-defaults.ts'
import { prepareDatabaseTable, type DatabaseTableData } from '../../shared/database-table.ts'
import { demoJson, requireMethod, stringArray, stringField, type DemoHttpHandler } from './http.ts'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'
import { loadDemoTaskDocuments, readDemoTaskSnapshot } from './http-tasks.ts'
import { requireDemoWorkspace } from './document-utils.ts'

export const DEMO_DATABASE_ID = 'f9ae9321-c1c5-4d42-aafe-4ee8f59f4101'
const TYPES: DbColumnType[] = ['text', 'number', 'checkbox', 'date', 'select', 'multi_select', 'page']
const defaultView = (store: DemoWorkspaceStore): DbView => ({ id: DEMO_DATABASE_ID, title: 'Mew 태스크 사본', kind: 'managed', editable: true,
  columns: [
    { id: 'title', name: '작업', type: 'text', primary: true },
    { id: 'status', name: '상태', type: 'select', options: ['예정', '진행 중', '완료'] },
    { id: 'done', name: '완료', type: 'checkbox' },
  ],
  rows: readDemoTaskSnapshot(store).tasks.map((task, pos) => ({
    id: `0c4b6b42-c6de-46d7-a760-1c0cef571f${(pos + 1).toString(16).padStart(2, '0')}`, pos,
    cells: { title: task.text, status: task.done ? '완료' : '예정', done: task.done },
  })),
})

export const handleDemoDatabase: DemoHttpHandler = async ({ store, request, url, body, project }) => {
  if (url.pathname !== '/api/db' && !url.pathname.startsWith('/api/db/')) return
  const segments = url.pathname.slice('/api/db'.length).split('/').filter(Boolean).map(decodeURIComponent)
  const key = `databases:${store.projectRootPath(project)}:${project}`
  let views = store.getState<DbView[] | null>(key, null)
  if (!views) {
    const workspace = store.workspaceInfo().path
    await loadDemoTaskDocuments(store, workspace, request.signal)
    requireDemoWorkspace(store, workspace)
    views = [defaultView(store)]
    store.setState(key, views)
  }
  const save = (view: DbView, event?: DbEvent) => { store.setState(key, views); if (event) store.setState(`db-event:${project}:${view.id}`, { project, dbId: view.id, event }) }
  const method = request.method
  if (!segments.length) {
    requireMethod(request, 'GET', 'POST')
    if (method === 'GET') return demoJson(views.map(({ rows: _rows, columns: _columns, ...summary }) => summary))
    let table: DatabaseTableData
    try { table = body.table === undefined ? { columns: ['제목', DATABASE_TEXT_COLUMN_NAME], rows: DATABASE_INITIAL_ROWS.map(row => [row.title, row.text]) } : prepareDatabaseTable(body.table) }
    catch (error) { throw new DemoError((error as Error).message) }
    const columns: DbColumn[] = table.columns.map((name, index) => ({ id: crypto.randomUUID(), name, type: 'text', ...(index === 0 ? { primary: true } : {}) }))
    const view: DbView = { id: crypto.randomUUID(), title: stringField(body, 'title', '새 데이터베이스'), kind: 'managed', editable: true,
      columns,
      rows: table.rows.map((row, pos) => ({ id: crypto.randomUUID(), pos, cells: Object.fromEntries(columns.map((column, index) => [column.id, row[index]])) })),
    }
    views.push(view); save(view); return demoJson(view)
  }
  if (segments[0] === 'attach') throw new DemoError('외부 데이터베이스 연결은 데모에서 지원하지 않습니다.', 501)
  const view = views.find(item => item.id === segments[0])
  if (!view) throw new DemoError('데모 데이터베이스를 찾을 수 없습니다.', 404)
  if (segments.length === 1) {
    requireMethod(request, 'GET', 'DELETE', 'PATCH')
    if (method === 'DELETE') { store.setState(key, views.filter(item => item.id !== view.id)); return demoJson({ ok: true }) }
    if (method === 'PATCH') { view.title = stringField(body, 'title'); save(view, { type: 'title', title: view.title }) }
    return demoJson(view)
  }
  if (segments[1] === 'rows') {
    if (segments.length === 2) {
      requireMethod(request, 'POST')
      const row = { id: crypto.randomUUID(), pos: view.rows.length ? Math.max(...view.rows.map(item => item.pos)) + 1 : 0, cells: Object.fromEntries(view.columns.map(column => [column.id, column.type === 'checkbox' ? false : column.type === 'multi_select' ? [] : ''])) }
      view.rows.push(row); save(view, { type: 'row.insert', row }); return demoJson(row)
    }
    requireMethod(request, 'PATCH', 'DELETE')
    const row = view.rows.find(item => item.id === segments[2])
    if (!row) throw new DemoError('행을 찾을 수 없습니다.', 404)
    if (method === 'DELETE') { view.rows = view.rows.filter(item => item.id !== row.id); save(view, { type: 'row.delete', rowId: row.id }); return demoJson({ ok: true }) }
    const columnId = stringField(body, 'columnId'), column = view.columns.find(item => item.id === columnId)
    if (!column) throw new DemoError('열을 찾을 수 없습니다.', 404)
    const value = body.value
    if (column.type === 'number' && value !== null && value !== '' && typeof value !== 'number') throw new DemoError('숫자를 입력하세요.')
    if (column.type === 'checkbox' && typeof value !== 'boolean') throw new DemoError('체크박스 값을 확인해 주세요.')
    if (column.primary && (typeof value !== 'string' || !value.trim())) throw new DemoError('이름을 입력하세요.')
    row.cells[columnId] = value; save(view, { type: 'row.update', rowId: row.id, columnId, value }); return demoJson({ value })
  }
  if (segments[1] === 'columns') {
    if (segments.length === 2) {
      requireMethod(request, 'POST')
      const type = stringField(body, 'type', 'text') as DbColumnType
      if (!TYPES.includes(type)) throw new DemoError('열 타입을 확인해 주세요.')
      const column: DbColumn = { id: crypto.randomUUID(), name: stringField(body, 'name'), type, ...(type === 'select' || type === 'multi_select' ? { options: [] } : {}) }
      view.columns.push(column); save(view, { type: 'schema', columns: view.columns }); return demoJson(column)
    }
    const column = view.columns.find(item => item.id === segments[2])
    if (!column) throw new DemoError('열을 찾을 수 없습니다.', 404)
    requireMethod(request, 'PATCH', 'DELETE')
    if (method === 'DELETE') {
      if (column.primary) throw new DemoError('대표 열은 삭제할 수 없습니다.')
      view.columns = view.columns.filter(item => item.id !== column.id)
      for (const row of view.rows) delete row.cells[column.id]
      save(view, { type: 'schema', columns: view.columns }); return demoJson({ ok: true })
    }
    if (segments[3] === 'option') {
      const option = stringField(body, 'option'), name = stringField(body, 'name', option)
      column.options = (column.options ?? []).flatMap(value => value !== option ? [value] : body.remove ? [] : [name])
      column.optionColors ??= {}
      if (typeof body.hue === 'number') column.optionColors[name] = body.hue
      if (name !== option || body.remove) delete column.optionColors[option]
      for (const row of view.rows) {
        const value = row.cells[column.id]
        if (value === option) row.cells[column.id] = body.remove ? '' : name
        else if (Array.isArray(value)) row.cells[column.id] = value.flatMap(item => item === option ? body.remove ? [] : [name] : [item])
      }
    } else {
      if (body.name !== undefined) column.name = stringField(body, 'name')
      if (body.type !== undefined) {
        const type = stringField(body, 'type') as DbColumnType
        if (!TYPES.includes(type) || (column.primary && !['text', 'page'].includes(type))) throw new DemoError('열 타입을 확인해 주세요.')
        column.type = type
      }
      if (body.options !== undefined) column.options = stringArray(body, 'options')
    }
    save(view, { type: 'schema', columns: view.columns }); return demoJson(column)
  }
  throw new DemoError('이 데이터베이스 작업은 데모에서 지원하지 않습니다.', 501)
}
