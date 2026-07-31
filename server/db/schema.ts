// 컬럼 타입 레지스트리 + 카탈로그 스키마 부트스트랩.
// 새 컬럼 타입은 COLUMN_TYPES에 한 줄 추가하면 서비스 전반에 반영된다 (확장 지점).
import { exec } from './pool.ts'

export const COLUMN_TYPES = {
  text: { pg: 'text', label: '텍스트' },
  number: { pg: 'double precision', label: '숫자' },
  checkbox: { pg: 'boolean', label: '체크박스' },
  date: { pg: 'date', label: '날짜' },
} as const

export type ColumnType = keyof typeof COLUMN_TYPES

export function isColumnType(v: unknown): v is ColumnType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(COLUMN_TYPES, v)
}

// external(외부) 테이블 introspection 시 pg 데이터 타입 → 우리 컬럼 타입 매핑. 미지원은 text로 폴백.
export function mapPgType(pgType: string): ColumnType {
  const t = pgType.toLowerCase()
  if (['double precision', 'numeric', 'integer', 'bigint', 'smallint', 'real', 'decimal'].includes(t)) return 'number'
  if (t === 'boolean') return 'checkbox'
  if (['date', 'timestamp without time zone', 'timestamp with time zone', 'timestamptz'].includes(t)) return 'date'
  return 'text'
}

// 카탈로그(mew 스키마)는 프로젝트 무관 전역 메타데이터를 담는다. 최초 사용 시 1회만 생성.
let catalogReady: Promise<void> | null = null

export function ensureCatalog(): Promise<void> {
  if (!catalogReady) {
    catalogReady = bootstrap().catch((err) => {
      catalogReady = null // 실패하면 다음 호출에서 재시도할 수 있게 캐시 해제
      throw err
    })
  }
  return catalogReady
}

async function bootstrap(): Promise<void> {
  await exec(`CREATE SCHEMA IF NOT EXISTS mew`)
  await exec(`
    CREATE TABLE IF NOT EXISTS mew.databases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project text NOT NULL,
      title text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('managed','external')),
      phys_schema text NOT NULL,
      phys_table text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by text
    )
  `)
  await exec(`CREATE INDEX IF NOT EXISTS databases_project_idx ON mew.databases (project)`)
  await exec(`
    CREATE TABLE IF NOT EXISTS mew.columns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      database_id uuid NOT NULL REFERENCES mew.databases(id) ON DELETE CASCADE,
      name text NOT NULL,
      pg_name text NOT NULL,
      type text NOT NULL,
      position integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await exec(`CREATE INDEX IF NOT EXISTS columns_database_idx ON mew.columns (database_id)`)
}
