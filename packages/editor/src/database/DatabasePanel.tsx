// TipTap 밖에서 /db 표를 그대로 쓰기 위한 독립 패널 — 호스트 앱의 "전체 DB 팝업"이
// 선택한 데이터베이스를 편집/열람할 때 재사용한다. 노드뷰와 같은 훅·표를 공유한다.
import type { EditorDbApi } from '../types'
import { useDatabaseView } from './useDatabaseView'
import { DatabaseTable } from './DatabaseTable'

export function DatabasePanel({
  api,
  dbId,
  readonly = false,
  className,
}: {
  api: EditorDbApi | null
  dbId: string | null
  /** true면 강제 읽기 전용 (managed여도 편집 UI를 감춤) */
  readonly?: boolean
  className?: string
}) {
  const ctrl = useDatabaseView(api, dbId, readonly)
  return (
    <div className={className}>
      <DatabaseTable ctrl={ctrl} />
    </div>
  )
}
