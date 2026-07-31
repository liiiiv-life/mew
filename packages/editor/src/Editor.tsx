import { useEditor, EditorContent, type Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import Paragraph from '@tiptap/extension-paragraph'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Strike from '@tiptap/extension-strike'
import Code from '@tiptap/extension-code'
import { CodeBlockWithCopy } from './editor/CodeBlockWithCopy'
import Heading from '@tiptap/extension-heading'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import Blockquote from '@tiptap/extension-blockquote'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import Link from '@tiptap/extension-link'
import { TableKit } from '@tiptap/extension-table'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { findTable, selectionCell, TableMap } from '@tiptap/pm/tables'
import { Markdown } from 'tiptap-markdown'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { EditorApi, EditorCollab, ScrollStore, TableWidths, TreeNode } from './types'
import { ResizableImage } from './ResizableImage'
import { AudioNode, VideoNode, Youtube, YOUTUBE_URL_RE } from './MediaNodes'
import { Database } from './database/Database'
import { DbReferencePicker } from './database/DbReferencePicker'
import { flattenFiles, fuzzyScore, isExternalHref, relativeLinkPath, resolveRelativePath } from './utils/fuzzy'
import { splitFrontmatter, joinFrontmatter, todayDate, type FrontmatterData } from './utils/frontmatter'
import { isSvgMarkup, svgFileName } from './utils/svgPaste'
import { MobileKeyBar, useMobileLayout } from '@mew/mobile-keys'
import { pathFromDrag } from '@mew/ui'
import { FrontmatterPanel } from './editor/FrontmatterPanel'
import { TableTooltip } from './editor/TableTooltip'
import { LinkTooltip } from './editor/LinkTooltip'
import { MentionTooltip, type MentionResult } from './editor/MentionTooltip'
import { SlashMenu, type SlashCommand } from './editor/SlashMenu'
import { ListConversion } from './editor/listConversion'
import { SearchAndReplace } from './editor/searchExtension'
import { docHasTable, readTableWidths, tableWidthsTransaction } from './editor/tableWidths'
import { EditorSearchBar } from './editor/EditorSearchBar'
import './editor/editor.css'

export interface EditorHandle {
  scrollToHeading: (index: number) => void
  /** frontmatter+본문 전체를 통째로 교체 — collab 방이 있으면 그 Y.XmlFragment도 정상적인 로컬
   * 트랜잭션으로 갱신되어(ySyncPlugin이 가로챔) 다른 세션에도 그대로 반영된다. 되돌리기(revert)용. */
  setRawContent: (content: string) => void
  /** 현재 선택된 텍스트 — 선택이 없으면 null (터미널/에이전트로 선택 텍스트를 보내는 단축키용) */
  getSelectedText: () => string | null
  /** 문서 내 찾기 바를 연다 — seedQuery가 있으면 그 검색어로 채우고 첫 매치로 이동 (프로젝트 검색 연동용) */
  openSearch: (seedQuery?: string) => void
}

// Collaboration.configure()의 field 기본값과 맞춰야 시딩 시 같은 Y.XmlFragment를 본다
const COLLAB_FIELD = 'default'

// y-tiptap의 yUndoPlugin은 로컬 PM 편집을 전부 origin=ySyncPluginKey인 Y 트랜잭션으로 감싸서
// undo 스택에 올린다 (trackedOrigins 기본값이 ySyncPluginKey만 포함). Yjs는 이미 진행 중인
// 트랜잭션 안에서 transact()가 다시 호출되면 새 origin을 무시하고 기존 트랜잭션을 그대로 쓰므로,
// 초기 시딩(setContent)을 이 origin으로 감싸면 undo 스택에 올라가지 않는 "무시된" 편집이 된다 —
// 그렇지 않으면 시딩된 본문 전체가 사용자의 첫 undo 몇 번 만에 통째로 사라질 수 있다
const SEED_ORIGIN = Symbol('editor-seed')

function markdownForAsset(url: string, name: string, mimetype: string): string {
  const alt = name.replace(/\.[^.]+$/, '')
  if (mimetype.startsWith('image/')) return `![${alt}](${url})`
  if (mimetype.startsWith('audio/')) return `<audio src="${url}" controls></audio>`
  if (mimetype.startsWith('video/')) return `<video src="${url}" controls></video>`
  return `[${name}](${url})`
}

// paste로 붙일 수 없는 파일 타입용 — 항상 순수 링크로 삽입 (/upload 커맨드 전용)
function markdownForLink(url: string, name: string): string {
  return `[${name}](${url})`
}

function isPasteableMedia(mimetype: string): boolean {
  return mimetype.startsWith('image/') || mimetype.startsWith('audio/') || mimetype.startsWith('video/')
}

// updated는 필드가 이미 있을 때만 오늘 날짜로 갱신한다 — 없으면(사용자가 지웠으면) 되살리지 않는다.
// desc는 자동으로 채우지 않는다 — 작성자(사람·AI)가 직접 쓰는 필드다.
function bumpUpdated(frontmatter: FrontmatterData): FrontmatterData {
  const today = todayDate()
  const idx = frontmatter.fields.findIndex((f) => f.key === 'updated')
  if (idx === -1 || frontmatter.fields[idx].value === today) return frontmatter
  return { ...frontmatter, fields: frontmatter.fields.map((f, i) => (i === idx ? { ...f, value: today } : f)) }
}

function isListNode(node: PMNode): boolean {
  return node.type.name === 'bulletList' || node.type.name === 'orderedList'
}

/** 저장된 표 열 너비를 현재 문서에 입힌다 — 자세한 규칙은 editor/tableWidths.ts */
function applyTableWidths(editor: TiptapEditor, widths: TableWidths): void {
  const tr = tableWidthsTransaction(editor.state, widths)
  if (tr) editor.view.dispatch(tr)
}

// Tab 중첩 — sinkListItem은 "같은 리스트 안"에서만 동작해서, 앞줄이 다른 형태의 리스트일 때
// (불렛줄 다음 숫자줄, 리스트 다음 코드블럭 등)는 중첩이 안 된다. 그런 경우 현재 블록(숫자리스트
// 전체·코드블록 등)을 통째로 "바로 앞 형제 리스트"의 마지막 항목 안으로 옮겨 중첩시킨다.
// 옮길 수 없는 상황이면 false를 돌려 기본 처리(줄 앞 \t)로 넘긴다.
function nestBlockIntoPrevList(editor: TiptapEditor): boolean {
  const { state } = editor
  const { $from, $to } = state.selection
  for (let d = $from.depth; d >= 1; d--) {
    const index = $from.index(d - 1)
    if (index === 0) continue
    const parent = $from.node(d - 1)
    const prev = parent.child(index - 1)
    if (!isListNode(prev)) continue

    const blockBefore = $from.before(d) // == prev(리스트)의 after
    const blockAfter = $from.after(d)
    if ($to.pos > blockAfter) return false // 선택이 이 블록을 벗어나면 건드리지 않는다

    // prev 리스트의 마지막 항목 content 끝: prev.after==blockBefore, 리스트 close 1 + 마지막 li close 1
    const insertPos = blockBefore - 2
    if (insertPos <= 0) return false
    const content = state.doc.slice(blockBefore, blockAfter).content
    const tr = state.tr
    tr.delete(blockBefore, blockAfter)
    tr.insert(insertPos, content) // insertPos < blockBefore 라 삭제 영향 없음
    const newPos = insertPos + ($from.pos - blockBefore)
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(Math.max(newPos, 1), tr.doc.content.size))))
    editor.view.dispatch(tr.scrollIntoView())
    return true
  }
  return false
}

