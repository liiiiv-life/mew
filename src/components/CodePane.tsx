import { subscribeUiLocale } from '@mew/ui/i18n-core'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Annotation, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { SearchQuery, openSearchPanel, setSearchQuery } from '@codemirror/search'
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from '@codemirror/language'
import { linter, lintGutter } from '@codemirror/lint'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { pathFromDrag, observeEditorViewport, visibleEditorBounds } from '@mew/ui'
import { tags } from '@lezer/highlight'
import type { Collab } from '../hooks/useCollab'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { xml } from '@codemirror/lang-xml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { sCSS } from '@codemirror/legacy-modes/mode/css'
import { lintFile } from '../api/client'
import { codeSearchExtensions, refreshCodeSearchLanguage } from '../utils/codeSearch'
import { debuggerEditorExtension } from '../utils/debugger-editor'
import { makeCommentAnchor, resolveCommentAnchor, type CommentAnchor, type CommentThreadInput, type EditorViewAnchor } from '@mew/editor'

// value prop 동기화로 들어온 트랜잭션 표시 — 이걸 다시 onChange로 올리면 열기만 한
// 미리보기 탭이 "편집됨"으로 승격되고 무의미한 자동저장이 잡힌다
const externalSync = Annotation.define<boolean>()

// collab 방의 Y.Text 공유 키 — 방마다 이 이름 하나만 쓰므로 컴포넌트 내부 상수면 충분하다
const COLLAB_TEXT_KEY = 'content'

// ── 파일 댓글 하이라이트 — hotview의 CommentHighlight(장식)와 같은 규칙·같은 CSS 클래스.
// 본문에는 아무것도 넣지 않고, 앵커(텍스트 문맥)를 지금 원문에서 다시 풀어 장식으로만 그린다.
const setCommentThreads = StateEffect.define<CommentThreadInput[]>()

function buildCommentDecorations(docText: string, threads: CommentThreadInput[]): DecorationSet {
  const ranges = []
  for (const thread of threads) {
    const range = resolveCommentAnchor(docText, thread.anchor)
    if (!range) continue // 고아 — 목록 팝업에서만 보인다
    ranges.push(
      Decoration.mark({ class: 'mew-comment', attributes: { 'data-thread': thread.id } }).range(range.from, range.to),
    )
  }
  return Decoration.set(ranges, true)
}

