import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
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
import ListItem from '@tiptap/extension-list-item'
import Blockquote from '@tiptap/extension-blockquote'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import Link from '@tiptap/extension-link'
import { TableKit } from '@tiptap/extension-table'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { findTable, selectionCell, TableMap } from '@tiptap/pm/tables'
import { Markdown } from 'tiptap-markdown'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { uploadAsset, type TreeNode } from '../api/client'
import { ResizableImage } from './ResizableImage'
import { AudioNode, VideoNode, Youtube, YOUTUBE_URL_RE } from './MediaNodes'
import { flattenFiles, fuzzyScore, relativeLinkPath, resolveRelativePath } from '../utils/fuzzy'
import { splitFrontmatter, joinFrontmatter, todayDate, type FrontmatterData } from '../utils/frontmatter'
import { MobileKeyBar } from './MobileKeyBar'
import { useKeyboardOpen } from '../hooks/useKeyboardOpen'
import { FrontmatterPanel } from './editor/FrontmatterPanel'
import { TableTooltip } from './editor/TableTooltip'
import { LinkTooltip } from './editor/LinkTooltip'
import { MentionTooltip, type MentionResult } from './editor/MentionTooltip'
import './editor/editor.css'

export interface EditorHandle {
  scrollToHeading: (index: number) => void
}

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

// 절대 URL(스킴 있음) 여부 — 내부 문서 상대 경로와 구분해서 새 탭/내부 탭을 가른다
function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')
}

// updated는 필드가 이미 있을 때만 오늘 날짜로 갱신한다 — 없으면(사용자가 지웠으면) 되살리지 않는다.
// desc는 자동으로 채우지 않는다 — 작성자(사람·AI)가 직접 쓰는 필드다.
function bumpUpdated(frontmatter: FrontmatterData): FrontmatterData {
  const today = todayDate()
  const idx = frontmatter.fields.findIndex((f) => f.key === 'updated')
  if (idx === -1 || frontmatter.fields[idx].value === today) return frontmatter
  return { ...frontmatter, fields: frontmatter.fields.map((f, i) => (i === idx ? { ...f, value: today } : f)) }
}

export const Editor = forwardRef<
  EditorHandle,
  {
    value: string
    onChange: (value: string) => void
    readOnly?: boolean
    path?: string
    tree?: TreeNode[]
    onOpenLink?: (path: string) => void
  }
