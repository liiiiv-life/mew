// /db 뷰의 실시간 상태 리듀서 — 순수 함수라 node:test로 검증한다(React/DOM 없음).
// 서버 hub의 DbEvent를 로컬 DbView에 접었다 폈다 하며, 렌더는 DatabaseView가 담당한다.
import type { DbEvent, DbView } from '../types'

/** 한 셀 값을 불변으로 갱신 — 해당 행이 없으면 원본 그대로 반환 */
export function setCell(view: DbView, rowId: string, columnId: string, value: unknown): DbView {
  let changed = false
  const rows = view.rows.map((r) => {
    if (r.id !== rowId) return r
    changed = true
    return { ...r, cells: { ...r.cells, [columnId]: value } }
  })
  return changed ? { ...view, rows } : view
}

/** 실시간 이벤트를 뷰에 적용 — 항상 새 객체를 반환(React 리렌더용) */
export function applyDbEvent(view: DbView, event: DbEvent): DbView {
  switch (event.type) {
    case 'row.insert': {
      if (view.rows.some((r) => r.id === event.row.id)) return view // 내가 방금 넣은 행의 에코 방지
      const rows = [...view.rows, event.row].sort((a, b) => a.pos - b.pos || (a.id < b.id ? -1 : 1))
      return { ...view, rows }
    }
    case 'row.update':
      return setCell(view, event.rowId, event.columnId, event.value)
    case 'row.delete':
      return { ...view, rows: view.rows.filter((r) => r.id !== event.rowId) }
    case 'schema':
      return { ...view, columns: event.columns }
    case 'title':
      return { ...view, title: event.title }
    default:
      return view
  }
}