// ponytail: 변경마다 문서 전체 텍스트로 다시 푼다 — 큰 파일에서 느려지면 디바운스로
const commentField = StateField.define<{ threads: CommentThreadInput[]; deco: DecorationSet }>({
  create: () => ({ threads: [], deco: Decoration.none }),
  update(value, tr) {
    let threads = value.threads
    let changed = tr.docChanged
    for (const effect of tr.effects) {
      if (effect.is(setCommentThreads)) {
        threads = effect.value
        changed = true
      }
    }
    if (!changed) return value
    return { threads, deco: buildCommentDecorations(tr.state.doc.toString(), threads) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.deco),
})

/** 서버 oxlint가 처리하는 확장자 — server/lint.ts의 LINTABLE_EXTENSIONS와 맞춰야 한다 */
const OXLINT_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'])

function extOf(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function languageFor(filePath: string): Extension[] {
  const name = filePath.split('/').pop() ?? filePath
  switch (extOf(filePath)) {
    case 'md':
    case 'mdx':
      return [markdown()]
    case 'ts':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'json':
    case 'jsonc':
      return [json()]
    case 'yml':
    case 'yaml':
      return [yaml()]
    case 'css':
      return [css()]
    case 'scss':
      return [StreamLanguage.define(sCSS)]
    case 'html':
      return [html()]
    case 'svg':
      return [xml()]
    case 'py':
      return [python()]
    case 'sql':
      return [sql()]
    case 'rs':
      return [rust()]
    case 'go':
      return [go()]
    case 'sh':
    case 'zsh':
    case 'bash':
      return [StreamLanguage.define(shell)]
    case 'toml':
    case 'ini':
      return [StreamLanguage.define(toml)]
    default:
      if (name === 'Dockerfile' || name === 'Makefile') return [StreamLanguage.define(shell)]
      if (name === '.gitignore' || name === '.env' || name.startsWith('.env.')) return [StreamLanguage.define(properties)]
      return []
  }
}

/** 산문 파일은 가로 스크롤 대신 줄바꿈 — 코드는 VSCode처럼 줄을 유지한다 */
function isProse(filePath: string): boolean {
  const ext = extOf(filePath)
  return ext === 'md' || ext === 'mdx' || ext === 'txt'
}

function lintExtensions(filePath: string, project?: string): Extension[] {
  const ext = extOf(filePath)
  if (OXLINT_EXTS.has(ext)) {
    return [
      lintGutter(),
      linter(
        async (view) => {
          try {
            const { diagnostics } = await lintFile(filePath, view.state.doc.toString(), project)
            const max = view.state.doc.length
            return diagnostics.map((d) => ({
              from: Math.min(d.from, max),
              to: Math.min(Math.max(d.to, d.from), max),
              severity: d.severity,
              message: d.message,
              source: d.code ?? undefined,
            }))
          } catch {
            // 뷰어 모드 403·네트워크 실패 등 — lint 결과 없음으로 조용히 처리
            return []
          }
        },
        { delay: 600 },
      ),
    ]
  }
  if (ext === 'json') return [lintGutter(), linter(jsonParseLinter())]
  return []
}

// 색은 index.css의 --color-syntax-* 토큰(SSoT)만 참조 — 다크/라이트 전환이 CSS만으로 반영된다
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: 'var(--color-syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--color-syntax-string)' },
  { tag: [tags.comment, tags.meta], color: 'var(--color-syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.atom, tags.null], color: 'var(--color-syntax-number)' },
  {
    tag: [tags.propertyName, tags.attributeName, tags.function(tags.variableName), tags.labelName],
    color: 'var(--color-syntax-property)',
  },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.namespace], color: 'var(--color-syntax-type)' },
  { tag: tags.heading, color: 'var(--color-ink-bright)', fontWeight: 'bold' },
  { tag: [tags.link, tags.url], color: 'var(--color-link)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
])

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: 'var(--color-surface-deep)',
    color: 'var(--color-ink)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '1.25rem 1rem 8rem 0.25rem', caretColor: 'var(--color-ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-ink)' },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface-deep)',
    color: 'var(--color-ink-faint)',
    border: 'none',
    paddingLeft: '0.5rem',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-ink-secondary)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--color-surface-raised) 35%, transparent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-surface-raised)',
    color: 'var(--color-ink)',
    border: '1px solid var(--color-edge-strong)',
  },
  // 찾기·줄이동 패널 — 기본 테마가 밝은 회색으로 못박아 둬서 다크에서 튄다. 색을 전부 토큰으로 바꾼다
  '.cm-panels': { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-ink)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-edge-strong)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--color-edge-strong)' },
  '.cm-panel.cm-search': { padding: '6px 28px 6px 8px', fontSize: '12px' },
  '.cm-panel.cm-search label': { fontSize: '11px', color: 'var(--color-ink-secondary)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--color-ink-muted)', fontSize: '16px', padding: '0 4px' },
  '.cm-textfield': {
    backgroundColor: 'var(--color-surface-deep)',
    color: 'var(--color-ink)',
    border: '1px solid var(--color-edge-strong)',
    borderRadius: '4px',
    padding: '2px 6px',
  },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--color-accent)' },
  '.cm-button': {
    backgroundColor: 'var(--color-surface-deep)',
    backgroundImage: 'none',
    color: 'var(--color-ink-secondary)',
    border: '1px solid var(--color-edge-strong)',
    borderRadius: '4px',
    padding: '2px 8px',
  },
  '.cm-button:hover': { backgroundColor: 'var(--color-surface-hover)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 55%, transparent)',
  },
  // yCollab 원격 캐럿 — 기본 테마는 이름표(.cm-ySelectionInfo)를 hover에만 보여준다. Tiptap 쪽
  // 말풍선 오버레이(editor.css의 .collaboration-carets__label)와 동일하게 항상 떠 있는 반투명
  // 말풍선으로 바꾼다. absolute 포지션이라 원래도 줄 높이엔 영향 없음 — 여기서는 표시 방식만 조정.
  '.cm-ySelectionCaretDot': { display: 'none' },
  '.cm-ySelectionInfo': {
    top: '-1.4em',
    left: '-1px',
    fontSize: '12px',
    fontFamily: 'inherit',
    fontWeight: '500',
    borderRadius: '6px 6px 6px 0',
    padding: '1px 6px',
    opacity: '0.5',
  },
})