// Alt+Backspace — 현재 리스트 줄(항목)을 통째로 지운다. 그 항목에 하위 항목이 딸려 있으면
// 바로 앞 형제 항목의 끝으로 흡수시켜 나머지를 자연스럽게 당긴다 (독스 예시의 동작). 앞 형제가
// 없으면 하위 리스트 항목들을 이 항목 자리로 한 단계 승격시킨다.
function deleteListLine(editor: TiptapEditor): boolean {
  const { state } = editor
  const { $from } = state.selection
  let liDepth = -1
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'listItem') {
      liDepth = d
      break
    }
  }
  if (liDepth === -1) return false

  const li = $from.node(liDepth)
  const liBefore = $from.before(liDepth)
  const liAfter = $from.after(liDepth)
  const liIndex = $from.index(liDepth - 1)
  const first = li.firstChild
  const paraSize = first ? first.nodeSize : 0
  const restStart = liBefore + 1 + paraSize
  const restEnd = liAfter - 1
  const hasRest = restEnd > restStart

  const tr = state.tr
  if (!hasRest) {
    tr.delete(liBefore, liAfter)
  } else if (liIndex > 0) {
    // 하위 블록을 이전 형제 항목(block* content)의 끝으로 흡수 — liBefore-1 == 이전 항목 content 끝
    const content = state.doc.slice(restStart, restEnd).content
    tr.delete(liBefore, liAfter)
    tr.insert(liBefore - 1, content)
  } else {
    // 앞 형제가 없으면 하위 리스트의 항목들만 승격 (부모 리스트엔 listItem만 넣을 수 있으므로)
    let items = Fragment.empty
    let ok = true
    state.doc.slice(restStart, restEnd).content.forEach((child) => {
      if (isListNode(child)) items = items.append(child.content)
      else ok = false
    })
    if (!ok) return false
    tr.delete(liBefore, liAfter)
    tr.insert(liBefore, items)
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.mapping.map(liBefore), tr.doc.content.size))))
  editor.view.dispatch(tr.scrollIntoView())
  return true
}

// 2벌식 한글 낱자 → QWERTY 글쇠 위치. 모바일에서 한글 IME가 켜진 채로 보조키바의 Ctrl을 켜고
// 단축키 글쇠(예: undo=z 자리)를 누르면 실제로 들어오는 값은 'ㅋ' 같은 호환 자모라, 그걸 원래
// 영문 글쇠로 되돌려 단축키를 매핑한다 (쌍자음·이중모음은 shift 위치의 같은 글쇠로 묶는다).
const KO_JAMO_TO_QWERTY: Record<string, string> = {
  ㅂ: 'q', ㅈ: 'w', ㄷ: 'e', ㄱ: 'r', ㅅ: 't', ㅛ: 'y', ㅕ: 'u', ㅑ: 'i', ㅐ: 'o', ㅔ: 'p',
  ㅁ: 'a', ㄴ: 's', ㅇ: 'd', ㄹ: 'f', ㅎ: 'g', ㅗ: 'h', ㅓ: 'j', ㅏ: 'k', ㅣ: 'l',
  ㅋ: 'z', ㅌ: 'x', ㅊ: 'c', ㅍ: 'v', ㅠ: 'b', ㅜ: 'n', ㅡ: 'm',
  ㅃ: 'q', ㅉ: 'w', ㄸ: 'e', ㄲ: 'r', ㅆ: 't', ㅒ: 'o', ㅖ: 'p',
}

// beforeinput으로 들어오려던 글자를 단축키용 영문 소문자 한 글자로 환원한다 (영문/한글자모 지원).
// 단축키 대상이 아니면 null.
function toShortcutLetter(data: string): string | null {
  if (data.length !== 1) return null
  if (/[a-zA-Z]/.test(data)) return data.toLowerCase()
  return KO_JAMO_TO_QWERTY[data] ?? null
}

export const Editor = forwardRef<
  EditorHandle,
  {
    value: string
    onChange: (value: string) => void
    /** 호스트 앱의 서버 연동 — 렌더 간 identity가 안정적인 객체를 넘길 것 */
    api: EditorApi
    readOnly?: boolean
    path?: string
    tree?: TreeNode[]
    onOpenLink?: (path: string) => void
    /** 있으면 이 방의 Y.XmlFragment가 본문의 진실 원천이 된다 — value/onChange는 그 결과를 반영만 한다 */
    collab?: EditorCollab | null
    /** 문서별 스크롤 위치 저장소 — 있으면 파일 전환·복귀 시 마지막으로 보던 자리로 되돌린다 */
    scrollStore?: ScrollStore
  }