>(function Editor({ value, onChange, readOnly, path = '', tree = [], onOpenLink }, ref) {
  const { frontmatter, body } = useMemo(() => splitFrontmatter(value), [value])
  function handleFrontmatterChange(next: FrontmatterData) {
    onChange(joinFrontmatter(next, body))
  }
  const containerRef = useRef<HTMLDivElement>(null)
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
  const [editorFocused, setEditorFocused] = useState(false)
  const [keyBarCtrl, setKeyBarCtrl] = useState(false)
  const [keyBarShift, setKeyBarShift] = useState(false)
  const keyboardOpen = useKeyboardOpen()

  const editor = useEditor({
    extensions: [
      Document,
      Text,
      Paragraph,
      StarterKit.configure({
        document: false,
        text: false,
        paragraph: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: { HTMLAttributes: { class: 'code-block' } },
      }),
      Bold,
      Italic,
      Strike,
      Code,
      CodeBlock.configure({ HTMLAttributes: { class: 'code-block' } }),
      Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
      BulletList,
      OrderedList,
      ListItem,
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
      Placeholder.configure({ placeholder: '노션처럼 작성하세요... # 으로 제목, - 으로 목록' }),
      Markdown.configure({
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content: body,
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
    },
    onFocus: () => setEditorFocused(true),
    onBlur: () => setEditorFocused(false),
    onSelectionUpdate: ({ editor }) => {
      updateMentionState(editor)
    },
    editorProps: {
      handleClick: (view, _pos, event) => {
        if (readOnly) return false
        const target = event.target as HTMLElement
        if (!(target instanceof HTMLElement)) return false
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
        // @ 멘션 팝업이 열려있을 때 키보드 내비게이션
        if (mention) {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            event.stopPropagation()
            setMention((m) =>
              m ? { ...m, selectedIndex: Math.min(m.selectedIndex + 1, Math.max(mentionResults.length - 1, 0)) } : m,
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
            const result = mentionResults[mention.selectedIndex]
            if (result) selectMention(result)
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

        // Tab 키 처리: 커서 자리가 아니라 줄 맨 앞에 들여쓰기
        if (event.key === 'Tab') {
          event.preventDefault()
          const view = _view

          // 리스트 항목은 텍스트 앞에 \t를 넣어도 불렛이 안 움직이므로 중첩 리스트로 처리
          if (editor?.isActive('listItem')) {
            if (event.shiftKey) editor.chain().focus().liftListItem('listItem').run()
            else editor.chain().focus().sinkListItem('listItem').run()
            return true
          }

          const { $from, from } = view.state.selection
          const blockStart = $from.start()
          // 코드블록의 개행·하드브레이크 뒤를 줄 시작으로 취급
          const textBefore = view.state.doc.textBetween(blockStart, from, '\n', '\n')
          const lineStart = blockStart + textBefore.lastIndexOf('\n') + 1

          if (event.shiftKey) {
            if (view.state.doc.textBetween(lineStart, lineStart + 1) === '\t') {
              view.dispatch(view.state.tr.delete(lineStart, lineStart + 1))
            }
          } else {
            view.dispatch(view.state.tr.insertText('\t', lineStart, lineStart))
          }
          return true
        }

        // /table 명령어 처리 (스페이스로 실행)
        if (event.key === ' ' && editor) {
          const { $from, from, empty } = editor.state.selection
          // keydown 시점에는 스페이스가 아직 문서에 없으므로 커서 앞 텍스트가 곧 명령어
          const textBefore = empty
            ? $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
            : ''

          if (textBefore.trim() === '/table' || textBefore.trim() === '/표') {
            event.preventDefault()
            event.stopPropagation()
            // 명령어 텍스트를 지운 뒤 그 자리에 3x3 테이블 생성
            editor
              .chain()
              .focus()
              .deleteRange({ from: from - textBefore.length, to: from })
              .insertTable({ rows: 3, cols: 3 })
              .run()
            return true
          }

          if (textBefore.trim() === '/upload' || textBefore.trim() === '/업로드') {
            event.preventDefault()
            event.stopPropagation()
            const deleteFrom = from - textBefore.length
            editor.chain().focus().deleteRange({ from: deleteFrom, to: from }).run()
            openUploadPicker(deleteFrom)
            return true
          }
        }

        // 테이블 관련 키보드 처리
        if (!readOnly && editor) {
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
          if (tooltip?.show) {
            const arrowCommands: Record<string, (() => void) | undefined> =
              tooltip.mode === 'add'
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
          if (!readOnly && editor) {
            // 커서가 기존 링크 위에 있을 뿐 선택 범위가 없으면 링크 전체로 확장
            editor.chain().extendMarkRange('link').run()
            const { empty, from, to } = editor.state.selection
            const href = editor.getAttributes('link').href ?? ''
            if (!empty || href) {
              const text = editor.state.doc.textBetween(from, to, ' ')
              const coords = _view.coordsAtPos(from)
              setLinkTooltip({
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
        if (readOnly) return false
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
        if (readOnly) return false
        const dt = event.dataTransfer
        if (!dt || !dt.files || dt.files.length === 0) return false
        const file = dt.files[0]
        event.preventDefault()
        event.stopPropagation()
        // 마우스를 놓은 위치에 정확히 삽입 (기본 커서 위치가 아님)
        const dropPos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        setTimeout(() => insertUpload(file, dropPos), 0)
        return true
      },
      handleDOMEvents: {
        // 링크 클릭: 일반 클릭은 커서만 이동(네비게이션 없음), Ctrl/Cmd+클릭만 열기
        // — 내부 문서 상대 경로는 새 탭이 아니라 에디터 내부 탭에서 연다
        mousedown: (view, event) => {
          if (readOnly) return false
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
        click: (view, event) => {
          if (readOnly) return false
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
          return false
        },
      },
    },
  })

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
    if (tooltip || linkTooltip || mention) {
      closeTooltip()
      closeLinkTooltip()
      setMention(null)
      return
    }
    editor?.commands.blur()
  }

  // Tab/Shift-Tab을 진짜 keydown처럼 에디터 DOM에 흘려보낸다 — ProseMirror의 키맵(리스트
  // 들여쓰기 등)은 자체 JS 이벤트 처리라 합성 이벤트에도 반응한다 (네이티브 텍스트 입력과 달리)
  function handleKeyBarTab() {
    editor?.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', shiftKey: keyBarShift, bubbles: true, cancelable: true }),
    )
    setKeyBarShift(false)
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
      const to = mention.from + 1 + mention.query.length
      const href = relativeLinkPath(path, result.path)
      editor.chain().focus().deleteRange({ from: mention.from, to }).insertContent(`[${result.label}](${href}) `).run()
      setMention(null)
    },
    [mention, editor, path],
  )

  // 멘션 팝업 바깥 클릭 시 닫기
  useEffect(() => {
    const handleClick = () => setMention(null)
    if (mention) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [mention])

  useEffect(() => {
    if (editor && body !== undefined) {
      const current = (editor.storage as any).markdown?.getMarkdown() ?? ''
      if (current !== body) {
        // 프로그램적 로드는 onUpdate를 발생시키지 않아야 함 (탭 dirty/승격 오작동 방지)
        editor.commands.setContent(body, { emitUpdate: false })
      }
    }
  }, [editor, body])

  useEffect(() => {
    if (editor) {
      // emitUpdate=false: editable 토글이 onUpdate를 발생시켜 탭 상태를 오염시키지 않도록
      editor.setEditable(!readOnly, false)
    }
  }, [editor, readOnly])

  useImperativeHandle(
    ref,
    () => ({
      scrollToHeading(index: number) {
        const headings = containerRef.current?.querySelectorAll('h1, h2, h3, h4, h5, h6')
        const el = headings?.[index] as HTMLElement | undefined
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
    }),
    [],
  )

  async function insertUpload(file: File, pos?: number) {
    setUploading(true)
    setUploadError(null)
    try {
      const { url, name, mimetype } = await uploadAsset(file)
      const markdown = markdownForAsset(url, name, mimetype)
      if (pos != null && editor) editor.chain().focus().insertContentAt(pos, markdown).run()
      else editor?.chain().focus().insertContent(markdown).run()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setUploading(false)
    }
  }

  // /upload 커맨드 전용 — 어떤 파일이든 항상 순수 링크로 삽입
  async function insertUploadAsLink(file: File, pos: number | null) {
    setUploading(true)
    setUploadError(null)
    try {
      const { url, name } = await uploadAsset(file)
      const markdown = markdownForLink(url, name)
      if (pos != null && editor) editor.chain().focus().insertContentAt(pos, markdown).run()
      else editor?.chain().focus().insertContent(markdown).run()
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

  function handleUploadInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const pos = uploadPosRef.current
    event.target.value = ''
    uploadPosRef.current = null
    if (file) insertUploadAsLink(file, pos)
  }

  return (
    <div
      ref={containerRef}
      className={`editor-root relative flex h-full flex-col overflow-auto bg-surface-deep${frontmatter ? ' has-frontmatter' : ''}`}
    >
      {/* /upload 커맨드 전용 숨은 파일 인풋 — accept 없이 모든 타입, 모바일에서도 네이티브 피커가 뜬다 */}
      <input ref={uploadInputRef} type="file" onChange={handleUploadInputChange} style={{ display: 'none' }} />
      {frontmatter && <FrontmatterPanel data={frontmatter} onChange={handleFrontmatterChange} readOnly={readOnly} />}
      <EditorContent editor={editor} />
      {uploading && (
        <div className="absolute bottom-2 right-2 rounded bg-surface-inverse px-2 py-1 text-xs text-ink-inverse">
          업로드 중…
        </div>
      )}
      {uploadError && <div className="absolute bottom-2 right-2 rounded bg-danger-strong px-2 py-1 text-xs text-ink-on-accent">{uploadError}</div>}
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
          position={linkTooltip.position}
          initialHref={linkTooltip.href}
          initialText={linkTooltip.text}
          range={linkTooltip.range}
          onClose={closeLinkTooltip}
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
      {keyboardOpen && editorFocused && (
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