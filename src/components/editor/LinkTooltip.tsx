import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

// 링크 편집 툴팁 (텍스트 선택 후 Ctrl+K) — 링크 URL과 표시 텍스트를 함께 편집
export function LinkTooltip({
  editor,
  position,
  initialHref,
  initialText,
  range,
  onClose,
}: {
  editor: Editor | null
  position: { top: number; left: number }
  initialHref: string
  initialText: string
  range: { from: number; to: number }
  onClose: () => void
}) {
  const [url, setUrl] = useState(initialHref)
  const [text, setText] = useState(initialText)
  const ref = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    urlInputRef.current?.focus()
    urlInputRef.current?.select()
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
    if (!editor) return
    const href = url.trim()
    const label = text.trim() || initialText
    let { from, to } = range
    let chain = editor.chain().focus().setTextSelection({ from, to })
    if (label !== initialText) {
      chain = chain.insertContentAt({ from, to }, label)
      to = from + label.length
      chain = chain.setTextSelection({ from, to })
    }
    if (href) chain.extendMarkRange('link').setLink({ href }).run()
    else chain.extendMarkRange('link').unsetLink().run()
    onClose()
  }

  const remove = () => {
    editor?.chain().focus().setTextSelection(range).extendMarkRange('link').unsetLink().run()
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      apply()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      editor?.chain().focus().run()
    }
  }

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 1000 }}
      className="flex flex-col gap-1.5 rounded border border-edge-bright bg-surface-raised p-1.5 shadow-lg"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="표시 텍스트"
        className="w-64 rounded border border-edge-bright bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
      />
      <div className="flex items-center gap-1.5">
        <input
          ref={urlInputRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
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
    </div>
  )
}
