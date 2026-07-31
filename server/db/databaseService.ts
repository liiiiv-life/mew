// /db 데이터베이스 뷰의 오케스트레이션 — 카탈로그 메타데이터 + 물리 테이블 DDL/데이터를 잇고,
// 변경 시 실시간 이벤트를 방송한다. Postgres가 SSoT.
//
// managed  : mew가 만든 물리 테이블. 전 CRUD 가능 + 실시간.
// external : 이미 존재하는 테이블을 참조만 (읽기 전용, 원본을 절대 수정/삭제하지 않음).
//
// 보안: 모든 값은 파라미터($1)로, 모든 식별자는 identifiers.ts를 거친다 (인젝션 차단).
import { exec, withTransaction, type Exec } from './pool.ts'
import { ensureCatalog, COLUMN_TYPES, mapPgType, isColumnType, type ColumnType } from './schema.ts'
import { quoteIdent, quoteVerifiedIdent, projectSchema, newTableName, newColumnName } from './identifiers.ts'
import * as catalog from './catalog.ts'
import type { DatabaseRow, ColumnRow } from './catalog.ts'
import { publishDbEvent } from './hub.ts'

export class DbObjectNotFoundError extends Error {}
export class DbReadOnlyError extends Error {}
export class DbValidationError extends Error {}

export interface ColumnDef {
  id: string
  name: string
  type: ColumnType
}

export interface RowData {
  id: string
  pos: number
  cells: Record<string, unknown> // columnId → value
}

export interface DatabaseView {
  id: string
  title: string
  kind: 'managed' | 'external'
  editable: boolean
  columns: ColumnDef[]
  rows: RowData[]
}

export interface DatabaseSummary {
  id: string
  title: string
  kind: 'managed' | 'external'
  editable: boolean
}

const ROW_LIMIT = 1000 // v1: 뷰당 최대 행 (페이지네이션은 이후)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── 생성 ─────────────────────────────────────────────────────────────────────

export async function createDatabase(project: string, title: string, createdBy: string | null): Promise<DatabaseView> {
  await ensureCatalog()
  const schema = projectSchema(project)
  const table = newTableName()
  await exec(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`) // 멱등, 트랜잭션 밖
  return withTransaction(async (tx) => {
    await tx(
      `CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(table)} (
         id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         pos double precision NOT NULL DEFAULT 0
       )`,
    )
    const db = await catalog.insertDatabase(tx, {
      project,
      title: cleanTitle(title),
      kind: 'managed',
      phys_schema: schema,
      phys_table: table,
      created_by: createdBy,
    })
    // 노션처럼 기본 컬럼 하나(이름)로 시작
    const pgName = newColumnName()
    await tx(`ALTER TABLE ${quoteIdent(schema)}.${quoteIdent(table)} ADD COLUMN ${quoteIdent(pgName)} ${COLUMN_TYPES.text.pg}`)
    const col = await catalog.insertColumn(tx, { database_id: db.id, name: '이름', pg_name: pgName, type: 'text', position: 0 })
    return view(db, [col], [])
  })
}

// 이미 존재하는 테이블을 참조(읽기 전용)로 붙인다.
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
  // 실재 확인 — 값은 전부 파라미터라 인젝션 불가
  const tbl = await exec(`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [
    schemaName,
    tableName,
  ])
  if (!tbl.rowCount) throw new DbObjectNotFoundError('해당 테이블을 찾을 수 없습니다')
  const introspect = await exec<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schemaName, tableName],
  )
  if (!introspect.rowCount) throw new DbValidationError('컬럼이 없는 테이블입니다')
  return withTransaction(async (tx) => {
    const db = await catalog.insertDatabase(tx, {
      project,
      title: cleanTitle(title ?? tableName),
      kind: 'external',
      phys_schema: schemaName,
      phys_table: tableName,
      created_by: createdBy,
    })
    const cols: ColumnRow[] = []
    let pos = 0
    for (const c of introspect.rows) {
      // external 컬럼의 pg_name은 실제 컬럼명 그대로 (읽을 때 quoteVerifiedIdent로 안전 쿼팅)
      const col = await catalog.insertColumn(tx, {
        database_id: db.id,
        name: c.column_name,
        pg_name: c.column_name,
        type: mapPgType(c.data_type),
        position: pos++,
      })
      cols.push(col)
    }
    return view(db, cols, [])
  })
}

// ── 조회 ─────────────────────────────────────────────────────────────────────

export async function listDatabases(project: string): Promise<DatabaseSummary[]> {
  await ensureCatalog()
  const rows = await catalog.listDatabaseRows(exec, project)
  return rows.map((r) => ({ id: r.id, title: r.title, kind: r.kind, editable: r.kind === 'managed' }))
}

export async function getView(project: string, id: string): Promise<DatabaseView> {
  await ensureCatalog()
  const db = await getDatabaseOrThrow(exec, project, id)
  const columns = await catalog.listColumns(exec, db.id)
  const rows = db.kind === 'managed' ? await readManagedRows(db, columns) : await readExternalRows(db, columns)
  return view(db, columns, rows)
}

