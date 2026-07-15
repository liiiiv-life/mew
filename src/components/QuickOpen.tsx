import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../api/client'

function flattenFiles(tree: TreeNode[]): string[] {
  const out: string[] = []
  for (const node of tree) {
    if (node.type === 'file') out.push(node.path)
    else if (node.children) out.push(...flattenFiles(node.children))
  }
  return out
}

function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let ti = 0
  let start = -1
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti)
    if (idx === -1) return null
    if (start === -1) start = idx
    ti = idx + 1
  }
  return (ti - start) * 1000 + start
}

export function QuickOpen({
  tree,
  onSelect,
  onClose,
}: {
  tree: TreeNode[]
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const files = useMemo(() => flattenFiles(tree), [tree])

  const results = useMemo(() => {
    if (!query) return files.slice(0, 50)
    return files
      .map((path) => ({ path, score: fuzzyScore(query, path) }))
      .filter((r): r is { path: string; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 50)
      .map((r) => r.path)
  }, [files, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const path = results[activeIndex]
      if (path) onSelect(path)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 pt-24" onClick={onClose}>
      <div
        className="w-[36rem] max-w-[90vw] overflow-hidden rounded-lg bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="문서 찾기…"
          className="w-full border-b border-edge bg-surface px-4 py-3 text-sm text-ink outline-none"
        />
        <div className="max-h-96 overflow-y-auto py-1">
          {results.length === 0 && <div className="px-4 py-3 text-sm text-ink-muted">결과 없음</div>}
          {results.map((path, i) => (
            <button
              key={path}
              type="button"
              onClick={() => onSelect(path)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`block w-full truncate px-4 py-2 text-left text-sm text-ink ${
                i === activeIndex ? 'bg-surface-raised' : ''
              }`}
            >
              {path}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
