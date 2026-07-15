import { useState, useRef, useEffect } from 'react'
import { saveToInbox, triggerAgentFileInbox } from '../api/client'

export function QuickCreateModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  async function handleSubmit() {
    if (!content.trim()) return
    setLoading(true)
    setError(null)
    try {
      await saveToInbox(title.trim(), content)
      await triggerAgentFileInbox()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Enter' && e.target === titleRef.current) {
      e.preventDefault()
      contentRef.current?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <div
        className="w-[600px] max-w-[90vw] overflow-hidden rounded-lg bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목 (선택)"
          className="w-full border-b border-edge bg-surface px-4 py-3 text-sm text-ink outline-none"
        />
        <textarea
          ref={contentRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="내용을 입력하세요... (Ctrl+Enter로 제출)"
          rows={10}
          className="w-full resize-none border-b border-edge bg-surface px-4 py-3 text-sm text-ink outline-none"
        />
        {error && <div className="border-b border-edge bg-danger-surface px-4 py-2 text-xs text-danger-ink">{error}</div>}
        <div className="flex justify-between bg-surface-deep px-4 py-3">
          <div className="text-xs text-ink-muted">Ctrl+Enter로 제출</div>
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || loading}
            className="rounded bg-surface-inverse px-3 py-1 text-ink-inverse disabled:opacity-40"
          >
            {loading ? '처리 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}
