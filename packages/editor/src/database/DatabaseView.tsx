// /db 노드의 렌더 — 조회·여러 뷰는 useDatabaseView + DatabaseCollection에 있고, 여기선
// TipTap 노드 속성(dbId/readonly)과 주입된 api를 읽어 넘기고 ProseMirror 상호작용만 격리한다.
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useState } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import type { DatabaseOptions } from './Database'
import type { EditorDbApi } from '../types'
import { useDatabaseView } from './useDatabaseView'
import { DatabaseCollection } from './DatabaseCollection'
import { normalizeDatabaseLayout } from './databaseLayout'
import { convertDatabaseToTable } from './tableConversion'

export function DatabaseView(props: NodeViewProps) {
  const dbId = (props.node.attrs.dbId as string | null) ?? null
  const readonly = props.node.attrs.readonly === true // 뷰 전용 참조 노드
  const api: EditorDbApi | null = (props.extension.options as DatabaseOptions).api?.db ?? null
  const ctrl = useDatabaseView(api, dbId, readonly)
  const [converting, setConverting] = useState(false), [conversionError, setConversionError] = useState<string | null>(null)
  const convert = async () => {
    const pos = props.getPos()
    if (pos == null || !api || converting) return
    setConverting(true); setConversionError(null)
    try { await convertDatabaseToTable(props.editor, pos, api) }
    catch (error) { setConversionError(error instanceof Error ? error.message : uiText('데이터베이스를 불러오지 못했습니다')) }
    finally { setConverting(false) }
  }

  return (
    <NodeViewWrapper className="my-2">
      {/* contentEditable=false + mousedown/keydown 전파 차단: 표 안의 입력·클릭이 ProseMirror의
          노드 선택/드래그로 새어 포커스를 뺏기지 않게 한다 (그러지 않으면 셀·제목 입력이 안 됨) */}
      <div
        contentEditable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
      >
        <DatabaseCollection key={dbId} ctrl={ctrl} initialLayout={normalizeDatabaseLayout(props.node.attrs.layout)} onLayoutChange={props.editor.isEditable ? layout => props.updateAttributes({ layout }) : undefined} onOpenPage={(props.extension.options as DatabaseOptions).onOpenPage} onConvertToTable={props.editor.isEditable && ctrl.view && !converting ? () => { void convert() } : undefined} />
        {conversionError && <p role="alert" className="px-2 py-1 text-xs text-danger-strong">{conversionError}</p>}
      </div>
    </NodeViewWrapper>
  )
}
