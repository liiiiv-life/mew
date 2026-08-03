// 서버 headless 협업 에디터(server/collabAgent.ts)가 쓰는 확장 목록. Editor.tsx의 클라이언트
// 목록과 "스키마·마크다운이 정확히 같아야" 협업 병합 시 문서가 재포맷되지 않는다 — React 노드뷰만
// 빠진 형태로 같은 스키마 모듈(imageNode/databaseNode/MediaNodes)과 같은 표준 tiptap 확장을 쓴다.
// Placeholder(장식 플러그인)와 Collaboration/CollaborationCaret은 스키마와 무관하거나 방마다
// 붙여야 해서 여기 넣지 않는다 — 호출부(collabAgent)가 방별로 Collaboration을 덧붙인다.
import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import Paragraph from '@tiptap/extension-paragraph'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Strike from '@tiptap/extension-strike'
import Code from '@tiptap/extension-code'
import CodeBlock from '@tiptap/extension-code-block'
import Heading from '@tiptap/extension-heading'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import Blockquote from '@tiptap/extension-blockquote'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import Link from '@tiptap/extension-link'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
// 이 모듈 그래프는 server/collabAgent가 Node에서 직접 로드하므로(@mew/editor/server 서브패스),
// 상대 임포트는 server/*.ts처럼 반드시 확장자를 붙인다 — Node ESM 로더는 확장자 생략을 해석하지 않는다.
import { ListConversion } from './editor/listConversion.ts'
import { IndentableListItem } from './editor/listIndent.ts'
import { imageNode } from './imageSchema.ts'
import { AudioNode, VideoNode, Youtube } from './MediaNodes.ts'
import { databaseNode } from './database/databaseSchema.ts'

// Editor.tsx의 useEditor extensions와 1:1로 맞춘 스키마 목록(노드뷰·collab 제외).
export function serverEditorExtensions(): Extensions {
  return [
    Document,
    Text,
    Paragraph,
    // 아래에서 개별 등록하는 확장은 StarterKit 쪽을 반드시 꺼 둔다 — 중복 등록은 tiptap 경고와
    // 플러그인 이중 실행을 부른다. Editor.tsx의 StarterKit.configure와 같은 목록이어야 한다.
    StarterKit.configure({
      document: false,
      text: false,
      paragraph: false,
      codeBlock: false,
      bold: false,
      italic: false,
      strike: false,
      code: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      blockquote: false,
      horizontalRule: false,
      link: false,
      // 서버는 항상 Collaboration을 붙이므로 기본 undo/redo 히스토리는 끈다 (Yjs와 충돌)
      undoRedo: false,
    }),
    Bold,
    Italic,
    Strike,
    Code,
    // 클라이언트는 CodeBlockWithCopy를 쓰지만 그건 복사 버튼(노드뷰)·복사 동작만 얹었을 뿐 노드
    // 스키마·마크다운(``` 펜스)은 표준 CodeBlock과 동일하다. 서버는 DOM 노드뷰가 필요 없으므로 표준
    // CodeBlock으로 파리티를 맞춘다(같은 HTMLAttributes.class 포함).
    CodeBlock.configure({ HTMLAttributes: { class: 'code-block' } }),
    Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    BulletList,
    OrderedList,
    // 기본 ListItem이 아니라 첫 자식으로 리스트를 허용하는 쪽 — 이유는 editor/listIndent.ts
    IndentableListItem,
    ListConversion,
    Blockquote,
    HorizontalRule,
    Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-link underline', target: null, rel: null } }),
    TableKit.configure({ table: { allowTableNodeSelection: true, resizable: true } }),
    imageNode,
    AudioNode,
    VideoNode,
    Youtube,
    // 표 데이터(api)는 노드뷰만 쓰므로 서버 스키마엔 불필요 — 마크다운 라운드트립엔 dbId만 있으면 된다
    databaseNode,
    Markdown.configure({ transformCopiedText: true, transformPastedText: true }),
  ]
}
