// Postgres 카탈로그·물리 데이터와 문서 데이터베이스의 변경을 하나의 경계에서 다룬다.
import { exec, withTransaction, type Exec } from './pool.ts'
import { ensureCatalog, COLUMN_TYPES, mapPgType, isColumnType, type ColumnType } from './schema.ts'
import { quoteIdent, quoteVerifiedIdent, projectSchema, newTableName, newColumnName } from './identifiers.ts'
import * as catalog from './catalog.ts'
import type { DatabaseRow, ColumnRow } from './catalog.ts'
import { publishDbEvent, type DbEvent } from './hub.ts'
import { decoratePageRows, readPageEdits, syncDatabasePages } from './rowPages.ts'
import { recordPageMutation } from './page-mutations.ts'
import { editSelection, type OptionEdit } from '../../shared/selection-options.ts'
import { DATABASE_INITIAL_ROWS, DATABASE_TEXT_COLUMN_NAME } from '../../shared/database-defaults.ts'
import { prepareDatabaseTable, type DatabaseTableData } from '../../shared/database-table.ts'

export class DbObjectNotFoundError extends Error {}
export class DbReadOnlyError extends Error {}
export class DbValidationError extends Error {}

export interface ColumnDef {
  id: string
  name: string
  type: ColumnType
  optionColors?: Record<string, number>
  primary?: boolean
  options?: string[]
}

export interface RowData {
  id: string
  pos: number
  cells: Record<string, unknown>
  pagePath?: string
}

export interface DatabaseView {
  id: string
  title: string
  kind: 'managed' | 'external'
  editable: boolean
  columns: ColumnDef[]
  rows: RowData[]
  ownerPath?: string | null
}

export interface DatabaseSummary {
  id: string
  title: string
  kind: 'managed' | 'external'
  editable: boolean
}

const ROW_LIMIT = 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RESERVED_FIELDS = new Set(['title', '_mew_database', '_mew_row', '상위파일'])

export async function createDatabase(
  project: string,
  title: string,
  createdBy: string | null,
  ownerPath?: string,
  initialTable?: unknown,
): Promise<DatabaseView> {
  let data: DatabaseTableData
  try {
    data = initialTable === undefined ? { columns: ['제목', DATABASE_TEXT_COLUMN_NAME], rows: DATABASE_INITIAL_ROWS.map(row => [row.title, row.text]) } : prepareDatabaseTable(initialTable)
  } catch (error) { throw new DbValidationError((error as Error).message) }
  await ensureCatalog()
  const schema = projectSchema(project)
  const table = newTableName()
  await exec(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`)
  return withTransaction(async (tx) => {
    await tx(`CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(table)} (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pos double precision NOT NULL DEFAULT 0
    )`)
    const db = await catalog.insertDatabase(tx, {
      project, title: cleanTitle(title), kind: 'managed', phys_schema: schema, phys_table: table,
      created_by: createdBy, owner_path: ownerPath ?? null,
    })
    const columns: ColumnRow[] = []
    for (const [position, name] of data.columns.entries()) {
      const pgName = newColumnName()
      await tx(`ALTER TABLE ${tableRef(db)} ADD COLUMN ${quoteIdent(pgName)} text`)
      columns.push(await catalog.insertColumn(tx, { database_id: db.id, name, pg_name: pgName, type: 'text', position }))
    }
    await ensurePrimary(tx, db)
    const fields = ['pos', ...columns.map(column => column.pg_name)].map(quoteIdent).join(', ')
    for (let offset = 0; offset < data.rows.length; offset += 200) {
      const values: unknown[] = []
      const tuples = data.rows.slice(offset, offset + 200).map((row, index) => `(${[offset + index, ...row].map(value => `$${values.push(value)}`).join(', ')})`)
      await tx(`INSERT INTO ${tableRef(db)} (${fields}) VALUES ${tuples.join(', ')}`, values)
    }
    return view(db, columns, await readManagedRows(db, columns, tx))
  })
}

export async function attachExternal(
  project: string,
  schemaName: string,
  tableName: string,
  title: string | null,
  createdBy: string | null,
): Promise<DatabaseView> {
  await ensureCatalog()
  const lower = schemaName.toLowerCase()
  if (lower === 'mew' || lower === 'information_schema' || lower.startsWith('pg_')) {
    throw new DbValidationError('이 스키마는 참조할 수 없습니다')
  }
  const tbl = await exec(`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [schemaName, tableName])
  if (!tbl.rowCount) throw new DbObjectNotFoundError('해당 테이블을 찾을 수 없습니다')
  const introspect = await exec<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schemaName, tableName],
  )
  if (!introspect.rowCount) throw new DbValidationError('컬럼이 없는 테이블입니다')
  return withTransaction(async (tx) => {
    const db = await catalog.insertDatabase(tx, {
      project, title: cleanTitle(title ?? tableName), kind: 'external', phys_schema: schemaName,
      phys_table: tableName, created_by: createdBy,
    })
    const cols: ColumnRow[] = []
    for (const [position, c] of introspect.rows.entries()) {
      cols.push(await catalog.insertColumn(tx, {
        database_id: db.id, name: c.column_name, pg_name: c.column_name, type: mapPgType(c.data_type), position,
      }))
    }
    return view(db, cols, [])
  })
}

