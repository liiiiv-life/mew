import { useMemo, useState } from 'react'
import { parseHeadings, type TocNode } from '../utils/toc'

// 제목 수준별 글자 크기 — 문서의 h1~h6 위계가 목차에서도 보이게
const LEVEL_STYLE: Record<number, string> = {
  1: 'text-sm font-semibold',
  2: 'text-[13px] font-medium',
  3: 'text-xs',
}

function TocEntry({ node, depth, onJump }: { node: TocNode; depth: number; onJump: (index: number) => void }) {
  const [open, setOpen] = useState(true)
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 pr-2 hover:bg-surface-raised ${LEVEL_STYLE[node.level] ?? 'text-[11px]'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-ink-muted"
            aria-label="토글"
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="inline-block w-[1em] shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onJump(node.index)}
          className="truncate text-left text-ink-secondary hover:text-ink"
          title={node.text}
        >
          {node.text}
        </button>
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TocEntry key={child.id} node={child} depth={depth + 1} onJump={onJump} />
          ))}
        </div>
      )}
    </div>
  )
}

export function TableOfContents({
  content,
  onJump,
  onClose,
}: {
  content: string
  onJump: (index: number) => void
  onClose: () => void
}) {
  const tree = useMemo(() => parseHeadings(content), [content])

  return (
    // 툴팁처럼 본문 위에 뜬다 — 칸 폭을 먹지 않는다. absolute 기준은 EditorPane의 본문 래퍼(relative)
    <div className="absolute right-3 top-12 z-20 hidden max-h-[calc(100%-4rem)] w-56 flex-col overflow-y-auto rounded-lg border border-edge bg-surface-deep/80 py-2 shadow-lg backdrop-blur-sm lg:flex">
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="text-xs font-semibold text-ink-muted">목차</span>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-muted hover:text-ink"
          title="목차 닫기"
          aria-label="목차 닫기"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {tree.length === 0 ? (
        <div className="px-3 text-xs text-ink-faint">제목이 없습니다</div>
      ) : (
        tree.map((node) => <TocEntry key={node.id} node={node} depth={0} onJump={onJump} />)
      )}
    </div>
  )
}