>(function Editor({ value, onChange, api, readOnly, path = '', tree = [], onOpenLink, collab, scrollStore }, ref) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(value), [value])
  function handleFrontmatterChange(next: FrontmatterData) {
    onChange(joinFrontmatter(next, body))
  }
  const containerRef = useRef<HTMLDivElement>(null)
  // 스크롤 위치 저장·복원용 — pathRef는 스크롤 리스너가 항상 현재 문서 키를 참조하도록,
  // restoredRef는 문서마다 "복원을 마쳤는지"를 표시해 복원 전 스크롤을 저장으로 오인하지 않게 한다
  const pathRef = useRef(path)
  const restoredRef = useRef(false)
  // 표 열 너비 동기화 상태 — 어느 문서의 것인지(path), 서버에서 받은 값(baseline), 복원을 마쳤는지.
  // 복원 전에는 절대 저장하지 않는다 — 시딩 직후의 "너비 없음"을 저장해 원래 값을 지워버리기 때문.
  const tableSyncRef = useRef<{ path: string; baseline: string; restored: boolean } | null>(null)
  const [tableWidths, setTableWidths] = useState<TableWidths | null>(null)
  // useEditor의 editorProps는 deps 배열이 바뀌는 순간의 렌더에서 클로저가 그대로 얼어붙는다
  // (@tiptap/react의 EditorInstanceManager가 그 시점 options.current만 읽고 이후 갱신을 반영 안 함).
  // collab이 생기며 에디터가 재생성될 때 handleKeyDown이 그 직전(곧 destroy될) editor를 계속
  // 가리키게 되므로, editor.commands 등은 이 ref로 항상 최신 인스턴스를 참조해야 한다
  const editorRef = useRef<TiptapEditor | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadPosRef = useRef<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{
    show: boolean
    position: { top: number; left: number }
    mode: 'add' | 'remove'
  } | null>(null)
  const [linkTooltip, setLinkTooltip] = useState<{
    mode: 'view' | 'edit'
    position: { top: number; left: number }
    href: string
    text: string
    range: { from: number; to: number }
  } | null>(null)
  const [mention, setMention] = useState<{
    from: number
    query: string
    position: { top: number; left: number }
    selectedIndex: number
  } | null>(null)
  // 슬래시(/) 커맨드 메뉴 — from은 '/'의 위치, query는 그 뒤에 입력된 검색어
  const [slash, setSlash] = useState<{
    from: number
    query: string
    position: { top: number; left: number }
    selectedIndex: number
  } | null>(null)
  const [editorFocused, setEditorFocused] = useState(false)
  // /db 참조 커맨드로 여는 데이터베이스 선택 모달 — pos는 삽입 위치(문서 좌표)
  const [dbPicker, setDbPicker] = useState<{ pos: number } | null>(null)
  const [keyBarCtrl, setKeyBarCtrl] = useState(false)
  const [keyBarShift, setKeyBarShift] = useState(false)
  // Ctrl+F 찾기 바 — seed는 열 때 미리 채울 검색어, nonce는 이미 열려 있어도 새 seed로 다시 실행시키는 신호
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchSeed, setSearchSeed] = useState<{ q?: string; n: number }>({ n: 0 })
  const mobileLayout = useMobileLayout()

  // 외부(프로젝트 검색 등)에서도 찾기 바를 열 수 있게 하는 헬퍼 — imperative handle과 아래 keydown이 공유
  const openSearchBar = useCallback((seedQuery?: string) => {
    setSearchSeed((prev) => ({ q: seedQuery, n: prev.n + 1 }))
    setSearchOpen(true)
  }, [])

  // editorProps 핸들러(handleKeyDown·handlePaste 등)는 에디터 생성 시점의 클로저에 얼어붙는다 —
  // deps 배열이 비어있지 않아(collab.ydoc) @tiptap/react가 이후 렌더에서 setOptions로 갱신하지 않기
  // 때문이다(위 editorRef 선언부 주석 참고). 그래서 핸들러가 slash·mention·tooltip 같은 React
  // 상태나 그때그때 계산되는 결과·콜백을 직접 읽으면 항상 "생성 당시"의 낡은 값(대부분 null·빈배열)을
  // 본다 — 슬래시 메뉴에서 Enter를 눌러도 커맨드가 아니라 개행이 되던 원인이다. 아래 ref들로 최신
  // 값을 참조해 키보드 내비게이션(슬래시·멘션·표 툴팁)이 정상 동작하게 한다. 렌더마다 아래
  // "핸들러가 참조하는 ref 동기화" 블록에서 갱신한다.
  const slashRef = useRef<typeof slash>(null)
  const mentionRef = useRef<typeof mention>(null)
  const tooltipRef = useRef<typeof tooltip>(null)
  const slashResultsRef = useRef<SlashCommand[]>([])
  const mentionResultsRef = useRef<MentionResult[]>([])
  const runSlashCommandRef = useRef<(command: SlashCommand) => void>(() => {})
  const selectMentionRef = useRef<(result: MentionResult) => void>(() => {})
  const readOnlyRef = useRef(readOnly)
  // 보조키바 Ctrl/Shift 토글 — beforeinput 리스너가 매 렌더 재등록 없이 최신 값을 읽도록 ref로도 둔다
  const keyBarCtrlRef = useRef(keyBarCtrl)
  const keyBarShiftRef = useRef(keyBarShift)

  const editor = useEditor({
    extensions: [
      Document,
      Text,
      Paragraph,
      // StarterKit이 기본 제공하는 확장 중 아래에서 개별 등록·설정하는 것들은 전부 꺼야 한다.
      // 켠 채로 같은 이름을 또 등록하면 tiptap이 "Duplicate extension names found"를 경고하고,
      // 플러그인이 두 벌 돌아간다 — 특히 Link는 StarterKit 기본값(openOnClick: true)이 함께
      // 살아 있어 링크 클릭이 새 탭으로 새고, ListItem은 내부 listItemBranchingDeleteKeymap까지
      // 중복돼 Delete 키가 두 번 처리된다.
      StarterKit.configure({
        document: false,
        text: false,
        paragraph: false,
        // codeBlock은 복사 버튼을 붙인 CodeBlockWithCopy로 따로 등록한다
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
        // collab 모드에서는 Collaboration 확장의 Yjs 인지 undo/redo를 쓴다 — 기본 history()와
        // 같이 두면 서로의 undo 스택이 충돌한다 (tiptap 자체 경고 대상)
        ...(collab ? { undoRedo: false } : {}),
      }),
      Bold,
      Italic,
      Strike,
      Code,
      CodeBlockWithCopy.configure({ HTMLAttributes: { class: 'code-block' } }),
      Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      BulletList,
      OrderedList,
      ListItem,
      // 이미 리스트 항목 안에서 `- `/`1. `를 치면 그 줄만 반대 타입으로 변환한다 (기본 규칙은 중첩만 함)
      ListConversion,
      // Ctrl+F 문서 내 찾기·바꾸기 (정규식·대소문자) — 매치를 데코레이션으로 하이라이트
      SearchAndReplace,
      Blockquote,
      HorizontalRule,
      // target: null — Chromium/Brave는 contenteditable 안의 target="_blank" 링크를 클릭하면
      // preventDefault()를 호출해도 새 탭을 강제로 연다 (Ctrl+Click 여부 무관). 속성 자체를 없애야 함.
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-link underline', target: null, rel: null } }),
      // allowTableNodeSelection: 테이블 NodeSelection이 CellSelection으로 강제 변환되지 않게 함 (테두리 클릭 선택용)
      // resizable: 세로선(열 너비) 드래그 조절만 지원 — prosemirror-tables는 행 높이 조절 기능이 없음
      TableKit.configure({ table: { allowTableNodeSelection: true, resizable: true } }),
      ResizableImage,
      AudioNode,
      VideoNode,
      Youtube,
      // /db 데이터베이스 노드 — api를 주입해 노드뷰가 서버(Postgres)와 실시간으로 연동한다
      Database.configure({ api }),
      Placeholder.configure({ placeholder: '노션처럼 작성하세요... # 으로 제목, - 으로 목록' }),
      Markdown.configure({
        transformCopiedText: true,
        transformPastedText: true,
      }),
      // 방을 처음 만든 클라이언트가 이미 로드해 둔 탭 내용으로 fragment를 시딩하는 건 아래
      // useEffect가 담당한다 — 여기 content는 collab이 없을 때만 유효한 초기값
      ...(collab
        ? [
            Collaboration.configure({ document: collab.ydoc, field: COLLAB_FIELD }),
            CollaborationCaret.configure({
              provider: { awareness: collab.awareness },
              user: collab.awareness.getLocalState()?.user ?? { name: '?', color: '#94a3b8' },
            }),
          ]
        : []),
    ],
    // collab 모드에서는 ySyncPlugin이 마운트 즉시 문서를 fragment 내용으로 강제 교체한다
    // (fragment가 비어 있으면 빈 문서로). body를 그대로 넘기면 그 교체가 "진짜 편집"으로
    // onUpdate에 잡혀 방금 불러온 실제 내용을 onChange('')로 덮어써 버린다 — CodePane과
    // 동일하게 collab일 때는 빈 값으로 시작하고, 실제 시딩은 아래 별도 effect가 담당한다
    content: collab ? '' : body,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const markdownInstance = (editor.storage as any).markdown
      const markdown = markdownInstance ? markdownInstance.getMarkdown() : ''
      if (markdown !== undefined) {
        if (frontmatter) {
          onChange(joinFrontmatter(bumpUpdated(frontmatter), markdown))
        } else {
          onChange(markdown)
        }
      }
      updateMentionState(editor)
      updateSlashState(editor)
    },
    onFocus: () => setEditorFocused(true),
    onBlur: () => setEditorFocused(false),
    onSelectionUpdate: ({ editor }) => {
      updateMentionState(editor)
      updateSlashState(editor)
    },
    editorProps: {
      handleClick: (view, _pos, event) => {
        if (readOnlyRef.current) return false
        const target = event.target as HTMLElement
        if (!(target instanceof HTMLElement)) return false

        // 코드블럭 왼쪽 여백(거터)을 클릭하면 블럭 전체를 NodeSelection으로 선택한다.
        // 이 상태로 복사해야 ``` 펜스까지 포함된다 — 코드 텍스트(<code>) 안 클릭은 커서만 이동.
        const codeWrap = target.closest('.code-block-wrap') as HTMLElement | null
        if (codeWrap && !target.closest('code') && !target.closest('.code-block-copy')) {
          const rect = codeWrap.getBoundingClientRect()
          const GUTTER = 12
          if (event.clientX - rect.left <= GUTTER) {
            try {
              const codeEl = codeWrap.querySelector('code')
              if (codeEl) {
                const inside = view.posAtDOM(codeEl, 0)
                const $pos = view.state.doc.resolve(inside)
                for (let d = $pos.depth; d > 0; d--) {
                  if ($pos.node(d).type.name === 'codeBlock') {
                    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, $pos.before(d))))
                    return true
                  }
                }
              }
            } catch {
              return false
            }
          }
        }

        const tableEl = target.classList.contains('tableWrapper')
          ? target.querySelector('table')
          : target.closest('table')
        if (!tableEl) return false

        // 테이블 바깥 테두리 근처 클릭이면 테이블 전체 선택 (복사/잘라내기/삭제 가능)
        const rect = tableEl.getBoundingClientRect()
        const EDGE = 6
        const nearEdge =
          Math.abs(event.clientX - rect.left) <= EDGE ||
          Math.abs(event.clientX - rect.right) <= EDGE ||
          Math.abs(event.clientY - rect.top) <= EDGE ||
          Math.abs(event.clientY - rect.bottom) <= EDGE
        if (!nearEdge && target.tagName !== 'TABLE') return false

        try {
          const inside = view.posAtDOM(tableEl, 0)
          const $pos = view.state.doc.resolve(inside)
          for (let d = $pos.depth; d > 0; d--) {
            if ($pos.node(d).type.name === 'table') {
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, $pos.before(d))))
              return true
            }
          }
        } catch {
          return false
        }
        return false
      },
      handleKeyDown: (_view, event) => {
        // editorRef로 최신 인스턴스를 가리키는 이유는 위 editorRef 선언부 주석 참고 —
        // 아래 코드는 전부 이 지역 변수 editor를 참조하므로 나머지는 그대로 둔다
        const editor = editorRef.current

        // undo/redo는 스택이 비어 있으면 tiptap 커맨드가 false를 반환하는데, prosemirror-keymap은
        // 그럴 때 preventDefault를 안 해서 브라우저 네이티브 undo/redo가 대신 실행돼 버린다.
        // 그 네이티브 편집은 PM의 MutationObserver에 "진짜 로컬 편집"으로 잡혀 문서를 지우거나
        // redo 스택을 오염시킨다 — 성공 여부와 무관하게 여기서 항상 막는다.
        if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 'z' || event.key === 'Z' || event.key === 'y' || event.key === 'Y')) {
          event.preventDefault()
          if (editor) {
            if (event.key === 'y' || event.key === 'Y' || (event.shiftKey && (event.key === 'z' || event.key === 'Z'))) {
              editor.commands.redo()
            } else {
              editor.commands.undo()
            }
          }
          return true
        }

        // Alt+Backspace: 리스트 줄이면 그 줄(항목)만 통째로 지우고 하위 항목은 앞 항목으로 흡수
        // (기본 단어 삭제 대신). 리스트가 아니면 false로 넘겨 브라우저 기본 단어 삭제를 살린다.
        if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'Backspace') {
          if (editor && editor.isActive('listItem') && deleteListLine(editor)) {
            event.preventDefault()
            return true
          }
        }

        // @ 멘션 팝업이 열려있을 때 키보드 내비게이션 (상태·결과·콜백은 ref로 — 위 ref 동기화 주석 참고)
        if (mentionRef.current) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            setMention((m) =>
              m ? { ...m, selectedIndex: Math.min(m.selectedIndex + 1, Math.max(mentionResultsRef.current.length - 1, 0)) } : m,
            )
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            setMention((m) => (m ? { ...m, selectedIndex: Math.max(m.selectedIndex - 1, 0) } : m))
            return true
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            const result = mentionResultsRef.current[mentionRef.current.selectedIndex]
            if (result) selectMentionRef.current(result)
            else setMention(null)
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setMention(null)
            return true
          }
        }

        // 슬래시(/) 커맨드 메뉴가 열려있을 때 키보드 내비게이션 (선택은 탭으로도 가능 — 모바일)
        if (slashRef.current) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            setSlash((s) =>
              s ? { ...s, selectedIndex: Math.min(s.selectedIndex + 1, Math.max(slashResultsRef.current.length - 1, 0)) } : s,
            )
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            setSlash((s) => (s ? { ...s, selectedIndex: Math.max(s.selectedIndex - 1, 0) } : s))
            return true
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            const command = slashResultsRef.current[slashRef.current.selectedIndex]
            if (command) runSlashCommandRef.current(command)
            else setSlash(null)
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setSlash(null)
            return true
          }
        }

        // Tab 키 처리: 리스트 중첩/내어쓰기 + 그 외엔 줄 맨 앞 \t 들여쓰기.
        // 실제 로직은 applyEditorTab로 빼서 모바일 보조키바의 Tab 버튼과 공유한다.
        if (event.key === 'Tab') {
          event.preventDefault()
          applyEditorTab(event.shiftKey)
          return true
        }

        // 테이블 관련 키보드 처리
        if (!readOnlyRef.current && editor) {
          const state = editor.state
          const { from } = state.selection
          const doc = state.doc

          // 현재 위치의 노드 확인 (테이블 셀인지)
          let inTable = false
          for (let i = from; i >= 0; i--) {
            const node = doc.nodeAt(i)
            if (node && node.type.name === 'table') {
              inTable = true
              break
            }
            if (i === 0) break
          }

          // Ctrl+Enter: 현재 셀이 속한 행 바로 아래에 새 행 추가, 새 행의 첫 번째 셀(가장 왼쪽)로 포커스 이동
          if (event.ctrlKey && event.key === 'Enter' && inTable) {
            event.preventDefault()
            event.stopPropagation()
            const $cell = selectionCell(state)
            const table = findTable($cell)
            if (table) {
              const map = TableMap.get(table.node)
              const targetRow = map.findCell($cell.pos - table.start).bottom
              editor.chain().focus().addRowAfter().run()
              const newTable = findTable(editor.state.selection.$from)
              if (newTable) {
                const newMap = TableMap.get(newTable.node)
                const cellPos = newTable.start + newMap.positionAt(targetRow, 0, newTable.node)
                const nextSelection = TextSelection.near(editor.state.doc.resolve(cellPos + 1))
                editor.view.dispatch(editor.state.tr.setSelection(nextSelection))
              }
            }
            return true
          }

          // Insert 키 또는 Ctrl+Shift+'=' 키 (추가 모드 툴팁)
          if ((event.key === 'Insert' || (event.ctrlKey && event.shiftKey && event.key === '=')) && inTable) {
            event.preventDefault()
            event.stopPropagation()

            // 커서(텍스트 포커스) 위치의 viewport 좌표 (툴팁은 fixed 포지셔닝)
            const coords = _view.coordsAtPos(from)
            const tooltipPos = {
              top: (coords.top + coords.bottom) / 2,
              left: coords.left,
            }
            setTooltip({ show: true, position: tooltipPos, mode: 'add' })
            return true
          }

          // Ctrl+Shift+D 키 (제거 모드 툴팁)
          if (event.ctrlKey && event.shiftKey && event.key === 'D' && inTable) {
            event.preventDefault()
            event.stopPropagation()

            // 커서(텍스트 포커스) 위치의 viewport 좌표 (툴팁은 fixed 포지셔닝)
            const coords = _view.coordsAtPos(from)
            const tooltipPos = {
              top: (coords.top + coords.bottom) / 2,
              left: coords.left,
            }
            setTooltip({ show: true, position: tooltipPos, mode: 'remove' })
            return true
          }

          // 툴팁이 열려있을 때 방향키 처리 (실행 후 툴팁 닫힘)
          if (tooltipRef.current?.show) {
            const arrowCommands: Record<string, (() => void) | undefined> =
              tooltipRef.current.mode === 'add'
                ? {
                    ArrowUp: () => editor.chain().focus().addRowBefore().run(),
                    ArrowDown: () => editor.chain().focus().addRowAfter().run(),
                    ArrowLeft: () => editor.chain().focus().addColumnBefore().run(),
                    ArrowRight: () => editor.chain().focus().addColumnAfter().run(),
                  }
                : {
                    ArrowUp: () => editor.chain().focus().deleteRow().run(),
                    ArrowDown: () => editor.chain().focus().deleteRow().run(),
                    ArrowLeft: () => editor.chain().focus().deleteColumn().run(),
                    ArrowRight: () => editor.chain().focus().deleteColumn().run(),
                  }
            const run = arrowCommands[event.key]
            if (run) {
              event.preventDefault()
              event.stopPropagation()
              run()
              setTooltip(null)
              return true
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setTooltip(null)
              return true
            }
          }
        }

        // 링크 툴팁 열기 (Ctrl+K) — 텍스트를 선택했거나 커서가 기존 링크 위일 때
        if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
          event.preventDefault()
          if (!readOnlyRef.current && editor) {
            // 커서가 기존 링크 위에 있을 뿐 선택 범위가 없으면 링크 전체로 확장
            editor.chain().extendMarkRange('link').run()
            const { empty, from, to } = editor.state.selection
            const href = editor.getAttributes('link').href ?? ''
            if (!empty || href) {
              const text = editor.state.doc.textBetween(from, to, ' ')
              const coords = _view.coordsAtPos(from)
              setLinkTooltip({
                mode: 'edit',
                position: { top: coords.bottom + 6, left: coords.left },
                href,
                text,
                range: { from, to },
              })
            }
          }
          return true
        }

        return false
      },
      handlePaste: (_view, event) => {
        if (readOnlyRef.current) return false
        // editorRef로 최신 인스턴스를 가리키는 이유는 위 editorRef 선언부 주석 참고
        const editor = editorRef.current
        const dt = event.clipboardData
        if (!dt) return false

        // 유튜브 링크를 통째로 붙여넣으면 임베드로 변환
        const text = dt.getData('text/plain')?.trim()
        if (text) {
          const match = YOUTUBE_URL_RE.exec(text)
          if (match) {
            event.preventDefault()
            event.stopPropagation()
            editor?.chain().focus().insertContent({ type: 'youtube', attrs: { videoId: match[1] } }).run()
            return true
          }

          // SVG 소스를 통째로 붙여넣으면(피그마 "Copy as SVG" 등) .svg 파일로 만들어 이미지 파일을
          // 붙여넣은 것과 똑같이 업로드한다 — 인라인 <svg>로 두면 저장 시 통째로 사라진다(svgPaste.ts).
          // 코드블록 안에서는 SVG 코드 자체가 목적이므로 변환하지 않는다.
          if (isSvgMarkup(text) && !editor?.isActive('codeBlock')) {
            event.preventDefault()
            event.stopPropagation()
            const file = new File([text], svgFileName(text), { type: 'image/svg+xml' })
            // ProseMirror의 이벤트 처리가 끝난 뒤로 미룬다 (아래 파일 붙여넣기와 같은 이유)
            setTimeout(() => insertUpload(file), 0)
            return true
          }
        }

        for (let i = 0; i < dt.items.length; i++) {
          const item = dt.items[i]
          if (item.kind !== 'file' || !isPasteableMedia(item.type)) continue
          event.preventDefault()
          // Prevent the container-level onPaste fallback from uploading again
          event.stopPropagation()
          const file = item.getAsFile()
          if (file) {
            // Defer to after ProseMirror finishes event handling
            setTimeout(() => insertUpload(file), 0)
          }
          return true
        }
        return false
      },
      handleDrop: (view, event) => {
        if (readOnlyRef.current) return false
        const dt = event.dataTransfer
        if (!dt) return false
        // 사이드바에서 끌어온 파일 항목 — 놓은 자리에 그 파일의 프로젝트 상대경로를 글자 그대로 적는다.
        // 전용 MIME이 있을 때만 가로챈다 (바깥에서 끌어온 텍스트·이미지는 아래 원래 경로로)
        const draggedPath = pathFromDrag(dt)
        if (draggedPath) {
          event.preventDefault()
          event.stopPropagation()
          const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          // ProseMirror가 이 이벤트 처리를 마친 뒤로 미룬다 (아래 업로드와 같은 이유)
          setTimeout(() => insertPathText(draggedPath, dropPos), 0)
          return true
        }
        if (!dt.files || dt.files.length === 0) return false
        const file = dt.files[0]
        event.preventDefault()
        event.stopPropagation()
        // 마우스를 놓은 위치에 정확히 삽입 (기본 커서 위치가 아님)
        const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        setTimeout(() => insertUpload(file, dropPos), 0)
        return true
      },
      handleDOMEvents: {
        // 링크 클릭: 일반 클릭은 보기 툴팁(미리보기·편집 진입), Ctrl/Cmd+클릭은 바로 열기
        // — 내부 문서 상대 경로는 새 탭이 아니라 에디터 내부 탭에서 연다
        mousedown: (view, event) => {
          if (readOnlyRef.current) return false
          const e = event as MouseEvent
          const target = e.target as HTMLElement | null
          if (!(target instanceof HTMLElement)) return false
          const anchor = target.closest('a')
          if (!anchor || !view.dom.contains(anchor)) return false
          if (!(e.ctrlKey || e.metaKey)) {
            e.preventDefault()
          }
          return false
        },
        // readOnly(뷰어)에서도 동작한다 — 상대 경로 네비게이션(깨진 URL)을 막고 툴팁으로 대체
        click: (view, event) => {
          // editorRef로 최신 인스턴스를 가리키는 이유는 위 editorRef 선언부 주석 참고
          const editor = editorRef.current
          const e = event as MouseEvent
          const target = e.target as HTMLElement | null
          if (!(target instanceof HTMLElement)) return false
          const anchor = target.closest('a')
          if (!anchor || !view.dom.contains(anchor)) return false

          const href = anchor.getAttribute('href') ?? ''
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            if (href) {
              if (isExternalHref(href)) window.open(href, '_blank', 'noopener,noreferrer')
              else onOpenLink?.(resolveRelativePath(path, href))
            }
            return true
          }
          e.preventDefault()
          if (!href || !editor) return true
          try {
            // 클릭한 앵커의 문서 내 범위를 구한다 (편집 모드 전환 시 그대로 사용)
            const inside = Math.min(view.posAtDOM(anchor, 0) + 1, view.state.doc.content.size)
            editor.chain().setTextSelection(inside).extendMarkRange('link').run()
            const { from, to } = editor.state.selection
            const text = editor.state.doc.textBetween(from, to, ' ')
            const rect = anchor.getBoundingClientRect()
            setLinkTooltip({
              mode: 'view',
              position: { top: rect.bottom + 6, left: rect.left },
              href,
              text,
              range: { from, to },
            })
          } catch {
            // posAtDOM 실패 등 — 툴팁 없이 무시
          }
          return true
        },
      },
    },
    // collab.ydoc이 바뀌면(파일 전환으로 새 방에 들어가면) 에디터를 통째로 새로 만든다 —
    // Y.XmlFragment 바인딩은 파일마다 따로 필요해서 tiptap 확장을 런타임에 갈아끼울 수 없다.
    // collab이 없을 때는 undefined 하나뿐인 안정된 배열이라 기존처럼 인스턴스가 유지된다.
  }, [collab?.ydoc])

  // handleKeyDown 안의 editorRef.current를 항상 최신 인스턴스로 유지 (위 editorRef 선언부 주석 참고)
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // 툴팁 닫기 핸들러
  const closeTooltip = useCallback(() => {
    setTooltip(null)
  }, [])

  // 링크 툴팁 닫기 핸들러
  const closeLinkTooltip = useCallback(() => {
    setLinkTooltip(null)
  }, [])

  // 모바일 보조키 바 — 열려 있는 팝업이 있으면 그것만 닫고, 없으면 에디터에서 blur(키보드 닫기)
  function handleKeyBarEsc() {
    if (tooltip || linkTooltip || mention || slash) {
      closeTooltip()
      closeLinkTooltip()
      setMention(null)
      setSlash(null)
      return
    }
    editor?.commands.blur()
  }

  // Tab/Shift-Tab 실제 동작 — keydown 핸들러와 모바일 보조키바가 공유한다. editorRef로 최신
  // 인스턴스를 읽으므로 얼어붙은 클로저 걱정이 없다. 모바일에선 합성 keydown이 신뢰되지 않아
  // ProseMirror 기본 동작이 안 먹는 경우가 있어(특히 Tab), 여기서 직접 트랜잭션을 만든다.
  function applyEditorTab(shift: boolean) {
    const editor = editorRef.current
    if (!editor) return
    const view = editor.view

    // 리스트 항목은 텍스트 앞에 \t를 넣어도 불렛이 안 움직이므로 중첩 리스트로 처리
    if (editor.isActive('listItem')) {
      if (shift) editor.chain().focus().liftListItem('listItem').run()
      else if (editor.can().sinkListItem('listItem')) editor.chain().focus().sinkListItem('listItem').run()
      else nestBlockIntoPrevList(editor) // 앞줄이 다른 형태(불렛↔숫자)면 앞 형제 리스트로 통째 중첩
      return
    }

    // 리스트 밖 코드블록: 앞줄이 리스트면 그 리스트의 마지막 항목 안으로 중첩 (중첩 뒤엔 앞 형제가
    // 본문 줄이라 nest 실패 → 아래 \t로 코드 안 들여쓰기가 된다)
    if (!shift && editor.isActive('codeBlock') && nestBlockIntoPrevList(editor)) return

    const { $from, from } = view.state.selection
    const blockStart = $from.start()
    // 코드블록의 개행·하드브레이크 뒤를 줄 시작으로 취급
    const textBefore = view.state.doc.textBetween(blockStart, from, '\n', '\n')
    const lineStart = blockStart + textBefore.lastIndexOf('\n') + 1
    if (shift) {
      if (view.state.doc.textBetween(lineStart, lineStart + 1) === '\t') {
        view.dispatch(view.state.tr.delete(lineStart, lineStart + 1))
      }
    } else {
      view.dispatch(view.state.tr.insertText('\t', lineStart, lineStart))
    }
  }

  function handleKeyBarTab() {
    editorRef.current?.view.focus()
    applyEditorTab(keyBarShift)
    setKeyBarShift(false)
  }

  // 보조키바 Ctrl을 켜고 글쇠를 누를 때 실행할 에디터 단축키 (undo/redo/굵게/기울임/전체선택).
  // 실제 글쇠 감지는 아래 beforeinput 리스너가 하고, 여기선 커맨드만 실행한다.
  function runCtrlShortcut(letter: string, shift: boolean) {
    const editor = editorRef.current
    if (!editor) return
    switch (letter) {
      case 'z':
        if (shift) editor.commands.redo()
        else editor.commands.undo()
        break
      case 'y':
        editor.commands.redo()
        break
      case 'b':
        editor.chain().focus().toggleBold().run()
        break
      case 'i':
        editor.chain().focus().toggleItalic().run()
        break
      case 'a':
        editor.chain().focus().selectAll().run()
        break
      default:
        break
    }
  }

  // 화살표는 합성 keydown으로 안 됨(브라우저가 신뢰되지 않은 이벤트엔 커서 이동 같은 기본 동작을
  // 수행하지 않음) — Selection.modify로 직접 캐럿을 옮긴다 (Chromium/WebKit 지원, Firefox는 미지원)
  function handleKeyBarArrow(dir: 'up' | 'down' | 'left' | 'right') {
    const sel = window.getSelection() as (Selection & { modify?: (a: string, d: string, g: string) => void }) | null
    const alter = keyBarShift ? 'extend' : 'move'
    if (dir === 'left') sel?.modify?.(alter, 'backward', keyBarCtrl ? 'word' : 'character')
    else if (dir === 'right') sel?.modify?.(alter, 'forward', keyBarCtrl ? 'word' : 'character')
    else if (dir === 'up') sel?.modify?.(alter, 'backward', 'line')
    else sel?.modify?.(alter, 'forward', 'line')
    setKeyBarCtrl(false)
    setKeyBarShift(false)
  }

  // 모바일 보조키바의 Ctrl 단축키 — 온스크린 키보드로 친 글자는 keydown이 아니라 beforeinput
  // (insertText/insertCompositionText)으로 들어와 ctrlKey가 실리지 않는다. Ctrl 토글이 켜져 있으면
  // 그 입력을 가로채 글자 삽입을 막고, 글쇠를 단축키로 실행한다 (한글 자모는 QWERTY 위치로 환원).
  // editor가 재생성될 때만 재등록하고, 토글 상태는 ref로 읽어 매 토글마다 재등록하지 않는다.
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    const onBeforeInput = (e: Event) => {
      if (!keyBarCtrlRef.current) return
      const ie = e as InputEvent
      if (ie.inputType !== 'insertText' && ie.inputType !== 'insertCompositionText') return
      const letter = toShortcutLetter(ie.data ?? '')
      if (!letter) return
      e.preventDefault()
      runCtrlShortcut(letter, keyBarShiftRef.current)
      setKeyBarCtrl(false)
      setKeyBarShift(false)
    }
    dom.addEventListener('beforeinput', onBeforeInput)
    return () => dom.removeEventListener('beforeinput', onBeforeInput)
  }, [editor])

  // 툴팁 클릭 방지
  useEffect(() => {
    const handleClick = () => setTooltip(null)
    if (tooltip?.show) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [tooltip])

  // 커서 바로 앞의 "@query" 패턴을 감지해 멘션 팝업 상태를 갱신
  const updateMentionState = useCallback((ed: any) => {
    const { $from, empty } = ed.state.selection
    if (!empty) {
      setMention(null)
      return
    }
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    const match = /(?:^|\s)@([^\s@]*)$/.exec(textBefore)
    if (!match) {
      setMention(null)
      return
    }
    const query = match[1]
    const from = $from.start() + $from.parentOffset - query.length - 1
    const coords = ed.view.coordsAtPos(from)
    setMention((prev) =>
      prev && prev.from === from && prev.query === query
        ? prev
        : { from, query, position: { top: coords.bottom + 6, left: coords.left }, selectedIndex: 0 },
    )
  }, [])

  const mentionResults = useMemo<MentionResult[]>(() => {
    if (!mention) return []
    return flattenFiles(tree)
      .map((p) => ({ path: p, score: fuzzyScore(mention.query, p) }))
      .filter((r): r is { path: string; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 8)
      .map((r) => ({ path: r.path, label: r.path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? r.path }))
  }, [tree, mention])

  const selectMention = useCallback(
    (result: MentionResult) => {
      if (!mention || !editor) return
      const { from } = mention
      const to = from + 1 + mention.query.length
      const href = relativeLinkPath(path, result.path)
      setMention(null)
      // 내부 링크의 표시 텍스트는 대상 문서의 title — 파일명은 title을 못 읽을 때의 폴백
      api.fetchFile(result.path)
        .then(({ content }) => splitFrontmatter(content).frontmatter?.title || result.label)
        .catch(() => result.label)
        .then((label) => {
          editor.chain().focus().deleteRange({ from, to }).insertContent(`[${label}](${href}) `).run()
        })
    },
    [mention, editor, path, api],
  )

  // 커서 바로 앞의 "/query" 패턴을 감지해 슬래시 커맨드 메뉴 상태를 갱신 (노션식) —
  // '/'는 줄 시작이나 공백 뒤에서만 인식하므로 URL·경로(docs/foo) 안에서는 뜨지 않는다.
  const updateSlashState = useCallback((ed: any) => {
    const { $from, empty } = ed.state.selection
    if (!empty) {
      setSlash(null)
      return
    }
    const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
    const match = /(?:^|\s)\/([^\s/]*)$/.exec(textBefore)
    if (!match) {
      setSlash(null)
      return
    }
    const query = match[1]
    const from = $from.start() + $from.parentOffset - query.length - 1
    const coords = ed.view.coordsAtPos(from)
    setSlash((prev) =>
      prev && prev.from === from && prev.query === query
        ? prev
        : { from, query, position: { top: coords.bottom + 6, left: coords.left }, selectedIndex: 0 },
    )
  }, [])

  // 슬래시 커맨드 목록 — run은 항상 최신 에디터(editorRef)를 받고, 메뉴 텍스트(/query)는 range로 넘겨 미리 지운다.
  // openUploadPicker는 refs만 읽는 안정 참조라 매 렌더 재생성돼도 문제없다.
  // 슬래시 커맨드는 데이터·삽입 관련 4개만 노출한다 (제목·목록·인용 등 글 형식은 마크다운
  // 단축어 `#`·`-`·`1.`·```` ``` ````로 그대로 쓸 수 있으므로 메뉴에서 뺐다).
  const slashCommands: SlashCommand[] = [
    { id: 'db', title: '데이터베이스', description: '노션식 표 데이터베이스 (실시간 협업)', keywords: ['db', 'database', '데이터베이스', 'notion', '노션'], run: (e, r) => { e.chain().focus().deleteRange(r).run(); insertDatabase(r.from) } },
    { id: 'db-ref', title: '데이터베이스 참조', description: '기존 데이터베이스를 읽기 전용 뷰로 삽입', keywords: ['ref', 'reference', '참조', 'link', 'linked', 'db참조', 'db-ref', 'database', '데이터베이스'], run: (e, r) => { e.chain().focus().deleteRange(r).run(); setDbPicker({ pos: r.from }) } },
    { id: 'table', title: '표', description: '3×3 표 삽입', keywords: ['table', '표', '테이블'], run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3 }).run() },
    { id: 'upload', title: '파일 업로드', description: '파일을 올리고 링크 삽입 (R2)', keywords: ['upload', '업로드', 'file', '파일', '첨부', 'attach'], run: (e, r) => { e.chain().focus().deleteRange(r).run(); openUploadPicker(r.from) } },
  ]

  // query를 title·keywords에 퍼지 매칭해 실시간 필터 (빈 query면 전체) — 목록이 작아 매 렌더 계산해도 무방
  const slashResults: SlashCommand[] = !slash
    ? []
    : !slash.query
      ? slashCommands
      : slashCommands
          .map((cmd) => {
            const scores = [cmd.title, ...cmd.keywords]
              .map((k) => fuzzyScore(slash.query, k))
              .filter((s): s is number => s !== null)
            return scores.length ? { cmd, score: Math.min(...scores) } : null
          })
          .filter((x): x is { cmd: SlashCommand; score: number } => x !== null)
          .sort((a, b) => a.score - b.score)
          .map((x) => x.cmd)

  const runSlashCommand = useCallback(
    (command: SlashCommand) => {
      const ed = editorRef.current
      if (!slash || !ed) return
      const range = { from: slash.from, to: slash.from + 1 + slash.query.length }
      setSlash(null)
      command.run(ed, range)
    },
    [slash],
  )

  // 슬래시 메뉴 바깥 클릭 시 닫기
  useEffect(() => {
    const handleClick = () => setSlash(null)
    if (slash) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [slash])

  // 멘션 팝업 바깥 클릭 시 닫기
  useEffect(() => {
    const handleClick = () => setMention(null)
    if (mention) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [mention])

  // 에러 토스트 자동 닫기 — 새로고침 전까지 계속 떠 있지 않도록 6초 뒤 사라진다 (클릭 시 즉시 닫힘)
  useEffect(() => {
    if (!uploadError) return
    const t = setTimeout(() => setUploadError(null), 6000)
    return () => clearTimeout(t)
  }, [uploadError])

  useEffect(() => {
    // collab 모드에서는 Y.XmlFragment가 본문의 진실 원천 — ySyncPlugin이 마운트 때 이미
    // 로드해 두므로 여기서 건드리면 원격 내용을 덮어써버린다. 시딩은 아래 별도 effect가 담당.
    if (collab) return
    if (editor && body !== undefined) {
      const current = (editor.storage as any).markdown?.getMarkdown() ?? ''
      if (current !== body) {
        // 프로그램적 로드는 onUpdate를 발생시키지 않아야 함 (탭 dirty/승격 오작동 방지)
        editor.commands.setContent(body, { emitUpdate: false })
      }
    }
  }, [editor, body, collab])

  // 방을 처음 만든 클라이언트가 이미 로드해 둔 탭 내용(body)으로 Y.XmlFragment를 시딩한다
  // (디스크 재조회 아님) — 이미 누군가 협업 중이던 방이면 fragment가 비어 있지 않으므로
  // _forceRerender가 이미 그 내용을 로드해 둔 상태고, 여기서는 아무 일도 하지 않는다
  useEffect(() => {
    if (!editor || !collab || !collab.synced) return
    const fragment = collab.ydoc.getXmlFragment(COLLAB_FIELD)
    if (fragment.length === 0 && body) {
      // SEED_ORIGIN으로 감싸 이 시딩이 undo 스택에 올라가지 않게 한다 (위 SEED_ORIGIN 선언부 주석 참고)
      collab.ydoc.transact(() => {
        editor.commands.setContent(body, { emitUpdate: false })
      }, SEED_ORIGIN)
    }
  }, [editor, collab?.synced, collab?.ydoc, body])

  // ── 스크롤 위치 저장·복원 (문서별, 기기 세션) ────────────────────────────
  // editor-root div는 파일이 바뀌어도 재생성되지 않으므로(안쪽 tiptap 인스턴스만 교체) 스크롤
  // 리스너는 한 번만 붙인다. 저장 키는 스크롤 시점의 path/scrollTop을 스냅샷해 두어, 전환 직후
  // 남은 디바운스가 엉뚱한 문서에 기록되지 않게 한다. 'h:' 접두사로 plain(CodePane, 'p:')과 분리.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !scrollStore) return
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      if (!restoredRef.current) return
      const key = 'h:' + pathRef.current
      const top = el.scrollTop
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => scrollStore.set(key, top), 150)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (saveTimer) clearTimeout(saveTimer)
      el.removeEventListener('scroll', onScroll)
      // 언마운트(다른 뷰로 전환 등) 직전 마지막 위치 저장 — 복원 전이면 건드리지 않는다
      if (restoredRef.current) scrollStore.set('h:' + pathRef.current, el.scrollTop)
    }
  }, [scrollStore])

  // 문서가 바뀌면 복원 플래그를 초기화한다 — 아래 복원 effect가 새 문서 내용이 찬 뒤 다시 맞춘다.
  // (반드시 복원 effect보다 먼저 선언해 같은 커밋에서 플래그가 false로 리셋된 뒤 복원이 돌게 한다)
  useEffect(() => {
    pathRef.current = path
    restoredRef.current = false
  }, [path])

  // 내용이 렌더돼 높이가 확보된 뒤 저장된 위치로 스크롤. collab은 synced, 비-collab은 body 존재로
  // "내용 있음"을 판단하고, 이미지 등으로 높이가 늦게 커질 수 있어 몇 프레임 재시도한다.
  useEffect(() => {
    if (!scrollStore || !editor || restoredRef.current) return
    const el = containerRef.current
    if (!el) return
    const hasContent = collab ? collab.synced : body.length > 0
    if (!hasContent) return
    restoredRef.current = true
    const target = scrollStore.get('h:' + path)
    if (target <= 0) return
    let raf = 0
    let attempts = 0
    const apply = () => {
      const reachable = el.scrollHeight - el.clientHeight
      if (reachable >= target || attempts >= 30) {
        el.scrollTop = Math.min(target, Math.max(0, reachable))
        return
      }
      attempts += 1
      raf = requestAnimationFrame(apply)
    }
    raf = requestAnimationFrame(apply)
    return () => cancelAnimationFrame(raf)
  }, [editor, body, collab, scrollStore, path])

  useEffect(() => {
    if (editor) {
      // emitUpdate=false: editable 토글이 onUpdate를 발생시켜 탭 상태를 오염시키지 않도록
      editor.setEditable(!readOnly, false)
    }
  }, [editor, readOnly])

  // ── 표 열 너비 복원·저장 (md 밖 레이아웃, .mew/table-layout.json) ─────────────
  // 문서가 바뀌면 저장된 너비를 불러온다. 실패하면 tableSyncRef가 null로 남아 저장도 하지 않는다
  // — 못 읽은 것을 "없음"으로 오해해 덮어쓰지 않기 위해서다.
  useEffect(() => {
    tableSyncRef.current = null
    setTableWidths(null)
    const fetchLayout = api.fetchTableLayout
    if (!fetchLayout || !path) return
    let cancelled = false
    fetchLayout(path)
      .then((tables) => {
        if (cancelled) return
        // 저장된 게 없으면 복원할 것도 없으니 곧바로 저장 가능 상태로 둔다
        tableSyncRef.current = { path, baseline: JSON.stringify(tables), restored: tables.length === 0 }
        setTableWidths(tables)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [api, path])

  // 본문이 들어온 뒤에 입힌다 — 시딩 전이면 표가 없으므로 다음 body 변경에서 다시 시도한다
  useEffect(() => {
    const sync = tableSyncRef.current
    if (!editor || !tableWidths?.length || !sync || sync.path !== path || sync.restored) return
    if (collab && !collab.synced) return
    if (!docHasTable(editor.state.doc)) return
    const apply = () => applyTableWidths(editor, tableWidths)
    // collab에서는 시딩과 같은 이유로 SEED_ORIGIN으로 감싼다 — 복원이 사용자의 undo 스택에 올라가면
    // Ctrl+Z 한 번에 표 너비가 통째로 되돌아간다
    if (collab) collab.ydoc.transact(apply, SEED_ORIGIN)
    else apply()
    sync.restored = true
  }, [editor, tableWidths, path, body, collab, collab?.synced])

  // 열을 끌어 놓으면(=셀 colwidth가 바뀌면) 저장한다. 타이핑 등 다른 변경에서는 값이 같아 저장되지 않는다.
  useEffect(() => {
    const saveLayout = api.saveTableLayout
    if (!editor || !saveLayout || readOnly) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const sync = tableSyncRef.current
        if (!sync || sync.path !== pathRef.current || !sync.restored) return
        const widths = readTableWidths(editor.state.doc)
        const serialized = JSON.stringify(widths)
        if (serialized === sync.baseline) return
        sync.baseline = serialized
        saveLayout(sync.path, widths).catch(() => {})
      }, 500)
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
      if (timer) clearTimeout(timer)
    }
  }, [editor, api, readOnly])

  // Ctrl/Cmd+F(문서 내 찾기)를 에디터 컨테이너에서 가로챈다 — 브라우저 기본 찾기를 막고 우리 바를 연다.
  // Ctrl+Shift+F(프로젝트 전체 검색)는 여기서 잡지 않고 App으로 흘려보낸다.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        // 이미 찾기 바 안에서 눌렀으면 그대로 두고(입력 유지), 그 외에는 선택 텍스트를 seed로 연다
        if (e.target instanceof HTMLElement && e.target.closest('.editor-search-bar')) return
        e.preventDefault()
        e.stopPropagation()
        const ed = editorRef.current
        let seed: string | undefined
        if (ed && !ed.state.selection.empty) {
          const text = ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to, '\n')
          if (text && !text.includes('\n')) seed = text
        }
        openSearchBar(seed)
      }
    }
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [openSearchBar])

  useImperativeHandle(
    ref,
    () => ({
      scrollToHeading(index: number) {
        const headings = containerRef.current?.querySelectorAll('h1, h2, h3, h4, h5, h6')
        const el = headings?.[index] as HTMLElement | undefined
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
      openSearch(seedQuery?: string) {
        openSearchBar(seedQuery)
      },
      setRawContent(content: string) {
        if (!editor) return
        const { body: newBody } = splitFrontmatter(content)
        // emitUpdate: false — 우리가 onChange(content)를 직접, 정확한 전체 문자열로 호출하므로
        // onUpdate의 bumpUpdated·현재(구) frontmatter 기반 재조합을 거치지 않게 한다. collab
        // 방이 있어도 Y.XmlFragment는 이 트랜잭션을 정상적으로 반영한다(ySyncPlugin이 가로챔).
        editor.commands.setContent(newBody, { emitUpdate: false })
        onChange(content)
      },
      getSelectedText() {
        if (!editor) return null
        const { from, to, empty } = editor.state.selection
        if (empty) return null
        return editor.state.doc.textBetween(from, to, '\n')
      },
    }),
    [editor, onChange, openSearchBar],
  )

  // editorRef.current를 쓰는 이유는 위 editorRef 선언부 주석 참고 — handlePaste·handleDrop이
  // 생성 시점 클로저에 얼어붙어 이 함수를 호출하는데, 그때 캡처된 editor는 아직 null이거나
  // 곧 파괴될 이전 인스턴스라 editor.chain()이 "Cannot read properties of null" 크래시를 냈다.
  async function insertUpload(file: File, pos?: number) {
    setUploading(true)
    setUploadError(null)
    try {
      const { url, name, mimetype } = await api.uploadAsset(file)
      const markdown = markdownForAsset(url, name, mimetype)
      const ed = editorRef.current
      if (pos != null && ed) ed.chain().focus().insertContentAt(pos, markdown).run()
      else ed?.chain().focus().insertContent(markdown).run()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setUploading(false)
    }
  }

  // 사이드바에서 끌어다 놓은 파일 경로를 놓은 자리에 적는다. 마크다운으로 해석되지 않게 텍스트 노드로
  // 넣는다 — 경로의 밑줄·별표가 서식으로 먹히면 안 되기 때문이다. (editorRef를 쓰는 이유는 위 참고)
  function insertPathText(text: string, pos?: number) {
    const ed = editorRef.current
    if (!ed) return
    const content = [{ type: 'text', text }]
    if (pos != null) ed.chain().focus().insertContentAt(pos, content).run()
    else ed.chain().focus().insertContent(content).run()
  }

  // /upload 커맨드 전용 — 어떤 파일이든 항상 순수 링크로 삽입
  async function insertUploadAsLink(file: File, pos: number | null) {
    setUploading(true)
    setUploadError(null)
    try {
      const { url, name } = await api.uploadAsset(file)
      const markdown = markdownForLink(url, name)
      const ed = editorRef.current
      if (pos != null && ed) ed.chain().focus().insertContentAt(pos, markdown).run()
      else ed?.chain().focus().insertContent(markdown).run()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setUploading(false)
    }
  }

  function openUploadPicker(pos: number) {
    uploadPosRef.current = pos
    uploadInputRef.current?.click()
  }

  // /db 커맨드 — 새 데이터베이스를 서버(Postgres)에 만들고 그 참조 노드를 삽입한다.
  // 실제 표는 DatabaseView가 dbId로 불러와 렌더하고, 본문에는 참조 id만 남는다.
  async function insertDatabase(pos: number) {
    setUploadError(null)
    try {
      const view = await api.db.create('제목 없음')
      editorRef.current?.chain().focus().insertContentAt(pos, { type: 'database', attrs: { dbId: view.id } }).run()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '데이터베이스 생성 실패')
    }
  }

  // /db 참조 — 기존 데이터베이스를 뷰 전용(readonly)으로 삽입한다 (실시간으로 원본과 동기화되지만 편집은 불가)
  function insertDbReference(dbId: string) {
    const pos = dbPicker?.pos
    setDbPicker(null)
    if (pos == null) return
    editorRef.current?.chain().focus().insertContentAt(pos, { type: 'database', attrs: { dbId, readonly: true } }).run()
  }

  // /db 참조 — 외부 Postgres 테이블을 external(읽기 전용)로 붙여 삽입한다
  async function attachExternalDb(schema: string, table: string) {
    const pos = dbPicker?.pos
    setDbPicker(null)
    if (pos == null) return
    setUploadError(null)
    try {
      const view = await api.db.attachExternal(schema, table)
      editorRef.current?.chain().focus().insertContentAt(pos, { type: 'database', attrs: { dbId: view.id } }).run()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '외부 테이블 참조 실패')
    }
  }

  function handleUploadInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const pos = uploadPosRef.current
    event.target.value = ''
    uploadPosRef.current = null
    if (file) insertUploadAsLink(file, pos)
  }

  // 핸들러가 참조하는 ref 동기화 — editorProps 핸들러는 생성 시점 클로저에 얼어붙어(위 ref 선언부
  // 주석 참고) 이 최신 값들을 직접 못 읽으므로, 렌더마다 ref에 흘려 넣어 handleKeyDown이
  // slashRef.current 등으로 최신 상태·결과·콜백을 보게 한다. 렌더 중 동기 대입이라
  // 다음 키 입력(다음 이벤트 루프) 전에 항상 반영된다.
  slashRef.current = slash
  mentionRef.current = mention
  tooltipRef.current = tooltip
  readOnlyRef.current = readOnly
  slashResultsRef.current = slashResults
  mentionResultsRef.current = mentionResults
  runSlashCommandRef.current = runSlashCommand
  selectMentionRef.current = selectMention
  keyBarCtrlRef.current = keyBarCtrl
  keyBarShiftRef.current = keyBarShift

  return (
    <div
      ref={containerRef}
      className={`editor-root relative flex h-full flex-col overflow-auto bg-surface-deep${frontmatter ? ' has-frontmatter' : ''}`}
    >
      {/* /upload 커맨드 전용 숨은 파일 인풋 — accept 없이 모든 타입, 모바일에서도 네이티브 피커가 뜬다 */}
      <input ref={uploadInputRef} type="file" onChange={handleUploadInputChange} style={{ display: 'none' }} />
      {/* 찾기 바는 스크롤 컨테이너(.editor-root)에 sticky로 붙는 높이 0짜리 앵커 안에 둔다 — 본문을 밀지
          않으면서 스크롤을 내려도 화면 위에 남는다. 앵커 없이 absolute만 쓰면 문서 맨 위에 박혀 같이 밀려 올라간다.
          프론트매터 패널보다 앞에 둬야 문서 최상단에서도 지금과 같은 위치에 뜬다. */}
      {searchOpen && editor && (
        <div className="sticky top-0 z-40 h-0">
          <EditorSearchBar editor={editor} seed={searchSeed.q} seedNonce={searchSeed.n} onClose={() => setSearchOpen(false)} />
        </div>
      )}
      {frontmatter && (
        <FrontmatterPanel
          data={frontmatter}
          onChange={handleFrontmatterChange}
          readOnly={readOnly}
          docPath={path}
          onOpenLink={onOpenLink}
        />
      )}
      <EditorContent editor={editor} />
      {uploading && (
        <div className="absolute bottom-2 right-2 rounded bg-surface-inverse px-2 py-1 text-xs text-ink-inverse">
          업로드 중…
        </div>
      )}
      {/* 에러 토스트(toast) — 클릭하면 닫히고, 6초 뒤 자동으로 사라진다 (아래 auto-dismiss effect) */}
      {uploadError && (
        <div
          role="alert"
          onClick={() => setUploadError(null)}
          title="클릭하면 닫힘"
          className="absolute bottom-2 right-2 flex max-w-xs cursor-pointer items-start gap-2 rounded bg-danger-strong px-2 py-1 text-xs text-ink-on-accent shadow-lg"
        >
          <span className="min-w-0 break-words">{uploadError}</span>
          <span aria-hidden className="shrink-0 opacity-70">✕</span>
        </div>
      )}
      {tooltip?.show && (
        <TableTooltip
          editor={editor}
          position={tooltip.position}
          onClose={closeTooltip}
          mode={tooltip.mode}
        />
      )}
      {linkTooltip && (
        <LinkTooltip
          editor={editor}
          api={api}
          position={linkTooltip.position}
          initialHref={linkTooltip.href}
          initialText={linkTooltip.text}
          range={linkTooltip.range}
          docPath={path}
          readOnly={readOnly}
          initialMode={linkTooltip.mode}
          onClose={closeLinkTooltip}
          onOpenInternal={(target) => {
            closeLinkTooltip()
            onOpenLink?.(target)
          }}
        />
      )}
      {mention && (
        <MentionTooltip
          position={mention.position}
          results={mentionResults}
          selectedIndex={mention.selectedIndex}
          onSelect={selectMention}
        />
      )}
      {slash && (
        <SlashMenu
          position={slash.position}
          commands={slashResults}
          selectedIndex={slash.selectedIndex}
          onSelect={runSlashCommand}
        />
      )}
      {dbPicker && (
        <DbReferencePicker
          api={api.db}
          onPickExisting={insertDbReference}
          onAttachExternal={attachExternalDb}
          onClose={() => setDbPicker(null)}
        />
      )}
      {/* 키보드가 떠 있는지는 보지 않는다 — 키보드를 내린 채 방향키·Esc만 쓰는 경우가 더 많다.
          다만 에디터에 포커스가 없으면 보조키가 갈 곳이 없으므로 그때는 숨긴다. */}
      {mobileLayout && editorFocused && (
        <MobileKeyBar
          ctrlActive={keyBarCtrl}
          shiftActive={keyBarShift}
          onToggleCtrl={() => setKeyBarCtrl((v) => !v)}
          onToggleShift={() => setKeyBarShift((v) => !v)}
          onEsc={handleKeyBarEsc}
          onTab={handleKeyBarTab}
          onArrow={handleKeyBarArrow}
        />
      )}
    </div>
  )
})