export async function listDatabases(project: string): Promise<DatabaseSummary[]> {
  await ensureCatalog()
  return (await catalog.listDatabaseRows(exec, project)).map(summary)
}

export async function getView(project: string, id: string, allRows = false): Promise<DatabaseView> {
  await ensureCatalog()
  const db = await getDatabaseOrThrow(exec, project, id)
  if (db.kind === 'external') {
    const columns = await catalog.listColumns(exec, db.id)
    return view(db, columns, await readExternalRows(db, columns, allRows))
  }
  const result = await withManagedChange(project, id, async () => undefined)
  return { ...result.view, rows: allRows ? result.view.rows : result.view.rows.slice(0, ROW_LIMIT) }
}

export async function insertRow(project: string, id: string): Promise<RowData> {
  const result = await withManagedChange(project, id, async (tx, db, columns) => {
    const target = tableRef(db)
    const titleCol = columns[0]
    const titles = await tx<Record<string, unknown>>(`SELECT ${quoteIdent(titleCol.pg_name)} FROM ${target}`)
    const title = uniqueTitle('제목 없음', new Set(titles.rows.map((r) => String(r[titleCol.pg_name]))))
    const inserted = await tx<{ id: string }>(
      `INSERT INTO ${target} (pos, ${quoteIdent(titleCol.pg_name)}) VALUES ((SELECT COALESCE(MAX(pos) + 1, 0) FROM ${target}), $1) RETURNING id`,
      [title],
    )
    return String(inserted.rows[0].id)
  })
  const row = result.view.rows.find((candidate) => candidate.id === result.value)!
  publishDbEvent(project, id, { type: 'row.insert', row })
  return row
}

export async function updateCell(project: string, id: string, rowId: string, columnId: string, value: unknown): Promise<unknown> {
  assertRowId(rowId)
  const { value: saved } = await withManagedChange(project, id, async (tx, db, columns) => {
    return setCell(tx, db, columns, rowId, columnId, value)
  })
  publishDbEvent(project, id, { type: 'row.update', rowId, columnId, value: saved })
  return saved
}

export async function deleteRow(project: string, id: string, rowId: string): Promise<void> {
  assertRowId(rowId)
  await withManagedChange(project, id, async (tx, db) => {
    const { rowCount } = await tx(`DELETE FROM ${tableRef(db)} WHERE id = $1`, [rowId])
    if (!rowCount) throw new DbObjectNotFoundError('행을 찾을 수 없습니다')
  })
  publishDbEvent(project, id, { type: 'row.delete', rowId })
}