// ── 행(row) 변경 (managed 전용) ────────────────────────────────────────────────

export async function insertRow(project: string, id: string): Promise<RowData> {
  await ensureCatalog()
  const db = await getManagedOrThrow(exec, project, id)
  const target = `${quoteIdent(db.phys_schema)}.${quoteIdent(db.phys_table)}`
  const { rows } = await exec<{ id: string; pos: number }>(
    `INSERT INTO ${target} (pos) VALUES ((SELECT COALESCE(MAX(pos) + 1, 0) FROM ${target})) RETURNING id, pos`,
  )
  const columns = await catalog.listColumns(exec, db.id)
  const row: RowData = { id: String(rows[0].id), pos: Number(rows[0].pos), cells: emptyCells(columns) }
  publishDbEvent(project, id, { type: 'row.insert', row })
  return row
}

export async function updateCell(
  project: string,
  id: string,
  rowId: string,
  columnId: string,
  value: unknown,
): Promise<unknown> {
  await ensureCatalog()
  const db = await getManagedOrThrow(exec, project, id)
  assertRowId(rowId)
  const col = await catalog.getColumn(exec, db.id, columnId)
  if (!col) throw new DbObjectNotFoundError('컬럼을 찾을 수 없습니다')
  const coerced = coerce(col.type, value)
  const { rowCount } = await exec(
    `UPDATE ${quoteIdent(db.phys_schema)}.${quoteIdent(db.phys_table)} SET ${quoteIdent(col.pg_name)} = $1 WHERE id = $2`,
    [coerced, rowId],
  )
  if (!rowCount) throw new DbObjectNotFoundError('행을 찾을 수 없습니다')
  publishDbEvent(project, id, { type: 'row.update', rowId, columnId, value: coerced })
  return coerced
}

export async function deleteRow(project: string, id: string, rowId: string): Promise<void> {
  await ensureCatalog()
  const db = await getManagedOrThrow(exec, project, id)
  assertRowId(rowId)
  const { rowCount } = await exec(
    `DELETE FROM ${quoteIdent(db.phys_schema)}.${quoteIdent(db.phys_table)} WHERE id = $1`,
    [rowId],
  )
  if (!rowCount) throw new DbObjectNotFoundError('행을 찾을 수 없습니다')
  publishDbEvent(project, id, { type: 'row.delete', rowId })
}

// ── 컬럼(schema) 변경 (managed 전용) ──────────────────────────────────────────

export async function addColumn(project: string, id: string, name: string, type: ColumnType): Promise<ColumnDef> {
  await ensureCatalog()
  if (!isColumnType(type)) throw new DbValidationError('알 수 없는 컬럼 타입입니다')
  const db = await getManagedOrThrow(exec, project, id)
  const pgName = newColumnName()
  const col = await withTransaction(async (tx) => {
    await tx(
      `ALTER TABLE ${quoteIdent(db.phys_schema)}.${quoteIdent(db.phys_table)} ADD COLUMN ${quoteIdent(pgName)} ${COLUMN_TYPES[type].pg}`,
    )
    const position = await catalog.nextColumnPosition(tx, db.id)
    return catalog.insertColumn(tx, { database_id: db.id, name: cleanName(name), pg_name: pgName, type, position })
  })
  await publishSchema(project, db.id)
  return colDef(col)
}

export async function renameColumn(project: string, id: string, columnId: string, name: string): Promise<ColumnDef> {
  await ensureCatalog()
  const db = await getManagedOrThrow(exec, project, id)
  const col = await catalog.getColumn(exec, db.id, columnId)
  if (!col) throw new DbObjectNotFoundError('컬럼을 찾을 수 없습니다')
  await catalog.updateColumnName(exec, columnId, cleanName(name))
  await publishSchema(project, db.id)
  return { id: col.id, name: cleanName(name), type: col.type }
}

export async function deleteColumn(project: string, id: string, columnId: string): Promise<void> {
  await ensureCatalog()
  const db = await getManagedOrThrow(exec, project, id)
  const col = await catalog.getColumn(exec, db.id, columnId)
  if (!col) throw new DbObjectNotFoundError('컬럼을 찾을 수 없습니다')
  await withTransaction(async (tx) => {
    await tx(`ALTER TABLE ${quoteIdent(db.phys_schema)}.${quoteIdent(db.phys_table)} DROP COLUMN ${quoteIdent(col.pg_name)}`)
    await catalog.deleteColumnRow(tx, columnId)
  })
  await publishSchema(project, db.id)
}

// ── 메타데이터 변경 ────────────────────────────────────────────────────────────

// 제목은 카탈로그 라벨일 뿐(external의 원본 테이블과 무관)이라 managed/external 모두 변경 가능.
export async function renameDatabase(project: string, id: string, title: string): Promise<DatabaseSummary> {
  await ensureCatalog()
  const db = await getDatabaseOrThrow(exec, project, id)
  const clean = cleanTitle(title)
  await catalog.updateDatabaseTitle(exec, project, id, clean)
  publishDbEvent(project, id, { type: 'title', title: clean })
  return { id: db.id, title: clean, kind: db.kind, editable: db.kind === 'managed' }
}

