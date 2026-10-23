// SQL 식별자(스키마·테이블·컬럼) 안전 처리 — /db는 사용자 입력으로 물리 테이블을 만들기 때문에
// 값은 항상 파라미터($1)로, 식별자는 반드시 이 모듈을 거쳐야 인젝션을 막는다.
import crypto from 'node:crypto'

export class InvalidIdentifierError extends Error {}

// 우리가 생성하는 모든 물리 식별자는 이 형태만 허용 — 소문자/밑줄로 시작, 소문자·숫자·밑줄만.
const IDENT_RE = /^[a-z_][a-z0-9_]*$/
const MAX_IDENT_LEN = 63 // Postgres 기본 식별자 길이 제한

// 우리가 생성한(엄격한) 식별자인지 검증한다. 실패 시 예외.
export function assertIdent(name: string): string {
  if (typeof name !== 'string' || !IDENT_RE.test(name) || name.length > MAX_IDENT_LEN) {
    throw new InvalidIdentifierError(`허용되지 않는 식별자입니다: ${JSON.stringify(name)}`)
  }
  return name
}

// 검증을 통과한 식별자를 큰따옴표로 감싼다.
export function quoteIdent(name: string): string {
  return `"${assertIdent(name)}"`
}

// external(외부) 테이블·컬럼 전용 — 대문자·특수문자를 포함할 수 있어 큰따옴표만 이스케이프한다.
// 반드시 information_schema로 "실재를 확인한" 이름에만 써야 한다 (임의 문자열에 쓰면 인젝션 위험).
export function quoteVerifiedIdent(name: string): string {
  if (typeof name !== 'string' || name.length === 0 || /[\s\p{Cc}]/u.test(name)) {
    throw new InvalidIdentifierError('올바르지 않은 외부 식별자입니다')
  }
  return `"${name.replace(/"/g, '""')}"`
}

// 프로젝트명 → 스키마명. 프로젝트명은 [A-Za-z0-9._-] 을 허용하므로 .-를 _로 치환해 식별자 규칙에 맞춘다.
export function projectSchema(project: string): string {
  const safe = project.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  return assertIdent(`mew_${safe}`)
}

// managed 데이터베이스의 물리 테이블명 (충돌 없는 랜덤).
export function newTableName(): string {
  return `db_${crypto.randomUUID().replace(/-/g, '')}`
}

// managed 컬럼의 물리 컬럼명 (표시 이름과 분리 — 이름 변경/삭제/재추가에도 안전).
export function newColumnName(): string {
  return `c_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}