export async function addColumn(project: string, id: string, name: string, type: ColumnType, options?: unknown): Promise<ColumnDef> {
  if (!isColumnType(type)) throw new DbValidationError('알 수 없는 컬럼 타입입니다')
  if (type === 'page') throw new DbValidationError('대표열만 페이지로 전환할 수 있습니다')
  const { value: col } = await withManagedChange(project, id, async (tx, db, columns) => {
    const clean = validateColumnName(name, columns)
    const choices = options === undefined ? [] : coerceOptions(options)
    if (choices.length && !isSelection(type)) throw new DbValidationError('선택 열에만 옵션을 지정할 수 있습니다')
    const pgName = newColumnName()
    await tx(`ALTER TABLE ${tableRef(db)} ADD COLUMN ${quoteIdent(pgName)} ${COLUMN_TYPES[type].pg}`)
    const position = await catalog.nextColumnPosition(tx, db.id)
    return catalog.insertColumn(tx, { database_id: db.id, name: clean, pg_name: pgName, type, position, options: choices })
  })
  return colDef(col)
}

export interface ColumnUpdate {
  name?: unknown
  type?: unknown
  options?: unknown
}

export async function updateColumn(project: string, id: string, columnId: string, update: ColumnUpdate): Promise<ColumnDef> {
  const { view: updated } = await withManagedChange(project, id, async (tx, db, columns) => {
    const col = columns.find((candidate) => candidate.id === columnId)
    if (!col) throw new DbObjectNotFoundError('컬럼을 찾을 수 없습니다')
    const primary = columns[0].id === columnId
    if (update.name !== undefined) {
      if (typeof update.name !== 'string') throw new DbValidationError('열 이름은 문자열이어야 합니다')
      const name = validateColumnName(update.name, columns, columnId)
      await catalog.updateColumnName(tx, col.id, name)
      col.name = name
    }
    const nextType = update.type === undefined ? col.type : update.type
    if (!isColumnType(nextType)) throw new DbValidationError('알 수 없는 컬럼 타입입니다')
    if (primary && nextType !== 'text' && nextType !== 'page') throw new DbValidationError('대표열은 텍스트 또는 페이지 타입이어야 합니다')
    if (!primary && nextType === 'page') throw new DbValidationError('대표열만 페이지로 전환할 수 있습니다')
    if (nextType === 'page') validatePageFields(columns)
    let options = update.options === undefined ? [...(col.options ?? [])] : coerceOptions(update.options)
    if (update.options !== undefined && !isSelection(nextType)) throw new DbValidationError('선택 열에만 옵션을 지정할 수 있습니다')
    const raw = await tx<{ id: string; value: unknown }>(`SELECT id, ${quoteIdent(col.pg_name)} AS value FROM ${tableRef(db)} ORDER BY pos, id`)
    const converted = raw.rows.map((row) => ({ id: row.id, value: convertColumnValue(col.type, nextType, normalizeOut(col.type, row.value)) }))
    const selected = converted.flatMap((row) => selectionValues(nextType, row.value))
    if (update.options !== undefined && selected.some((value) => !options.includes(value))) {
      throw new DbValidationError('사용 중인 선택 옵션은 삭제할 수 없습니다')
    }
    if (isSelection(nextType)) options = [...new Set([...options, ...selected])]
    else options = []
    if (col.type !== nextType && COLUMN_TYPES[col.type].pg !== COLUMN_TYPES[nextType].pg) {
      // 모든 값을 먼저 검증한 후 변경한다. 기존 캐스트가 실패하지 않도록 NULL로 비운 뒤 검증된 값을 복원한다.
      await tx(`UPDATE ${tableRef(db)} SET ${quoteIdent(col.pg_name)} = NULL`)
      await tx(`ALTER TABLE ${tableRef(db)} ALTER COLUMN ${quoteIdent(col.pg_name)} TYPE ${COLUMN_TYPES[nextType].pg} USING NULL::${COLUMN_TYPES[nextType].pg}`)
    }
    if (col.type !== nextType) for (const row of converted) {
      await tx(`UPDATE ${tableRef(db)} SET ${quoteIdent(col.pg_name)} = $1 WHERE id = $2`, [row.value, row.id])
    }
    await catalog.updateColumnDefinition(tx, col.id, nextType, options)
  })
  return updated.columns.find((col) => col.id === columnId)!
}

