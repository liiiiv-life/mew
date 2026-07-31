// /db 노드의 렌더 — 실제 표 로직/렌더는 useDatabaseView + DatabaseTable에 있고, 여기선
// TipTap 노드 속성(dbId/readonly)과 주입된 api를 읽어 넘기고 ProseMirror 상호작용만 격리한다.
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import type { DatabaseOptions } from './Database'
import type { EditorDbApi } from '../types'
import { useDatabaseView } from './useDatabaseView'
import { DatabaseTable } from './DatabaseTable'

export function DatabaseView(props: NodeViewProps) {
  const dbId = (props.node.attrs.dbId as string | null) ?? null
  const readonly = props.node.attrs.readonly === true // 뷰 전용 참조 노드
  const api: EditorDbApi | null = (props.extension.options as DatabaseOptions).api?.db ?? null
  const ctrl = useDatabaseView(api, dbId, readonly)

  return (
    <NodeViewWrapper className="my-3">
      {/* contentEditable=false + mousedown/keydown 전파 차단: 표 안의 입력·클릭이 ProseMirror의
          노드 선택/드래그로 새어 포커스를 뺏기지 않게 한다 (그러지 않으면 셀·제목 입력이 안 됨) */}
      <div
        contentEditable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
      >
        <DatabaseTable ctrl={ctrl} />
      </div>
    </NodeViewWrapper>
  )
}
