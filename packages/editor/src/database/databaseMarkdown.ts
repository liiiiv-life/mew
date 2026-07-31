// /db 노드의 마크다운 표현 — 본문에는 참조 id만 저장한다(<div data-mew-db="uuid">). 실제 데이터는 Postgres가 SSoT.
// 순수 함수만 두어(DOM/네트워크 없음) node:test로 라운드트립을 검증할 수 있게 한다.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isDbId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

/** 노드 → 마크다운(=HTML 블록). dbId는 uuid만 허용하므로 속성 인젝션 여지가 없다.
 * readonly면 data-mew-db-readonly="true"를 덧붙인다(기존 DB를 뷰 전용으로 참조하는 노드). */
export function databaseMarkdown(dbId: string, readonly = false): string {
  return `<div data-mew-db="${dbId}"${readonly ? ' data-mew-db-readonly="true"' : ''}></div>`
}

/** data-mew-db 속성값 → 검증된 dbId (아니면 null) */
export function parseDbId(attr: string | null | undefined): string | null {
  return isDbId(attr) ? attr : null
}

/** data-mew-db-readonly 속성값 → boolean (뷰 전용 참조 여부) */
export function parseReadonly(attr: string | null | undefined): boolean {
  return attr === 'true'
}
