import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'

type Bounds = { left: number; top: number; width: number; height: number }
type ResizeEdge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MARGIN = 12
const MIN_WIDTH = 360
const MIN_HEIGHT = 300

function initialBounds(): Bounds {
  const width = Math.min(960, Math.max(MIN_WIDTH, window.innerWidth - MARGIN * 2))
  const height = Math.min(720, Math.max(MIN_HEIGHT, window.innerHeight - 72))
  return {
    left: Math.max(MARGIN, Math.round((window.innerWidth - width) / 2)),
    top: Math.max(MARGIN, Math.round((window.innerHeight - height) / 2)),
    width,
    height,
  }
}

function clampBounds(bounds: Bounds): Bounds {
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - MARGIN * 2)
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - MARGIN * 2)
  const width = Math.min(maxWidth, Math.max(MIN_WIDTH, bounds.width))
  const height = Math.min(maxHeight, Math.max(MIN_HEIGHT, bounds.height))
  return {
    width,
    height,
    left: Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, bounds.left)),
    top: Math.max(MARGIN, Math.min(window.innerHeight - height - MARGIN, bounds.top)),
  }
}

/** Mew 위에서만 떠 있는 창. 브라우저 권한 팝업과 달리 모바일에서도 이동·크기 조절을 일관되게 제공한다. */
export function FloatingBrowserWindow({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const [bounds, setBounds] = useState<Bounds>(initialBounds)
  const gesture = useRef<{ pointerId: number; startX: number; startY: number; bounds: Bounds; edge?: ResizeEdge } | null>(null)

  useEffect(() => {
    const resize = () => setBounds((current) => clampBounds(current))
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
    }
  }, [])

  function begin(event: PointerEvent<HTMLElement>, edge?: ResizeEdge) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, bounds, edge }
  }

  function move(event: PointerEvent<HTMLElement>) {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (!current.edge) {
      setBounds(clampBounds({ ...current.bounds, left: current.bounds.left + dx, top: current.bounds.top + dy }))
      return
    }
    const edge = current.edge
    let { left, top, width, height } = current.bounds
    if (edge.includes('e')) width += dx
    if (edge.includes('s')) height += dy
    if (edge.includes('w')) { left += dx; width -= dx }
    if (edge.includes('n')) { top += dy; height -= dy }
    if (width < MIN_WIDTH && edge.includes('w')) left = current.bounds.left + current.bounds.width - MIN_WIDTH
    if (height < MIN_HEIGHT && edge.includes('n')) top = current.bounds.top + current.bounds.height - MIN_HEIGHT
    setBounds(clampBounds({ left, top, width, height }))
  }

  function end(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointerId === event.pointerId) gesture.current = null
  }

  return (
    <div className="fixed inset-0 z-[1000] pointer-events-none" aria-label="브라우저 팝업">
      <section
        className="pointer-events-auto absolute flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-2xl"
        style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
        onPointerDown={() => { /* 가장 위 오버레이로 유지할 자리 */ }}
      >
        <header
          className="flex h-9 shrink-0 touch-none select-none items-center border-b border-edge bg-surface px-3 text-xs text-ink-secondary"
          onPointerDown={begin}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <span className="font-medium text-ink">브라우저</span>
          <span className="ml-2 truncate text-[10px] text-ink-muted">Mew 서버 loopback</span>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} className="ml-auto flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink" aria-label="브라우저 닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 min-w-0 flex-1">{children}</div>
        {(['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => (
          <div
            key={edge}
            aria-hidden="true"
            className={`absolute touch-none ${edge === 'n' ? 'inset-x-2 top-0 h-2 cursor-n-resize' : edge === 's' ? 'inset-x-2 bottom-0 h-2 cursor-s-resize' : edge === 'e' ? 'inset-y-2 right-0 w-2 cursor-e-resize' : edge === 'w' ? 'inset-y-2 left-0 w-2 cursor-w-resize' : edge === 'ne' ? 'right-0 top-0 h-4 w-4 cursor-ne-resize' : edge === 'nw' ? 'left-0 top-0 h-4 w-4 cursor-nw-resize' : edge === 'se' ? 'bottom-0 right-0 h-4 w-4 cursor-se-resize' : 'bottom-0 left-0 h-4 w-4 cursor-sw-resize'}`}
            onPointerDown={(event) => begin(event, edge)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
      </section>
    </div>
  )
}