// ── 삭제 ─────────────────────────────────────────────────────────────────────

export async function deleteDatabase(project: string, id: string): Promise<void> {
  await ensureCatalog()
  const db = await getDatabaseOrThrow(exec, project, id)
  await withTransaction(async (tx) => {
    // external은 원본 테이블을 절대 건드리지 않는다 — 카탈로그 행만 지운다 (컬럼은 CASCADE).
    if (db.kind === 'managed') {
      await tx(`DROP TABLE IF EXISTS ${quoteIdent(db.phys_schema)}.${quoteIdent(db.phys_table)}`)
    }
    await catalog.deleteDatabaseRow(tx, project, id)
  })
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

async function getDatabaseOrThrow(q: Exec, project: string, id: string): Promise<DatabaseRow> {
  const db = await catalog.getDatabaseRow(q, project, id)
  if (!db) throw new DbObjectNotFoundError('데이터베이스를 찾을 수 없습니다')
  return db
}

async function getManagedOrThrow(q: Exec, project: string, id: string): Promise<DatabaseRow> {
  const db = await getDatabaseOrThrow(q, project, id)
  if (db.kind !== 'managed') throw new DbReadOnlyError('참조(external) 데이터베이스는 편집할 수 없습니다')
  return db
}

async function readManagedRows(db: DatabaseRow, columns: ColumnRow[]): Promise<RowData[]> {
  const selectCols = columns.map((c) => quoteIdent(c.pg_name)).join(', ')
  const sql =
    `SELECT id, pos${selectCols ? ', ' + selectCols : ''} ` +
    `FROM ${quoteIdent(db.phys_schema)}.${quoteIdent(db.phys_table)} ORDER BY pos, id LIMIT ${ROW_LIMIT}`
  const { rows } = await exec(sql)
  return rows.map((r) => ({ id: String(r.id), pos: Number(r.pos), cells: cellsFrom(columns, r) }))
}

async function readExternalRows(db: DatabaseRow, columns: ColumnRow[]): Promise<RowData[]> {
  const selectCols = columns.map((c) => quoteVerifiedIdent(c.pg_name)).join(', ')
  if (!selectCols) return []
  const sql =
    `SELECT ${selectCols} FROM ${quoteVerifiedIdent(db.phys_schema)}.${quoteVerifiedIdent(db.phys_table)} LIMIT ${ROW_LIMIT}`
  const { rows } = await exec(sql)
  // external은 안정적인 행 ID가 없으므로 순번을 ID로 쓴다 (읽기 전용이라 React key 용도로 충분).
  return rows.map((r, i) => ({ id: String(i), pos: i, cells: cellsFrom(columns, r) }))
}

function cellsFrom(columns: ColumnRow[], row: Record<string, unknown>): Record<string, unknown> {
  const cells: Record<string, unknown> = {}
  for (const c of columns) cells[c.id] = normalizeOut(c.type, row[c.pg_name])
  return cells
}

function emptyCells(columns: ColumnRow[]): Record<string, unknown> {
  const cells: Record<string, unknown> = {}
  for (const c of columns) cells[c.id] = null
  return cells
}

async function publishSchema(project: string, dbId: string): Promise<void> {
  const columns = (await catalog.listColumns(exec, dbId)).map(colDef)
  publishDbEvent(project, dbId, { type: 'schema', columns })
}

// 저장 전 값 강제 변환 (타입 검증 포함)
function coerce(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null
  switch (type) {
    case 'number': {
      const n = Number(value)
      if (Number.isNaN(n)) throw new DbValidationError('숫자가 아닙니다')
      return n
    }
    case 'checkbox':
      return value === true || value === 'true'
    case 'date': {
      const s = String(value)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new DbValidationError('날짜는 YYYY-MM-DD 형식이어야 합니다')
      return s
    }
    default:
      return String(value)
  }
}

// DB에서 읽은 값을 클라이언트용 JSON 값으로 정규화
function normalizeOut(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null
  switch (type) {
    case 'number':
      return typeof value === 'number' ? value : Number(value)
    case 'checkbox':
      return Boolean(value)
    case 'date':
      // pool.ts에서 DATE 타입 파서를 문자열로 고정해 두었다 (TZ 왜곡 방지)
      return String(value)
    default:
      return String(value)
  }
}

function colDef(row: ColumnRow): ColumnDef {
  return { id: row.id, name: row.name, type: row.type }
}

function view(db: DatabaseRow, columns: ColumnRow[], rows: RowData[]): DatabaseView {
  return {
    id: db.id,
    title: db.title,
    kind: db.kind,
    editable: db.kind === 'managed',
    columns: columns.map(colDef),
    rows,
  }
}

function assertRowId(id: string): void {
  if (!UUID_RE.test(id)) throw new DbValidationError('올바르지 않은 행 ID입니다')
}

function cleanTitle(t: string | null | undefined): string {
  const s = (t ?? '').trim()
  return s || '제목 없음'
}

function cleanName(n: string | null | undefined): string {
  const s = (n ?? '').trim()
  return s || '열'
}
