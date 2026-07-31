// 카탈로그(mew.databases / mew.columns) 데이터 접근 계층 — 순수 메타데이터 CRUD.
// DDL(테이블/컬럼 생성)이나 물리 데이터는 다루지 않는다 (그건 databaseService.ts). 모든 함수는 Exec를 받아 트랜잭션에 참여할 수 있다.
import type { Exec } from './pool.ts'
import type { ColumnType } from './schema.ts'

export interface DatabaseRow {
  id: string
  project: string
  title: string
  kind: 'managed' | 'external'
  phys_schema: string
  phys_table: string
  created_by: string | null
}

export interface ColumnRow {
  id: string
  database_id: string
  name: string
  pg_name: string
  type: ColumnType
  position: number
}

export async function insertDatabase(
  q: Exec,
  input: {
    project: string
    title: string
    kind: 'managed' | 'external'
    phys_schema: string
    phys_table: string
    created_by: string | null
  },
): Promise<DatabaseRow> {
  const { rows } = await q<DatabaseRow>(
    `INSERT INTO mew.databases (project, title, kind, phys_schema, phys_table, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, project, title, kind, phys_schema, phys_table, created_by`,
    [input.project, input.title, input.kind, input.phys_schema, input.phys_table, input.created_by],
  )
  return rows[0]
}

// 프로젝트 단위로 스코프 — 다른 프로젝트의 dbId로는 절대 조회되지 않는다 (격리 보장).
export async function getDatabaseRow(q: Exec, project: string, id: string): Promise<DatabaseRow | null> {
  const { rows } = await q<DatabaseRow>(
    `SELECT id, project, title, kind, phys_schema, phys_table, created_by
       FROM mew.databases WHERE id = $1 AND project = $2`,
    [id, project],
  )
  return rows[0] ?? null
}

export async function listDatabaseRows(q: Exec, project: string): Promise<DatabaseRow[]> {
  const { rows } = await q<DatabaseRow>(
    `SELECT id, project, title, kind, phys_schema, phys_table, created_by
       FROM mew.databases WHERE project = $1 ORDER BY created_at`,
    [project],
  )
  return rows
}

export async function deleteDatabaseRow(q: Exec, project: string, id: string): Promise<void> {
  await q(`DELETE FROM mew.databases WHERE id = $1 AND project = $2`, [id, project])
}

export async function updateDatabaseTitle(q: Exec, project: string, id: string, title: string): Promise<void> {
  await q(`UPDATE mew.databases SET title = $3 WHERE id = $1 AND project = $2`, [id, project, title])
}

export async function insertColumn(
  q: Exec,
  input: { database_id: string; name: string; pg_name: string; type: ColumnType; position: number },
): Promise<ColumnRow> {
  const { rows } = await q<ColumnRow>(
    `INSERT INTO mew.columns (database_id, name, pg_name, type, position)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, database_id, name, pg_name, type, position`,
    [input.database_id, input.name, input.pg_name, input.type, input.position],
  )
  return rows[0]
}

export async function listColumns(q: Exec, databaseId: string): Promise<ColumnRow[]> {
  const { rows } = await q<ColumnRow>(
    `SELECT id, database_id, name, pg_name, type, position
       FROM mew.columns WHERE database_id = $1 ORDER BY position, created_at`,
    [databaseId],
  )
  return rows
}

export async function getColumn(q: Exec, databaseId: string, columnId: string): Promise<ColumnRow | null> {
  const { rows } = await q<ColumnRow>(
    `SELECT id, database_id, name, pg_name, type, position
       FROM mew.columns WHERE id = $1 AND database_id = $2`,
    [columnId, databaseId],
  )
  return rows[0] ?? null
}

export async function updateColumnName(q: Exec, columnId: string, name: string): Promise<void> {
  await q(`UPDATE mew.columns SET name = $2 WHERE id = $1`, [columnId, name])
}

export async function deleteColumnRow(q: Exec, columnId: string): Promise<void> {
  await q(`DELETE FROM mew.columns WHERE id = $1`, [columnId])
}

export async function nextColumnPosition(q: Exec, databaseId: string): Promise<number> {
  const { rows } = await q<{ next: number }>(
    `SELECT COALESCE(MAX(position) + 1, 0) AS next FROM mew.columns WHERE database_id = $1`,
    [databaseId],
  )
  return Number(rows[0].next)
}
