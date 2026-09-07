// Postgres 연결 풀 — /db 데이터베이스 뷰의 유일한 저장소.
// DATABASE_URL이 없으면 명확한 에러를 던져 "docker/env 설정을 하라"고 안내한다.
import pgpkg from 'pg'
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

const { Pool: PgPool } = pgpkg

// DATE(OID 1082)는 원문 'YYYY-MM-DD' 문자열로 받는다 — 기본 Date 파싱은 TZ에 따라 하루 밀릴 수 있다.
pgpkg.types.setTypeParser(1082, (v) => v)

export class DbNotConfiguredError extends Error {}

// 쿼리 실행기 — 풀 또는 트랜잭션 클라이언트를 동일 인터페이스로 다뤄 catalog/service가 트랜잭션에 참여할 수 있게 한다.
export type Exec = <T extends QueryResultRow = Record<string, unknown>>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>

let pool: Pool | null = null

export function isDbConfigured(): boolean {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0
}

export function getPool(): Pool {
  if (!isDbConfigured()) {
    throw new DbNotConfiguredError(
      'DATABASE_URL이 설정되지 않았습니다 — `npm run db:up`으로 Postgres 컨테이너를 띄우고 mew/.env를 확인하세요 (.env.example 참고).',
    )
  }
  if (!pool) {
    pool = new PgPool({ connectionString: process.env.DATABASE_URL, max: 10 })
  }
  return pool
}

// 풀에서 바로 쿼리 (트랜잭션 밖)
export const exec: Exec = (text, params = []) =>
  getPool().query(text, params as unknown[]) as Promise<QueryResult<never>>

// BEGIN/COMMIT/ROLLBACK을 감싼 트랜잭션 — 콜백에는 이 트랜잭션에 묶인 Exec가 전달된다.
export async function withTransaction<T>(fn: (tx: Exec) => Promise<T>): Promise<T> {
  const client: PoolClient = await getPool().connect()
  const txExec: Exec = (text, params = []) =>
    client.query(text, params as unknown[]) as Promise<QueryResult<never>>
  try {
    await client.query('BEGIN')
    const result = await fn(txExec)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// 테스트에서 풀을 닫아 프로세스가 매달리지 않게 한다.
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
