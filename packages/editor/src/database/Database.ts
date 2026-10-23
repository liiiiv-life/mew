// /db 데이터베이스 노드 — 본문에는 참조 id만 담는 atom 블록이고, 실제 표는 DatabaseView(React)가
// 서버(Postgres)에서 불러와 실시간으로 렌더한다. 스키마·마크다운(<div data-mew-db="uuid"> 라운드트립)은
// databaseSchema.ts에 있고(서버 headless 협업 에디터와 공유), 여기선 그 노드뷰만 얹는다.
import { ReactNodeViewRenderer } from '@tiptap/react'
import { DatabaseView } from './DatabaseView'
import { databaseNode } from './databaseSchema'

export type { DatabaseOptions } from './databaseSchema'

export const Database = databaseNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseView)
  },
})
