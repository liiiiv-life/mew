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
import { NodeSelection } from '@tiptap/pm/state'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useRef, useState, useCallback } from 'react'
import { uploadAsset } from '../api/client'
import { ResizableImage } from './ResizableImage'

function markdownForAsset(url: string, name: string, mimetype: string): string {
  const alt = name.replace(/\.[^.]+$/, '')
  if (mimetype.startsWith('image/')) return `![${alt}](${url})`
  if (mimetype.startsWith('audio/')) return `<audio src="${url}" controls></audio>`
  if (mimetype.startsWith('video/')) return `<video src="${url}" controls></video>`
  return `[${name}](${url})`
}

// 테이블 툴팁 컴포넌트
interface TableTooltipProps {
  editor: any
  position: { top: number; left: number }
  onClose: () => void
  mode: 'add' | 'remove'
}

function TableTooltip({ editor, position, onClose, mode }: TableTooltipProps) {
  const handleCommand = (cmd: string) => {
    switch (cmd) {
      case 'addRowBefore':
        editor.chain().focus().addRowBefore().run()
        break
      case 'addRowAfter':
        editor.chain().focus().addRowAfter().run()
        break
      case 'addColBefore':
        editor.chain().focus().addColumnBefore().run()
        break
      case 'addColAfter':
        editor.chain().focus().addColumnAfter().run()
        break
      case 'removeRow':
        editor.chain().focus().deleteRow().run()
        break
      case 'removeCol':
        editor.chain().focus().deleteColumn().run()
        break
    }
    onClose()
  }

  const buttonStyle = {
    pointerEvents: 'auto',
    backgroundColor: 'var(--color-surface-raised)',
    border: '1px solid var(--color-edge-bright)',
    color: 'var(--color-ink)',
    padding: '4px 8px',
    borderRadius: '3px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    cursor: 'pointer',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  } as const

  const [up, down, left, right] =
    mode === 'add'
      ? ([
          ['addRowBefore', '↑ 행 추가'],
          ['addRowAfter', '↓ 행 추가'],
          ['addColBefore', '← 열 추가'],
          ['addColAfter', '→ 열 추가'],
        ] as const)
      : ([
          ['removeRow', '↑ 행 제거'],
          ['removeRow', '↓ 행 제거'],
          ['removeCol', '← 열 제거'],
          ['removeCol', '→ 열 제거'],
        ] as const)

  // 커서를 십자 중앙에 두고 방향키와 같은 방향에 버튼 배치
  return (
    <div
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        display: 'grid',
        gridTemplateColumns: 'auto auto auto',
        gridTemplateRows: 'auto auto auto',
        gap: '6px',
        pointerEvents: 'none',
      }}
    >
      <button onMouseDown={() => handleCommand(up[0])} style={{ ...buttonStyle, gridColumn: 2, gridRow: 1, justifySelf: 'center' }}>
        {up[1]}
      </button>
      <button onMouseDown={() => handleCommand(left[0])} style={{ ...buttonStyle, gridColumn: 1, gridRow: 2, alignSelf: 'center' }}>
        {left[1]}
      </button>
      <button onMouseDown={() => handleCommand(right[0])} style={{ ...buttonStyle, gridColumn: 3, gridRow: 2, alignSelf: 'center' }}>
        {right[1]}
      </button>
      <button onMouseDown={() => handleCommand(down[0])} style={{ ...buttonStyle, gridColumn: 2, gridRow: 3, justifySelf: 'center' }}>
        {down[1]}
      </button>
    </div>
  )
}

// 링크 툴팁 컴포넌트 (텍스트 선택 후 Ctrl+K)
interface LinkTooltipProps {
  editor: any
  position: { top: number; left: number }
  initialHref: string
  onClose: () => void
}

function LinkTooltip({ editor, position, initialHref, onClose }: LinkTooltipProps) {
  const [url, setUrl] = useState(initialHref)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // 툴팁 바깥 클릭 시 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const apply = () => {
    const href = url.trim()
    if (href) editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    else editor.chain().focus().extendMarkRange('link').unsetLink().run()
    onClose()
  }

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    onClose()
  }

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 1000 }}
      className="flex items-center gap-1.5 rounded border border-edge-bright bg-surface-raised p-1.5 shadow-lg"
    >
      <input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
            editor.chain().focus().run()
          }
        }}
        placeholder="https://... 또는 문서 경로"
        className="w-64 rounded border border-edge-bright bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      />
      <button type="button" onClick={apply} className="rounded bg-accent-strong px-2 py-1 text-xs text-ink-on-accent hover:bg-accent">
        적용
      </button>
      {initialHref && (
        <button
          type="button"
          onClick={remove}
          className="rounded border border-edge-bright px-2 py-1 text-xs text-ink-soft hover:bg-surface-hover"
        >
          제거
        </button>
      )}
    </div>
  )
}