export interface CodePaneHandle {
  getViewAnchor: () => EditorViewAnchor | null
  restoreViewAnchor: (anchor: EditorViewAnchor) => boolean
  /** 내부 문서가 expectedContent까지 동기화됐을 때만 지정 줄로 이동하고 true를 돌려준다. */
  revealLine: (line: number, expectedContent: string) => boolean
  /** 현재 선택된 텍스트 — 선택이 없으면 null (터미널/에이전트로 선택 텍스트를 보내는 단축키용) */
  getSelectedText: () => string | null
  /** 선택 시작·끝의 파일 줄 번호(1부터) — [경로:줄] 참조 삽입용. plain은 파일 원문 그대로라 보정 없음 */
  getSelectedLineRange: () => { start: number; end: number } | null
  /** 찾기 패널을 연다 — 에디터 밖(사이드바 등)에서 Ctrl+F를 눌렀을 때. 안에서 눌렀으면 searchKeymap이 처리한다 */
  openSearch: (query?: string) => void
  /** 현재 선택(없으면 커서)의 댓글 앵커 — 텍스트 공간은 파일 원문 그대로 */
  getCommentAnchor: () => CommentAnchor | null
  /** 앵커 자리로 스크롤하고 그 화면 좌표를 준다 — 댓글 목록에서 스레드로 점프할 때. 고아면 null */
  revealCommentAnchor: (anchor: CommentAnchor) => { x: number; y: number } | null
}

/**
 * Plain 모드(md)와 코드 파일 공용 CodeMirror 에디터 — 줄번호·구문강조·lint.
 * tiptap이 훼손하는 비마크다운 파일의 기본 편집기이기도 하다 (useTabs의 viewMode 기본값 참고).
 */
export const CodePane = forwardRef<
  CodePaneHandle,
  {
    path: string
    project?: string
    value: string
    onChange: (content: string) => void
    readOnly: boolean
    /** 있으면 이 방의 Y.Text가 문서 내용의 진실 원천이 된다 — value/onChange는 그 결과를 반영만 한다 */
    collab?: Collab | null
    /** 파일 댓글 스레드 — 본문 위 장식(하이라이트)으로만 그린다. 저장·해석은 호스트 몫 */
    commentThreads?: CommentThreadInput[]
    onCommentClick?: (id: string, x: number, y: number) => void
    /** 부분 preview는 문서 전체 줄 번호를 유지한다. 일반 문서는 0이다. */
    lineOffset?: number
    debuggerContext?: { root: string; account: string }
  }
