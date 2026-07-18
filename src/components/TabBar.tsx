export interface TabBarItem {
  path: string
  preview: boolean
}

export function TabBar({
  tabs,
  activePath,
  presence,
  onActivate,
  onPin,
  onClose,
}: {
  tabs: TabBarItem[]
  activePath: string | null
  presence: Record<string, number>
  onActivate: (path: string) => void
  onPin: (path: string) => void
  onClose: (path: string) => void
}) {
  return (
    <div className="flex h-9 items-center overflow-x-auto border-b border-edge bg-surface-deep">
      {tabs.map((tab) => {
        const isActive = tab.path === activePath
        const fileName = tab.path.split('/').pop() ?? tab.path
        const sessionCount = presence[tab.path] ?? 0
        return (
          <div
            key={tab.path}
            className={`group flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-edge px-3 text-xs select-none ${
              isActive ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
            }`}
            onClick={() => onActivate(tab.path)}
            onDoubleClick={() => onPin(tab.path)}
          >
            <span className={`max-w-[150px] truncate ${tab.preview ? 'italic' : ''}`}>{fileName}</span>
            {sessionCount >= 1 && (
              <span
                className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-medium text-ink-inverse"
                title={`이 문서를 ${sessionCount}개 세션에서 열어두고 있습니다`}
              >
                {sessionCount}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.path)
              }}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