export async function renameColumn(project: string, id: string, columnId: string, name: string): Promise<ColumnDef> {
  return updateColumn(project, id, columnId, { name })
}

export async function editColumnOption(project: string, id: string, columnId: string, option: string, edit: OptionEdit): Promise<ColumnDef> {
  const { view: updated } = await withManagedChange(project, id, async (tx, db, columns) => {
    const col = columns.find(column => column.id === columnId)
    if (!col) throw new DbObjectNotFoundError('컬럼을 찾을 수 없습니다')
    if (!isSelection(col.type)) throw new DbValidationError('선택 열만 편집할 수 있습니다')
    let next: ReturnType<typeof editSelection>
    try { next = editSelection(col.options ?? [], col.option_colors ?? {}, option, edit) }
    catch (error) { throw new DbValidationError((error as Error).message) }
    if (edit.remove || next.name !== option) {
      for (const row of await readManagedRows(db, columns, tx)) {
        const value = row.cells[columnId]
        if (value === null) continue
        const replacement = col.type === 'multi_select'
          ? (value as string[]).flatMap(item => item === option ? edit.remove ? [] : [next.name] : [item])
          : value === option ? edit.remove ? null : next.name : value
        if (JSON.stringify(value) !== JSON.stringify(replacement)) {
          await tx(`UPDATE ${tableRef(db)} SET ${quoteIdent(col.pg_name)} = $1 WHERE id = $2`, [replacement, row.id])
        }
      }
    }
    await catalog.updateColumnDefinition(tx, col.id, col.type, next.options)
    await tx('UPDATE mew.columns SET option_colors = $2::jsonb WHERE id = $1', [col.id, JSON.stringify(next.optionColors)])
  })
  return updated.columns.find(column => column.id === columnId)!
}

export async function deleteColumn(project: string, id: string, columnId: string): Promise<void> {
  await withManagedChange(project, id, async (tx, db, columns) => {
    const col = columns.find((candidate) => candidate.id === columnId)
    if (!col) throw new DbObjectNotFoundError('컬럼을 찾을 수 없습니다')
    if (col.id === columns[0].id) throw new DbValidationError('대표열은 삭제할 수 없습니다')
    await tx(`ALTER TABLE ${tableRef(db)} DROP COLUMN ${quoteIdent(col.pg_name)}`)
    await catalog.deleteColumnRow(tx, columnId)
  })
}

export async function renameDatabase(project: string, id: string, title: string): Promise<DatabaseSummary> {
  await ensureCatalog()
  const db = await getDatabaseOrThrow(exec, project, id)
  const clean = cleanTitle(title)
  if (db.kind === 'managed') {
    await withManagedChange(project, id, async (tx, current) => {
      await catalog.updateDatabaseTitle(tx, project, id, clean)
      current.title = clean
    })
  } else await catalog.updateDatabaseTitle(exec, project, id, clean)
  publishDbEvent(project, id, { type: 'title', title: clean })
  return { ...summary(db), title: clean }
}

export async function deleteDatabase(project: string, id: string): Promise<void> {
  await ensureCatalog()
  const db = await getDatabaseOrThrow(exec, project, id)
  await withTransaction(async (tx) => {
    if (db.kind === 'managed') await tx(`DROP TABLE IF EXISTS ${tableRef(db)}`)
    await catalog.deleteDatabaseRow(tx, project, id)
  })
}

async function getDatabaseOrThrow(q: Exec, project: string, id: string): Promise<DatabaseRow> {
  const db = await catalog.getDatabaseRow(q, project, id)
  if (!db) throw new DbObjectNotFoundError('데이터베이스를 찾을 수 없습니다')
  return db
}