>(function CodePane({ path, project, value, onChange, readOnly, collab, commentThreads, onCommentClick, lineOffset = 0, debuggerContext }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  const commentThreadsRef = useRef(commentThreads ?? [])
  const onCommentClickRef = useRef(onCommentClick)
  onChangeRef.current = onChange
  valueRef.current = value
  commentThreadsRef.current = commentThreads ?? []
  onCommentClickRef.current = onCommentClick

  const debugRoot = debuggerContext?.root, debugAccount = debuggerContext?.account
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const debug = debugRoot && debugAccount ? debuggerEditorExtension(debugRoot, debugAccount, path, lineOffset, !readOnly) : undefined
    const state = EditorState.create({
      // collab 모드는 yCollab의 ySync가 마운트 즉시 Y.Text 내용을 반영하므로 빈 문서로 시작한다
      doc: collab ? '' : valueRef.current,
      extensions: [
        lineNumbers({ formatNumber: (line) => String(line + lineOffset) }),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        ...(debug ? [debug.extension] : []),
        drawSelection(),
        bracketMatching(),
        // collab 모드에서는 CodeMirror 기본 history() 대신 Yjs 인지 undo(yUndoManagerKeymap)를 쓴다 —
        // 그래야 되돌리기가 다른 사람이 원격으로 넣은 변경까지 지워버리지 않는다
        ...(collab
          ? [keymap.of([...defaultKeymap, ...yUndoManagerKeymap, indentWithTab]), yCollab(collab.ydoc.getText(COLLAB_TEXT_KEY), collab.awareness)]
          : [history(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab])]),
        codeSearchExtensions, // Ctrl+F 문서 내 찾기·바꾸기
        syntaxHighlighting(highlight),
        theme,
        ...languageFor(path),
        ...(isProse(path) ? [EditorView.lineWrapping] : []),
        ...(readOnly ? [] : lintExtensions(path, project)),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        commentField,
        // 사이드바에서 끌어온 파일 항목 — 놓은 자리에 그 파일의 프로젝트 상대경로를 적는다.
        // CodeMirror 기본 드롭도 text/plain을 넣지만, 전용 MIME일 때는 우리가 직접 처리해
        // hotview(tiptap)와 삽입 결과가 같도록 맞춘다.
        EditorView.domEventHandlers({
          // 댓글 하이라이트 클릭 → 스레드 팝업 (hotview의 handleClick과 같은 규칙)
          click(event) {
            const el = (event.target as HTMLElement | null)?.closest?.('[data-thread]')
            const id = el?.getAttribute('data-thread')
            if (!id) return false
            onCommentClickRef.current?.(id, event.clientX, event.clientY)
            return true
          },
          drop(event, view) {
            if (readOnly) return false
            const draggedPath = pathFromDrag(event.dataTransfer)
            if (!draggedPath) return false
            event.preventDefault()
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
            view.dispatch({
              changes: { from: pos, insert: draggedPath },
              selection: { anchor: pos + draggedPath.length },
              scrollIntoView: true,
            })
            view.focus()
            return true
          },
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          if (!collab && update.transactions.every((tr) => tr.annotation(externalSync))) return
          onChangeRef.current(update.state.doc.toString())
        }),
      ],
    })
    const view = new EditorView({ state, parent: container })
    viewRef.current = view
    const unsubscribeDebug = debug?.attach(view)
    const stopViewport = observeEditorViewport(container, () => view.requestMeasure({
      key: container,
      read: () => {
        if (!view.hasFocus) return 0
        const caret = view.coordsAtPos(view.state.selection.main.head)
        if (!caret) return 0
        const { top, bottom } = visibleEditorBounds(view.scrollDOM)
        if (bottom <= top) return 0
        return caret.bottom > bottom ? caret.bottom - bottom : caret.top < top ? caret.top - top : 0
      },
      write: delta => { if (delta) view.scrollDOM.scrollTop += delta },
    }))
    const unsubscribeLocale = subscribeUiLocale(() => view.dispatch({ effects: refreshCodeSearchLanguage() }))
    // 방금 만든 뷰에 지금 스레드를 흘려 넣는다 — 필드 초기값은 빈 목록이다
    if (commentThreadsRef.current.length > 0) view.dispatch({ effects: setCommentThreads.of(commentThreadsRef.current) })

    return () => {
      stopViewport()
      unsubscribeLocale()
      unsubscribeDebug?.()
      view.destroy()
      viewRef.current = null
    }
    // 파일이 바뀌면 언어·lint 구성이 달라지므로 뷰를 새로 만든다 (문서 내용은 valueRef로 최신값 사용)
  }, [project, path, readOnly, collab?.ydoc, lineOffset, debugRoot, debugAccount])

  // 방을 처음 만든 클라이언트가 이미 로드해 둔 탭 내용으로 Y.Text를 시딩한다 (디스크 재조회 아님) —
  // 이미 누군가 협업 중이던 방이면 ytext가 비어 있지 않으므로 아무 일도 하지 않는다
  useEffect(() => {
    if (!collab || !collab.synced) return
    const ytext = collab.ydoc.getText(COLLAB_TEXT_KEY)
    if (ytext.length === 0 && valueRef.current) ytext.insert(0, valueRef.current)
  }, [collab?.synced, collab?.ydoc])

  // 외부 갱신(파일 fetch 완료, 다른 세션의 변경 반영 등)을 에디터에 흘려넣는다.
  // 사용자가 입력한 변경은 updateListener → onChange → value로 돌아와 여기서 no-op이 된다.
  // collab 모드에서는 yCollab의 ySync가 이 역할을 대신하므로 건드리지 않는다.
  useEffect(() => {
    if (collab) return
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value }, annotations: externalSync.of(true) })
    }
  }, [value, collab])

  // 스레드 목록이 바뀌면 장식을 다시 푼다 — 문서 편집 쪽은 필드가 docChanged로 스스로 다시 푼다
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setCommentThreads.of(commentThreads ?? []) })
  }, [commentThreads])

  useImperativeHandle(
    ref,
    () => ({
      getViewAnchor() {
        const view = viewRef.current
        if (!view) return null
        const bounds = view.scrollDOM.getBoundingClientRect()
        const cursor = view.coordsAtPos(view.state.selection.main.head)
        const pos = cursor && cursor.top >= bounds.top && cursor.bottom <= bounds.bottom
          ? view.state.selection.main.head
          : view.lineBlockAtHeight(Math.max(0, bounds.top - view.documentTop)).from
        const line = view.state.doc.lineAt(pos)
        const top = view.documentTop + view.lineBlockAt(line.from).top
        return { line: line.number + lineOffset, offset: Math.max(0, top - bounds.top) }
      },
      restoreViewAnchor(anchor) {
        const view = viewRef.current
        if (!view) return false
        const line = view.state.doc.line(Math.max(1, Math.min(anchor.line - lineOffset, view.state.doc.lines)))
        if (view.state.selection.main.head !== line.from) view.dispatch({ selection: { anchor: line.from } })
        const offset = view.documentTop + view.lineBlockAt(line.from).top - view.scrollDOM.getBoundingClientRect().top
        if (Math.abs(offset - anchor.offset) > 1) view.scrollDOM.scrollTop += offset - anchor.offset
        return true
      },
      getSelectedText() {
        const view = viewRef.current
        if (!view) return null
        const sel = view.state.selection.main
        if (sel.empty) return null
        return view.state.sliceDoc(sel.from, sel.to)
      },
      getSelectedLineRange() {
        const view = viewRef.current
        if (!view) return null
        const sel = view.state.selection.main
        return { start: view.state.doc.lineAt(sel.from).number + lineOffset, end: view.state.doc.lineAt(sel.to).number + lineOffset }
      },
      openSearch(query?: string) {
        const view = viewRef.current
        if (!view) return
        // 검색어를 먼저 넣어야 한다 — openSearchPanel은 선택 텍스트가 없으면 지금 검색어를 그대로 쓴다
        if (query) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) })
        openSearchPanel(view)
      },
      revealLine(line: number, expectedContent: string) {
        const view = viewRef.current
        if (!view || view.state.doc.toString() !== expectedContent) return false
        const clamped = Math.max(1, Math.min(line - lineOffset, view.state.doc.lines))
        const info = view.state.doc.line(clamped)
        view.dispatch({
          selection: { anchor: info.from },
          effects: EditorView.scrollIntoView(info.from, { y: 'center' }),
        })
        view.focus()
        return true
      },
      getCommentAnchor() {
        const view = viewRef.current
        if (!view) return null
        const sel = view.state.selection.main
        return makeCommentAnchor(view.state.doc.toString(), sel.from, sel.to)
      },
      revealCommentAnchor(anchor: CommentAnchor) {
        const view = viewRef.current
        if (!view) return null
        const range = resolveCommentAnchor(view.state.doc.toString(), anchor)
        if (!range) return null
        view.dispatch({
          selection: { anchor: range.from },
          effects: EditorView.scrollIntoView(range.from, { y: 'center' }),
        })
        const coords = view.coordsAtPos(range.from)
        return coords ? { x: coords.left, y: coords.bottom } : null
      },
    }),
    [lineOffset],
  )

  // 찾기 패널이 Esc를 먹었으면 거기서 끊는다 — 흘려보내면 같은 Esc로 사이드바·터미널까지 닫힌다
  // (useOverlayDismiss는 window bubble 단계에서 듣는다)
  return (
    <div
      ref={containerRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && e.defaultPrevented) e.stopPropagation()
      }}
      className="h-full w-full overflow-hidden bg-surface-deep"
    />
  )
})
