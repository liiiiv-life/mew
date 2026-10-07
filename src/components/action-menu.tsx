import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useOverlayDismiss } from '@mew/ui'

export function ActionMenu({ x, y, onClose, children, keyboard = false, fileMenu = false }: {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
  keyboard?: boolean
  fileMenu?: boolean
}) {
  useOverlayDismiss(onClose)
  const ref = useRef<HTMLDivElement>(null)
  // 항목 개수(파일/폴더/루트)마다 실제 높이가 달라 고정 상수로는 못 잡는다 —
  // 렌더된 실측 크기로 보이는 화면과 모바일 독 사이에 배치한다.
  const [pos, setPos] = useState({ left: x, top: y, maxHeight: 0, maxWidth: 0 })

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
      // 팝오버를 닫은 이 상호작용이 그 아래 요소의 클릭(파일 열기/폴더 토글 등)까지
      // 이어지지 않도록, 뒤따라올 click 이벤트 하나를 캡처 단계에서 삼킨다.
      function swallowClick(ce: MouseEvent) {
        ce.preventDefault()
        ce.stopPropagation()
        clear()
      }
      function clear() {
        document.removeEventListener('click', swallowClick, true)
        document.removeEventListener('pointerdown', clear, true)
        clearTimeout(timer)
      }
      document.addEventListener('click', swallowClick, { capture: true, once: true })
      document.addEventListener('pointerdown', clear, { capture: true, once: true })
      const timer = setTimeout(clear, 1000)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const viewport = window.visualViewport
    const place = () => {
      const left = (viewport?.offsetLeft ?? 0) + 4
      const top = (viewport?.offsetTop ?? 0) + 4
      const right = left + (viewport?.width ?? window.innerWidth) - 8
      let bottom = top + (viewport?.height ?? window.innerHeight) - 8
      if (window.matchMedia('(width < 768px)').matches) {
        const dock = document.querySelector('.mobile-dock:not([hidden])')?.getBoundingClientRect()
        if (dock && dock.width > 0 && dock.height > 0 && dock.bottom > top) {
          bottom = Math.min(bottom, dock.top - 4)
        }
      }
      const maxHeight = Math.max(0, bottom - top)
      const maxWidth = Math.max(0, right - left)
      // Apply limits before measuring so a tall menu scrolls above the dock.
      menu.style.maxHeight = `${maxHeight}px`
      menu.style.maxWidth = `${maxWidth}px`
      menu.style.minWidth = `${Math.min(168, maxWidth)}px`
      const rect = menu.getBoundingClientRect()
      const next = {
        left: Math.max(left, Math.min(x, right - rect.width)),
        top: Math.max(top, Math.min(y, bottom - rect.height)),
        maxHeight,
        maxWidth,
      }
      setPos(previous => previous.left === next.left && previous.top === next.top
        && previous.maxHeight === maxHeight && previous.maxWidth === maxWidth ? previous : next)
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(menu)
    const dock = document.querySelector('.mobile-dock')
    if (dock) observer.observe(dock, { box: 'border-box' })
    window.addEventListener('resize', place)
    viewport?.addEventListener('resize', place)
    viewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      viewport?.removeEventListener('resize', place)
      viewport?.removeEventListener('scroll', place)
    }
  }, [x, y])

  useLayoutEffect(() => {
    if (keyboard) ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [keyboard])

  return (
    <div
      ref={ref}
      data-file-action-menu={fileMenu ? '' : undefined}
      data-action-menu
      role={keyboard ? 'menu' : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={keyboard ? (event) => {
        event.stopPropagation()
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const current = items.indexOf(event.target as HTMLButtonElement)
        let next: number
        if (event.key === 'ArrowDown') next = (current + 1) % items.length
        else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        else return
        event.preventDefault()
        items[next]?.focus()
      } : undefined}
      style={{ position: 'fixed', ...pos, minWidth: Math.min(168, pos.maxWidth), zIndex: 1300 }}
      className="overflow-y-auto overscroll-contain rounded-none border border-edge-bright bg-surface-raised text-sm"
    >
      {children}
    </div>
  )
}
