import { useDragReorder } from '@mew/ui'
import { PresenceDots } from './PresenceDots'

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
  onReorder,
}: {
  tabs: TabBarItem[]
  activePath: string | null
  presence: Record<string, string[]>
  onActivate: (path: string) => void
  onPin: (path: string) => void
  onClose: (path: string) => void
  onReorder: (from: number, to: number) => void
}) {
  const drag = useDragReorder({ onReorder })

  return (
    <div className="flex h-9 items-center border-b border-edge bg-surface-deep">
      <div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto">
        {tabs.map((tab, i) => {
          const isActive = tab.path === activePath
          const fileName = tab.path.split('/').pop() ?? tab.path
          return (
            <div
              key={tab.path}
              {...drag.getItemProps(i)}
              className={`group flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-edge px-3 text-xs select-none [-webkit-touch-callout:none] ${
                isActive ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
              } ${drag.dragIndex === i ? 'opacity-70 ring-1 ring-inset ring-accent' : ''}`}
              onClick={() => {
                if (drag.consumeClick()) return
                onActivate(tab.path)
              }}
              onDoubleClick={() => onPin(tab.path)}
              onContextMenu={(e) => {
                // 터치 길게누르기가 드래그로 예약된 동안 Android 네이티브 메뉴가 끼어들지 않게
                if (drag.dragIndex !== null) e.preventDefault()
              }}
            >
              <span className={`max-w-[150px] truncate ${tab.preview ? 'italic' : ''}`}>{fileName}</span>
              <PresenceDots colors={presence[tab.path] ?? []} />
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
    </div>
  )
}
