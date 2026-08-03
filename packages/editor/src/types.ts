import type { Doc } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

/** 문서 트리 노드 — 호스트 앱이 서버에서 받아 Editor·FileTree 등에 넘긴다 */
export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
  guestAccess?: { view: boolean; edit: boolean }
}

/** 호스트 앱의 useCollab이 넘기는 협업 세션 — 있으면 Y.XmlFragment가 본문의 진실 원천이 된다 */
export interface EditorCollab {
  ydoc: Doc
  awareness: Awareness
  /** 첫 sync 응답 전에는 방이 "비어 있는지" 신뢰할 수 없다 — 시딩은 이 값이 true가 된 뒤에만 */
  synced: boolean
}

// ── /db 데이터베이스 뷰 (노션 유사) ──────────────────────────────────────────
// 서버 databaseService/hub와 형태를 맞춘다 — 에디터는 fetch 경로·프로젝트·소켓 URL을 모른다.

export type DbColumnType = 'text' | 'number' | 'checkbox' | 'date'

export interface DbColumn {
  id: string
  name: string
  type: DbColumnType
}

export interface DbRow {
  id: string
  pos: number
  cells: Record<string, unknown> // columnId → value
}

export interface DbView {
  id: string
  title: string
  kind: 'managed' | 'external'
  editable: boolean
  columns: DbColumn[]
  rows: DbRow[]
}

export interface DbSummary {
  id: string
  title: string
  kind: 'managed' | 'external'
  editable: boolean
}

/** 실시간 이벤트 — 서버 hub의 DbEvent와 동일 구조 */
export type DbEvent =
  | { type: 'row.insert'; row: DbRow }
  | { type: 'row.update'; rowId: string; columnId: string; value: unknown }
  | { type: 'row.delete'; rowId: string }
  | { type: 'schema'; columns: DbColumn[] }
  | { type: 'title'; title: string }

/** 데이터베이스 뷰가 쓰는 서버 연동 — 프로젝트 스코프는 호스트가 붙인다 */
export interface EditorDbApi {
  list: () => Promise<DbSummary[]>
  create: (title: string) => Promise<DbView>
  attachExternal: (schema: string, table: string, title?: string) => Promise<DbView>
  getView: (id: string) => Promise<DbView>
  remove: (id: string) => Promise<void>
  rename: (id: string, title: string) => Promise<void>
  insertRow: (id: string) => Promise<DbRow>
  updateCell: (id: string, rowId: string, columnId: string, value: unknown) => Promise<unknown>
  deleteRow: (id: string, rowId: string) => Promise<void>
  addColumn: (id: string, name: string, type: DbColumnType) => Promise<DbColumn>
  renameColumn: (id: string, columnId: string, name: string) => Promise<DbColumn>
  deleteColumn: (id: string, columnId: string) => Promise<void>
  /** 실시간 구독 — 반환된 함수를 호출하면 구독 해제 */
  subscribe: (id: string, onEvent: (event: DbEvent) => void) => () => void
}

/** 호스트 앱이 주입하는 서버 연동 — 에디터는 fetch 경로·인증을 모른다 */
/** 문서 안 표의 등장 순서대로의 열 너비(px). null = 그 표는 저장된 너비 없음 */
export type TableWidths = (number[] | null)[]

export interface EditorApi {
  fetchFile: (path: string) => Promise<{ path: string; content: string; editable: boolean }>
  uploadAsset: (file: File) => Promise<{ url: string; name: string; mimetype: string }>
  fetchLinkPreview: (url: string) => Promise<{ title: string | null; description: string | null }>
  /** 표 열 너비 — md가 담지 못하는 레이아웃이라 호스트가 본문 밖(.mew/)에 저장한다 */
  fetchTableLayout?: (path: string) => Promise<TableWidths>
  saveTableLayout?: (path: string, tables: TableWidths) => Promise<void>
  db: EditorDbApi
}