export function Editor({
  value,
  onChange,
  readOnly,
}: {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
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
  } | null>(null)

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
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'text-link underline' } }),
      // allowTableNodeSelection: 테이블 NodeSelection이 CellSelection으로 강제 변환되지 않게 함 (테두리 클릭 선택용)
      TableKit.configure({ table: { allowTableNodeSelection: true } }),
      ResizableImage,
      Placeholder.configure({ placeholder: '노션처럼 작성하세요... # 으로 제목, - 으로 목록' }),
      Markdown.configure({
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content: value,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const markdownInstance = (editor.storage as any).markdown
      const markdown = markdownInstance ? markdownInstance.getMarkdown() : ''
      if (markdown !== undefined) onChange(markdown)
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

          if (textBefore.trim() === '/table') {
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
            const { empty, from } = editor.state.selection
            const href = editor.getAttributes('link').href ?? ''
            if (!empty || href) {
              const coords = _view.coordsAtPos(from)
              setLinkTooltip({ position: { top: coords.bottom + 6, left: coords.left }, href })
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
        for (let i = 0; i < dt.items.length; i++) {
          const item = dt.items[i]
          if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
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
      handleDrop: (_view, event) => {
        if (readOnly) return false
        const dt = event.dataTransfer
        if (!dt || !dt.files || dt.files.length === 0) return false
        const file = dt.files[0]
        if (!file.type.startsWith('image/')) return false
        event.preventDefault()
        event.stopPropagation()
        setTimeout(() => insertUpload(file), 0)
        return true
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

  // 툴팁 클릭 방지
  useEffect(() => {
    const handleClick = () => setTooltip(null)
    if (tooltip?.show) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [tooltip])

  useEffect(() => {
    if (editor && value !== undefined) {
      const current = (editor.storage as any).markdown?.getMarkdown() ?? ''
      if (current !== value) {
        // 프로그램적 로드는 onUpdate를 발생시키지 않아야 함 (탭 dirty/승격 오작동 방지)
        editor.commands.setContent(value, { emitUpdate: false })
      }
    }
  }, [editor, value])

  useEffect(() => {
    if (editor) {
      // emitUpdate=false: editable 토글이 onUpdate를 발생시켜 탭 상태를 오염시키지 않도록
      editor.setEditable(!readOnly, false)
    }
  }, [editor, readOnly])

  async function insertUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const { url, name, mimetype } = await uploadAsset(file)
      const markdown = markdownForAsset(url, name, mimetype)
      editor?.chain().focus().insertContent(markdown).run()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative flex h-full flex-col overflow-auto bg-surface-deep"
    >
      {/* 런타임 <style>은 Tailwind가 처리하지 않으므로 @apply 금지 — 순수 CSS만 사용 */}
      <style>{`
        .tiptap {
          outline: none;
          padding: 2rem;
          min-height: 100%;
          color: var(--color-ink);
          font-size: 15px;
          line-height: 1.7;
        }
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--color-ink-faint);
          pointer-events: none;
          height: 0;
        }
        .tiptap h1 { font-size: 2em; font-weight: 700; margin: 0.5em 0; color: var(--color-ink-bright); }
        .tiptap h2 { font-size: 1.5em; font-weight: 700; margin: 0.5em 0; color: var(--color-ink-bright); }
        .tiptap h3 { font-size: 1.25em; font-weight: 600; margin: 0.5em 0; color: var(--color-ink-bright); }
        .tiptap h4 { font-size: 1.1em; font-weight: 600; margin: 0.5em 0; color: var(--color-ink-bright); }
        .tiptap h5 { font-size: 1em; font-weight: 600; margin: 0.5em 0; color: var(--color-ink-bright); }
        .tiptap h6 { font-size: 0.9em; font-weight: 600; margin: 0.5em 0; color: var(--color-ink-secondary); }
        .tiptap ul, .tiptap ol { padding-left: 1.5em; margin: 0.5em 0; list-style: revert; }
        .tiptap ul li::marker { color: var(--color-ink-muted); font-size: 1.2em; }
        .tiptap ol li::marker { color: var(--color-ink-muted); font-weight: 600; }
        .tiptap li { margin: 0.25em 0; }
        .tiptap li p { margin: 0; }
        .tiptap blockquote {
          border-left: 3px solid var(--color-edge-bright);
          padding-left: 1em;
          margin: 0.5em 0;
          color: var(--color-ink-secondary);
          font-style: italic;
        }
        .tiptap code {
          background: var(--color-surface-raised);
          color: var(--color-code);
          padding: 0.15em 0.4em;
          border-radius: 4px;
          font-size: 0.9em;
          font-family: ui-monospace, monospace;
        }
        .tiptap pre {
          background: var(--color-surface);
          border: 1px solid var(--color-edge-strong);
          border-radius: 6px;
          padding: 1em;
          margin: 0.5em 0;
          overflow-x: auto;
        }
        .tiptap pre code {
          background: transparent;
          color: var(--color-ink);
          padding: 0;
          border-radius: 0;
          font-size: 0.875em;
        }
        .tiptap hr {
          border: none;
          border-top: 1px solid var(--color-edge-strong);
          margin: 1.5em 0;
        }
        .tiptap a { color: var(--color-link); text-decoration: underline; }
        .tiptap p { margin: 0.4em 0; }
        .tiptap img {
          max-width: 100%;
          border-radius: 6px;
        }
        .tiptap audio, .tiptap video {
          max-width: 100%;
          margin: 0.5em 0;
        }
        .tiptap table {
          border-collapse: collapse;
          width: 100%;
          margin: 0.75em 0;
          font-size: 0.95em;
        }
        .tiptap th, .tiptap td {
          border: 1px solid var(--color-edge-strong);
          padding: 0.4em 0.75em;
          vertical-align: top;
        }
        .tiptap th {
          background: var(--color-surface-raised);
          color: var(--color-ink-bright);
          font-weight: 600;
          text-align: left;
        }
        .tiptap td.selectedCell, .tiptap th.selectedCell {
          background: color-mix(in srgb, var(--color-link) 15%, transparent);
        }
        .tiptap .tableWrapper.ProseMirror-selectednode table,
        .tiptap table.ProseMirror-selectednode {
          outline: 2px solid var(--color-link);
          outline-offset: 1px;
        }
        .tiptap table p { margin: 0; }
      `}</style>
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
          onClose={closeLinkTooltip}
        />
      )}
    </div>
  )
}