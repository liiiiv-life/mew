import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Annotation, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from '@codemirror/language'
import { linter, lintGutter } from '@codemirror/lint'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { pathFromDrag } from '@mew/ui'
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
import { getScrollOffset, setScrollOffset } from '../utils/viewState'

// value prop 동기화로 들어온 트랜잭션 표시 — 이걸 다시 onChange로 올리면 열기만 한
// 미리보기 탭이 "편집됨"으로 승격되고 무의미한 자동저장이 잡힌다
const externalSync = Annotation.define<boolean>()

// collab 방의 Y.Text 공유 키 — 방마다 이 이름 하나만 쓰므로 컴포넌트 내부 상수면 충분하다
const COLLAB_TEXT_KEY = 'content'

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

function lintExtensions(filePath: string): Extension[] {
  const ext = extOf(filePath)
  if (OXLINT_EXTS.has(ext)) {
    return [
      lintGutter(),
      linter(
        async (view) => {
          try {
            const { diagnostics } = await lintFile(filePath, view.state.doc.toString())
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
  /** 지정 줄(1부터)로 스크롤·커서 이동 — 프로젝트 검색 결과 클릭 시 해당 위치로 점프한다 */
  revealLine: (line: number) => void
  /** 현재 선택된 텍스트 — 선택이 없으면 null (터미널/에이전트로 선택 텍스트를 보내는 단축키용) */
  getSelectedText: () => string | null
}

/**
 * Plain 모드(md)와 코드 파일 공용 CodeMirror 에디터 — 줄번호·구문강조·lint.
 * tiptap이 훼손하는 비마크다운 파일의 기본 편집기이기도 하다 (useTabs의 viewMode 기본값 참고).
 */
export const CodePane = forwardRef<
  CodePaneHandle,
  {
    path: string
    value: string
    onChange: (content: string) => void
    readOnly: boolean
    /** 있으면 이 방의 Y.Text가 문서 내용의 진실 원천이 된다 — value/onChange는 그 결과를 반영만 한다 */
    collab?: Collab | null
  }
>(function CodePane({ path, value, onChange, readOnly, collab }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  onChangeRef.current = onChange
  valueRef.current = value

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const state = EditorState.create({
      // collab 모드는 yCollab의 ySync가 마운트 즉시 Y.Text 내용을 반영하므로 빈 문서로 시작한다
      doc: collab ? '' : valueRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        // collab 모드에서는 CodeMirror 기본 history() 대신 Yjs 인지 undo(yUndoManagerKeymap)를 쓴다 —
        // 그래야 되돌리기가 다른 사람이 원격으로 넣은 변경까지 지워버리지 않는다
        ...(collab
          ? [keymap.of([...defaultKeymap, ...yUndoManagerKeymap, indentWithTab]), yCollab(collab.ydoc.getText(COLLAB_TEXT_KEY), collab.awareness)]
          : [history(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab])]),
        syntaxHighlighting(highlight),
        theme,
        ...languageFor(path),
        ...(isProse(path) ? [EditorView.lineWrapping] : []),
        ...(readOnly ? [] : lintExtensions(path)),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        // 사이드바에서 끌어온 파일 항목 — 놓은 자리에 그 파일의 프로젝트 상대경로를 적는다.
        // CodeMirror 기본 드롭도 text/plain을 넣지만, 전용 MIME일 때는 우리가 직접 처리해
        // hotview(tiptap)와 삽입 결과가 같도록 맞춘다.
        EditorView.domEventHandlers({
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

    // ── 스크롤 위치 복원·저장 (문서별, 기기 세션) ──────────────────────────
    // 'p:' 접두사로 hotview(tiptap, 'h:')와 키가 겹치지 않게 한다.
    const scrollKey = 'p:' + path
    const scroller = view.scrollDOM
    let restored = false
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      if (!restored) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => setScrollOffset(scrollKey, scroller.scrollTop), 150)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })

    // 내용이 렌더돼 스크롤 높이가 확보된 뒤에 적용한다. collab 문서는 ySync가 비동기로
    // 채우므로 몇 프레임 재시도하고, 끝내 목표에 못 미치면 도달 가능한 만큼만 맞춘다.
    const target = getScrollOffset(scrollKey)
    let raf = 0
    let attempts = 0
    const tryRestore = () => {
      const reachable = scroller.scrollHeight - scroller.clientHeight
      if (target <= 0 || reachable >= target || attempts >= 30) {
        if (target > 0) scroller.scrollTop = Math.min(target, Math.max(0, reachable))
        restored = true
        return
      }
      attempts += 1
      raf = requestAnimationFrame(tryRestore)
    }
    raf = requestAnimationFrame(tryRestore)

    return () => {
      if (saveTimer) clearTimeout(saveTimer)
      cancelAnimationFrame(raf)
      scroller.removeEventListener('scroll', onScroll)
      // 이 뷰를 떠나기 직전 위치를 저장(디바운스 대기 중이던 마지막 스크롤 보전).
      // 아직 복원 전이면 사용자가 정한 위치가 아니므로 덮어쓰지 않는다.
      if (restored) setScrollOffset(scrollKey, scroller.scrollTop)
      view.destroy()
      viewRef.current = null
    }
    // 파일이 바뀌면 언어·lint 구성이 달라지므로 뷰를 새로 만든다 (문서 내용은 valueRef로 최신값 사용)
  }, [path, readOnly, collab?.ydoc])

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

  useImperativeHandle(
    ref,
    () => ({
      getSelectedText() {
        const view = viewRef.current
        if (!view) return null
        const sel = view.state.selection.main
        if (sel.empty) return null
        return view.state.sliceDoc(sel.from, sel.to)
      },
      revealLine(line: number) {
        const view = viewRef.current
        if (!view) return
        const clamped = Math.max(1, Math.min(line, view.state.doc.lines))
        const info = view.state.doc.line(clamped)
        view.dispatch({
          selection: { anchor: info.from },
          effects: EditorView.scrollIntoView(info.from, { y: 'center' }),
        })
        view.focus()
      },
    }),
    [],
  )

  return <div ref={containerRef} className="h-full w-full overflow-hidden bg-surface-deep" />
})