async function withManagedChange<T>(
  project: string,
  id: string,
  operation: (tx: Exec, db: DatabaseRow, columns: ColumnRow[]) => Promise<T>,
): Promise<{ value: T; view: DatabaseView }> {
  await ensureCatalog()
  let pageChanges: Awaited<ReturnType<typeof syncDatabasePages>> | undefined
  const events: DbEvent[] = []
  let result: { value: T; view: DatabaseView }
  try {
    result = await withTransaction(async (tx) => {
      await tx(`SELECT id FROM mew.databases WHERE id = $1 AND project = $2 FOR UPDATE`, [id, project])
      const db = await getDatabaseOrThrow(tx, project, id)
      if (db.kind !== 'managed') throw new DbReadOnlyError('참조(external) 데이터베이스는 편집할 수 없습니다')
      let columns = await ensurePrimary(tx, db)
      const initial = view(db, columns, await readManagedRows(db, columns, tx))
      for (const edit of await readPageEdits(project, initial, tx)) {
        const saved = await setCell(tx, db, columns, edit.rowId, edit.columnId, edit.value)
        events.push({ type: 'row.update', rowId: edit.rowId, columnId: edit.columnId, value: saved })
      }
      const value = await operation(tx, db, columns)
      columns = await catalog.listColumns(tx, id)
      const current = view(db, columns, await readManagedRows(db, columns, tx))
      if (JSON.stringify(initial.columns) !== JSON.stringify(current.columns)) events.push({ type: 'schema', columns: current.columns })
      pageChanges = await syncDatabasePages(project, current, tx)
      const decorated = await decoratePageRows(project, current, tx)
      return { value, view: decorated }
    })
  } catch (err) {
    if (pageChanges) await pageChanges.rollback()
    if (pgErrorCode(err) === '23505') throw new DbValidationError('대표열 값은 다른 행과 중복될 수 없습니다')
    if (pgErrorCode(err) === '23502' || pgErrorCode(err) === '23514') throw new DbValidationError('대표열 값은 비워 둘 수 없습니다')
    throw err
  }
  if (pageChanges) { await pageChanges.commit(); recordPageMutation(pageChanges.mutation) }
  for (const event of events) publishDbEvent(project, id, event)
  return result
}

async function setCell(tx: Exec, db: DatabaseRow, columns: ColumnRow[], rowId: string, columnId: string, value: unknown): Promise<unknown> {
  assertRowId(rowId)
  const col = columns.find((candidate) => candidate.id === columnId)
  if (!col) throw new DbObjectNotFoundError('컬럼을 찾을 수 없습니다')
  let coerced = coerceCellValue(col.type, value)
  if (columns[0].id === col.id && typeof coerced === 'string') coerced = coerced.trim()
  if (columns[0].id === col.id && (typeof coerced !== 'string' || !coerced.trim())) {
    throw new DbValidationError('대표열 값은 비워 둘 수 없습니다')
  }
  const { rowCount } = await tx(`UPDATE ${tableRef(db)} SET ${quoteIdent(col.pg_name)} = $1 WHERE id = $2`, [coerced, rowId])
  if (!rowCount) throw new DbObjectNotFoundError('행을 찾을 수 없습니다')
  const choices = selectionValues(col.type, coerced)
  const options = [...new Set([...(col.options ?? []), ...choices])]
  if (options.length !== (col.options ?? []).length) {
    await catalog.updateColumnDefinition(tx, col.id, col.type, options)
    col.options = options
  }
  return coerced
}

async function createPrimaryColumn(tx: Exec, db: DatabaseRow): Promise<ColumnRow> {
  const pgName = newColumnName()
  await tx(`ALTER TABLE ${tableRef(db)} ADD COLUMN ${quoteIdent(pgName)} text`)
  return catalog.insertColumn(tx, { database_id: db.id, name: '제목', pg_name: pgName, type: 'text', position: 0 })
}

