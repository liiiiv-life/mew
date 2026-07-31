// /db 데이터베이스 노드의 스키마·마크다운 정의(React 없음). 본문엔 참조 id만 담는 atom 블록이고
// 실제 표는 DatabaseView(React)가 렌더한다 — 그 노드뷰는 Database.ts가 얹는다. 클라이언트와 서버
// headless 협업 에디터가 같은 스키마를 공유하도록 노드뷰와 분리해 둔다.
import { Node, mergeAttributes } from '@tiptap/core'
import type { EditorApi } from '../types.ts'
import { databaseMarkdown, parseDbId, parseReadonly } from './databaseMarkdown.ts'

export interface DatabaseOptions {
  /** 호스트가 주입하는 서버 연동 — 노드뷰가 props.extension.options.api로 읽는다 */
  api: EditorApi | null
}

export const databaseNode = Node.create<DatabaseOptions>({
  name: 'database',
  group: 'block',
  atom: true, // 내부에 편집 가능한 PM 콘텐츠 없음 — 표는 노드뷰가 관리
  selectable: true,
  // draggable=false: 드래그 핸들이 노드뷰 전체를 덮으면 표 안 입력의 mousedown을 가로채 포커스를
  // 뺏는다. 표는 폼 컨트롤 위주라 드래그 재배치보다 입력 상호작용을 우선한다.
  draggable: false,

  addOptions() {
    return { api: null }
  },

  addAttributes() {
    return {
      dbId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-mew-db'),
        renderHTML: (attrs) => (attrs.dbId ? { 'data-mew-db': attrs.dbId } : {}),
      },
      // 기존 데이터베이스를 뷰 전용으로 참조하는 노드 — true면 편집 UI를 감춘다(원본은 별개 노드에서 편집).
      readonly: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-mew-db-readonly') === 'true',
        renderHTML: (attrs) => (attrs.readonly ? { 'data-mew-db-readonly': 'true' } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-mew-db]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes)]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const id = parseDbId(node.attrs.dbId)
          if (id) state.write(databaseMarkdown(id, parseReadonly(node.attrs.readonly ? 'true' : null)))
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})
