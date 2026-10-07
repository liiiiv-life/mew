import { cloneElement, isValidElement, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ReactElement, type SVGProps, type Ref, type ButtonHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from './useOverlayDismiss'

const MenuContext = createContext<(() => void) | null>(null)

export type ActionMenuProps = {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
  label?: string
  trigger?: HTMLElement | SVGElement | null
  portalContainer?: HTMLElement | null
  ref?: Ref<HTMLDivElement>
  /** Compatibility marker for file explorer integrations. */
  fileMenu?: boolean
}

/** Shared action popup. Feature wrappers supply actions, never menu styles. */
export function ActionMenu({ x, y, onClose, children, label, trigger, portalContainer, ref: forwardedRef, fileMenu = false }: ActionMenuProps) {
  const marker = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const previous = useRef<HTMLElement | SVGElement | null>(trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const close = (restore = true) => {
    if (restore && previous.current?.isConnected) previous.current.focus({ preventScroll: true })
    closeRef.current()
  }
  useOverlayDismiss(container ? close : false)
  useLayoutEffect(() => {
    const origin = marker.current
    setContainer(portalContainer ?? origin?.closest<HTMLElement>('[role="dialog"]') ?? (document.fullscreenElement?.contains(origin) ? document.fullscreenElement as HTMLElement : document.body))
  }, [portalContainer])
  const ref = useRef<HTMLDivElement>(null)
  // 항목 개수(파일/폴더/루트)마다 실제 높이가 달라 고정 상수로는 못 잡는다 —
  // 렌더된 실측 크기로 보이는 화면과 모바일 독 사이에 배치한다.
  const [pos, setPos] = useState({ left: x, top: y, maxHeight: 0, maxWidth: 0 })

  useEffect(() => {
    if (!container) return
    function onDown(e: PointerEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      e.preventDefault()
      e.stopPropagation()
      close()
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
  }, [container])

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
      menu.style.minWidth = `${Math.min(parseFloat(getComputedStyle(menu).getPropertyValue('--mew-action-menu-min-width')) || 168, maxWidth)}px`
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
  }, [x, y, container])

  useLayoutEffect(() => {
    if (!container) return
    ref.current?.querySelector<HTMLButtonElement>('[data-action-menu-item]:not(:disabled)')?.focus({ preventScroll: true })
  }, [container])

  const menu = (
    <MenuContext.Provider value={() => close()}>
    <div
      ref={element => {
        ref.current = element
        if (typeof forwardedRef === 'function') forwardedRef(element)
        else if (forwardedRef) forwardedRef.current = element
      }}
      data-file-action-menu={fileMenu ? '' : undefined}
      data-action-menu
      role="menu"
      aria-label={label}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[data-action-menu-item]:not(:disabled)') ?? [])
        const current = items.indexOf(document.activeElement as HTMLButtonElement)
        let next: number
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % items.length
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (current - 1 + items.length) % items.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        else if (event.key === 'Tab') { event.preventDefault(); close(); return }
        else return
        event.preventDefault()
        items[next]?.focus()
      }}
      style={pos}
      className="mew-action-menu"
    >
      {children}
    </div>
    </MenuContext.Provider>
  )
  return <><span ref={marker} hidden />{container && createPortal(menu, container)}</>
}

export type ActionMenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  icon?: ReactNode
  hint?: ReactNode
  danger?: boolean
  checked?: boolean
  closeOnSelect?: boolean
}

export function ActionMenuItem({ icon, hint, danger, checked, closeOnSelect = true, children, onClick, ...props }: ActionMenuItemProps) {
  const close = useContext(MenuContext)
  return <button {...props} type="button" role={props.role ?? (checked === undefined ? 'menuitem' : 'menuitemcheckbox')}
    aria-checked={checked} data-action-menu-item data-danger={danger || undefined} className="mew-action-menu-item"
    onClick={event => { if (closeOnSelect) close?.(); onClick?.(event) }}>
    {isValidElement(icon) ? cloneElement(icon as ReactElement<SVGProps<SVGSVGElement>>, { 'aria-hidden': true, focusable: false }) : icon}{children}{hint && <span className="mew-action-menu-hint">{hint}</span>}
  </button>
}

export function ActionMenuSeparator() {
  return <div role="separator" className="mew-action-menu-separator" />
}
