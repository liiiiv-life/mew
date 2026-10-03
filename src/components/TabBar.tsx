import { PanelTitle } from './panel-title'
import { useDragReorder } from '@mew/ui'
import { PresenceDots } from './PresenceDots'
import { externalFileName, isExternalTabPath } from '../utils/externalFiles'

export interface TabBarItem {
  path: string
  preview: boolean
  label?: string
}

export function TabBar({
  tabs,
  activePath,
  presence,
  onActivate,
  onPin,
  onClose,
  onReorder,
  onDragMove,
  onDrop,
}: {
  tabs: TabBarItem[]
  activePath: string | null
  presence: Record<string, string[]>
  onActivate: (path: string) => void
  onPin: (path: string) => void
  onClose: (path: string) => void
  onReorder: (from: number, to: number) => void
  /** 탭을 줄 바깥으로 끌고 있는 동안 — 편집 칸 위면 그 자리가 무엇이 될지 미리 보인다 */
  onDragMove?: (path: string, x: number, y: number) => void
  /** 탭을 놓았을 때 — 다른 칸이면 옮기기, 칸 가장자리면 분할 */
  onDrop?: (path: string, x: number, y: number) => void
}) {
  const drag = useDragReorder({
    onReorder,
    immediateMouseDrag: true,
    onDragMove: (i, x, y) => onDragMove?.(tabs[i]?.path ?? '', x, y),
    onDrop: (i, x, y) => onDrop?.(tabs[i]?.path ?? '', x, y),
  })

  return (
    <div className="flex h-9 min-w-0 flex-1 items-center border-b border-edge bg-surface-deep">
      <div className="no-scrollbar flex h-full min-w-0 flex-1 items-center overflow-x-auto">
        {tabs.length === 0 && <PanelTitle kind={'editor'} />}
        {tabs.map((tab, i) => {
          const isActive = tab.path === activePath
          const fileName = tab.label ?? (isExternalTabPath(tab.path)
              ? externalFileName(tab.path)
              : tab.path.split('/').pop() ?? tab.path)
          return (
            <div
              key={tab.path}
              {...drag.getItemProps(i)}
              role="tab" tabIndex={0} aria-selected={isActive} aria-keyshortcuts="Shift+Enter"
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onActivate(tab.path) } }}
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
              <span title={fileName} className={`max-w-[150px] truncate ${tab.preview ? 'italic' : ''}`}>{fileName}</span>
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