async function ensurePrimary(tx: Exec, db: DatabaseRow): Promise<ColumnRow[]> {
  let columns = await catalog.listColumns(tx, db.id)
  if (!columns.length) columns = [await createPrimaryColumn(tx, db)]
  const primary = columns[0]
  const constraint = `mew_primary_${primary.pg_name}`
  const existing = await tx(`SELECT 1 FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2`, [tableRef(db), constraint])
  if (existing.rowCount) return columns
  await tx(`LOCK TABLE ${tableRef(db)} IN ACCESS EXCLUSIVE MODE`)
  if (primary.type !== 'text' && primary.type !== 'page') {
    await tx(`ALTER TABLE ${tableRef(db)} ALTER COLUMN ${quoteIdent(primary.pg_name)} TYPE text USING ${quoteIdent(primary.pg_name)}::text`)
    await catalog.updateColumnDefinition(tx, primary.id, 'text', [])
    primary.type = 'text'
    primary.options = []
  }
  const rows = await tx<{ id: string; value: unknown }>(`SELECT id, ${quoteIdent(primary.pg_name)} AS value FROM ${tableRef(db)} ORDER BY pos, id`)
  const seen = new Set<string>()
  const reserved = new Set(rows.rows.map((row) => String(row.value ?? '').trim()).filter(Boolean))
  for (const row of rows.rows) {
    const original = String(row.value ?? '').trim()
    const base = original || '제목 없음'
    const title = !original || seen.has(base) ? uniqueTitle(base, new Set([...seen, ...reserved])) : base
    seen.add(title)
    if (row.value !== title) await tx(`UPDATE ${tableRef(db)} SET ${quoteIdent(primary.pg_name)} = $1 WHERE id = $2`, [title, row.id])
  }
  await tx(`ALTER TABLE ${tableRef(db)} ALTER COLUMN ${quoteIdent(primary.pg_name)} SET NOT NULL,
    ADD CONSTRAINT ${quoteIdent(constraint)} UNIQUE (${quoteIdent(primary.pg_name)}),
    ADD CONSTRAINT ${quoteIdent(`mew_required_${primary.pg_name}`)} CHECK (btrim(${quoteIdent(primary.pg_name)}) <> '')`)
  return columns
}

async function readManagedRows(db: DatabaseRow, columns: ColumnRow[], q: Exec): Promise<RowData[]> {
  const selectCols = columns.map((c) => quoteIdent(c.pg_name)).join(', ')
  const { rows } = await q(`SELECT id, pos${selectCols ? ', ' + selectCols : ''} FROM ${tableRef(db)} ORDER BY pos, id`)
  return rows.map((r) => ({ id: String(r.id), pos: Number(r.pos), cells: cellsFrom(columns, r) }))
}

async function readExternalRows(db: DatabaseRow, columns: ColumnRow[], allRows = false): Promise<RowData[]> {
  const selectCols = columns.map((c) => quoteVerifiedIdent(c.pg_name)).join(', ')
  if (!selectCols) return []
  const { rows } = await exec(`SELECT ${selectCols} FROM ${quoteVerifiedIdent(db.phys_schema)}.${quoteVerifiedIdent(db.phys_table)}${allRows ? '' : ` LIMIT ${ROW_LIMIT}`}`)
  return rows.map((r, i) => ({ id: String(i), pos: i, cells: cellsFrom(columns, r) }))
}

function cellsFrom(columns: ColumnRow[], row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column.id, normalizeOut(column.type, row[column.pg_name])]))
}

export function coerceCellValue(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null
  switch (type) {
    case 'number': {
      if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new DbValidationError('숫자가 아닙니다')
      const n = Number(value)
      if (!Number.isFinite(n)) throw new DbValidationError('유한한 숫자를 입력하세요')
      return n
    }
    case 'checkbox':
      if (value === true || value === 'true') return true
      if (value === false || value === 'false') return false
      throw new DbValidationError('체크박스 값은 true 또는 false여야 합니다')
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DbValidationError('날짜는 YYYY-MM-DD 형식이어야 합니다')
      const date = new Date(`${value}T00:00:00.000Z`)
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new DbValidationError('올바르지 않은 날짜입니다')
      return value
    }
    case 'multi_select':
      return coerceOptions(value)
    default:
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new DbValidationError('텍스트 값을 입력하세요')
      return type === 'text' ? String(value) : String(value).trim() || null
  }
}

