import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
// @ 멘션 툴팁 (문서 검색 → 선택 시 링크 삽입)
export interface MentionResult {
  path: string
  label: string
}

export function MentionTooltip({
  position,
  results,
  selectedIndex,
  onSelect,
}: {
  position: { top: number; left: number }
  results: MentionResult[]
  selectedIndex: number
  onSelect: (result: MentionResult) => void
}) {
  useUiLocale()
  return (
    <div
      style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 1000 }}
      className="max-h-64 w-72 overflow-y-auto rounded border border-edge-bright bg-surface-raised p-1 shadow-lg"
    >
      {results.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-ink-muted">{uiText("일치하는 문서 없음")}</div>
      ) : (
        results.map((result, i) => (
          <button
            key={result.path}
            type="button"
            onMouseDown={() => onSelect(result)}
            className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${
              i === selectedIndex ? 'bg-accent text-ink-on-accent' : 'text-ink hover:bg-surface-hover'
            }`}
          >
            <div className="truncate font-medium">{result.label}</div>
            <div className="truncate text-[10px] opacity-70">{result.path}</div>
          </button>
        ))
      )}
    </div>
  )
}
