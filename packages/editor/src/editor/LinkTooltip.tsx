import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { EditorApi } from '../types'
import { splitFrontmatter } from '../utils/frontmatter'
import { isExternalHref, resolveRelativePath } from '../utils/fuzzy'

type Preview =
  | { state: 'loading' }
  | { state: 'internal'; path: string; title: string; desc: string | null }
  | { state: 'internal-missing'; path: string }
  | { state: 'external'; title: string | null; description: string | null }

// 링크 툴팁 — 링크 클릭 시 '보기' 모드(내부: title·desc, 외부: 서버 미리보기),
// 우측 상단 ✎ 또는 Ctrl+K로 '편집' 모드(표시 텍스트·URL). 내부 링크의 표시 텍스트는
// 대상 문서의 title로 강제되므로 편집 모드에서도 직접 수정할 수 없다.
export function LinkTooltip({
  editor,
  api,
  position,
  initialHref,
  initialText,
  range,
  docPath,
  readOnly,
  initialMode,
  onClose,
  onOpenInternal,
}: {
  editor: Editor | null
  api: EditorApi
  position: { top: number; left: number }
  initialHref: string
  initialText: string
  range: { from: number; to: number }
  docPath: string
  readOnly?: boolean
  initialMode: 'view' | 'edit'
  onClose: () => void
  onOpenInternal: (path: string) => void
}) {
  // 링크가 아직 없으면(새로 만드는 중) 보여줄 것이 없으니 곧장 편집 모드
  const [mode, setMode] = useState<'view' | 'edit'>(initialHref ? initialMode : 'edit')
  const [url, setUrl] = useState(initialHref)
  const [text, setText] = useState(initialText)
  const [preview, setPreview] = useState<Preview>({ state: 'loading' })
  const ref = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  const editingInternal = url.trim() !== '' && !isExternalHref(url.trim())

  useEffect(() => {
    if (mode !== 'edit') return
    urlInputRef.current?.focus()
    urlInputRef.current?.select()
  }, [mode])

  // 툴팁 바깥 클릭·Escape 시 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 여기서 멈추지 않으면 window까지 올라가 오버레이 스택이 사이드바·터미널까지 닫는다
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 보기 모드용 미리보기 로드 — 내부는 문서의 title·desc, 외부는 서버 프록시 미리보기
  useEffect(() => {
    if (mode !== 'view' || !initialHref) return
    let cancelled = false
    if (isExternalHref(initialHref)) {
      api.fetchLinkPreview(initialHref)
        .then(({ title, description }) => {
          if (!cancelled) setPreview({ state: 'external', title, description })
        })
        .catch(() => {
          // 뷰어 모드(403) 등 — URL만 표시
          if (!cancelled) setPreview({ state: 'external', title: null, description: null })
        })
    } else {
      const target = resolveRelativePath(docPath, initialHref)
      api.fetchFile(target)
        .then(({ content }) => {
          if (cancelled) return
          const fm = splitFrontmatter(content).frontmatter
          setPreview({
            state: 'internal',
            path: target,
            title: fm?.title || target.split('/').pop() || target,
            desc: fm?.fields.find((f) => f.key === 'desc')?.value || null,
          })
        })
        .catch(() => {
          if (!cancelled) setPreview({ state: 'internal-missing', path: target })
        })
    }
    return () => {
      cancelled = true
    }
  }, [mode, initialHref, docPath, api])

  const apply = async () => {
    if (!editor) return
    const href = url.trim()
    let label = text.trim() || initialText
    // 내부 링크의 표시 텍스트는 대상 문서의 title로 강제한다
    if (href && !isExternalHref(href)) {
      try {
        const { content } = await api.fetchFile(resolveRelativePath(docPath, href))
        const fmTitle = splitFrontmatter(content).frontmatter?.title
        if (fmTitle) label = fmTitle
      } catch {
        // 대상 문서를 못 찾으면 입력된 텍스트 그대로 둔다 (brokenLinks 규칙이 잡아줌)
      }
    }
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

  if (mode === 'view') {
    return (
      <div
        ref={ref}
        style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 1000 }}
        className="w-80 rounded border border-edge-bright bg-surface-raised p-2.5 shadow-lg"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {preview.state === 'loading' && <div className="text-xs text-ink-muted">불러오는 중…</div>}
            {preview.state === 'internal' && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenInternal(preview.path)}
                  className="block w-full truncate text-left text-sm font-semibold text-ink-bright hover:underline"
                  title={preview.title}
                >
                  {preview.title}
                </button>
                {preview.desc && <div className="mt-1 line-clamp-3 text-xs text-ink-secondary">{preview.desc}</div>}
                <div className="mt-1 truncate text-[10px] text-ink-muted">{preview.path}</div>
              </>
            )}
            {preview.state === 'internal-missing' && (
              <div className="select-text text-xs text-danger">문서를 찾을 수 없습니다: {preview.path}</div>
            )}
            {preview.state === 'external' && (
              <>
                {preview.title && (
                  <div className="truncate text-sm font-semibold text-ink-bright" title={preview.title}>
                    {preview.title}
                  </div>
                )}
                {preview.description && (
                  <div className="mt-1 line-clamp-3 text-xs text-ink-secondary">{preview.description}</div>
                )}
                <a
                  href={initialHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block truncate text-[10px] text-link hover:underline"
                >
                  {initialHref}
                </a>
              </>
            )}
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setMode('edit')}
              title="링크 편집 (Ctrl+K)"
              aria-label="링크 편집"
              className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink"
            >
              ✎
            </button>
          )}
        </div>
      </div>
    )
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
        disabled={editingInternal}
        placeholder="표시 텍스트"
        title={editingInternal ? '문서 제목 · 변경 불가' : undefined}
        className="w-64 rounded border border-edge-bright bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent disabled:opacity-50"
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