export function convertColumnValue(from: ColumnType, to: ColumnType, value: unknown): unknown {
  if (from === to || value === null || value === undefined) return value
  if (from === 'multi_select') {
    const values = coerceOptions(value)
    if (values.length > 1) throw new DbValidationError('여러 선택값이 있는 열은 이 타입으로 바꿀 수 없습니다')
    value = values[0] ?? null
  }
  if (value === null) return null
  if (to === 'multi_select') return coerceOptions([String(value)])
  return coerceCellValue(to, value)
}

function normalizeOut(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (type === 'number') return typeof value === 'number' ? value : Number(value)
  if (type === 'checkbox') return Boolean(value)
  if (type === 'multi_select') return Array.isArray(value) ? value.map(String) : []
  return String(value)
}

function colDef(row: ColumnRow, primary = false): ColumnDef {
  return {
    id: row.id, name: row.name, type: row.type,
    ...(primary ? { primary: true } : {}),
    ...(isSelection(row.type) ? { options: row.options ?? [], optionColors: row.option_colors ?? {} } : {}),
  }
}

function view(db: DatabaseRow, columns: ColumnRow[], rows: RowData[]): DatabaseView {
  return {
    id: db.id, title: db.title, kind: db.kind, editable: db.kind === 'managed',
    columns: columns.map((column, index) => colDef(column, db.kind === 'managed' && index === 0)),
    rows, ownerPath: db.owner_path ?? null,
  }
}

function summary(db: DatabaseRow): DatabaseSummary {
  return { id: db.id, title: db.title, kind: db.kind, editable: db.kind === 'managed' }
}

function isSelection(type: ColumnType): boolean {
  return type === 'select' || type === 'multi_select'
}

function selectionValues(type: ColumnType, value: unknown): string[] {
  if (!isSelection(type) || value === null || value === undefined) return []
  return type === 'multi_select' ? coerceOptions(value) : [String(value)]
}

function coerceOptions(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((option) => typeof option !== 'string' || !option.trim())) {
    throw new DbValidationError('선택 옵션은 비어 있지 않은 문자열 목록이어야 합니다')
  }
  return [...new Set(value.map((option: string) => option.trim()))]
}

function validateColumnName(name: string, columns: ColumnRow[], exceptId?: string): string {
  const cleaned = cleanName(name)
  if (columns.some((column) => column.id !== exceptId && column.name === cleaned)) throw new DbValidationError('열 이름은 중복될 수 없습니다')
  if (columns[0]?.id !== exceptId && RESERVED_FIELDS.has(cleaned)) throw new DbValidationError('문서 속성에서 사용하는 예약된 이름입니다')
  return cleaned
}

function validatePageFields(columns: ColumnRow[]): void {
  const names = columns.map((column) => column.name)
  if (new Set(names).size !== names.length) throw new DbValidationError('페이지로 바꾸기 전에 중복된 열 이름을 바꾸세요')
  if (columns.slice(1).some((column) => RESERVED_FIELDS.has(column.name))) throw new DbValidationError('문서 속성의 예약된 이름을 사용하는 열을 먼저 바꾸세요')
}

function uniqueTitle(base: string, used: Set<string>): string {
  let title = base
  let count = 2
  while (used.has(title)) title = `${base} (${count++})`
  return title
}

function tableRef(db: DatabaseRow): string {
  return `${quoteIdent(db.phys_schema)}.${quoteIdent(db.phys_table)}`
}

function pgErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined
}

function assertRowId(id: string): void {
  if (!UUID_RE.test(id)) throw new DbValidationError('올바르지 않은 행 ID입니다')
}

function cleanTitle(t: string | null | undefined): string {
  return (t ?? '').trim() || '제목 없음'
}

function cleanName(n: string | null | undefined): string {
  return (n ?? '').trim() || '열'
}
