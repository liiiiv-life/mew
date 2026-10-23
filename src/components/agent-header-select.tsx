import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { canAutoFocusInput, useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'

/**
 * 헤더의 모델·권한 모드 선택 — OS 기본 <select> 대신 쓰는 자체 드롭다운.
 * 입력 바로 위 설정 줄에서 위로 펼친다. 본문 컨테이너의 overflow와 프로젝트 탭바보다 위에
 * 보여야 하므로 목록만 document.body 포털로 낸다.
 */
export function HeaderSelect({
  value,
  options,
  onPick,
  title,
  trigger,
  searchable,
  disabled,
  className,
  caretEnd = false,
}: {
  value: string
  options: { id: string; label: string }[]
  onPick: (id: string) => void
  title: string
  /** 버튼에 이름 대신 그릴 것(런타임 아이콘) */
  trigger?: ReactNode
  /** 목록이 길 때(모델) — 열리면 검색 입력이 먼저 뜬다 */
  searchable?: boolean
  disabled?: boolean
  className?: string
  /** 넓게 채우는 선택기(모델)는 화살표를 버튼 끝에 붙인다. */
  caretEnd?: boolean
}) {
  useUiLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const listId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState<{ left: number; bottom: number; width: number; maxHeight: number } | null>(null)
  const close = useCallback(() => { setOpen(false); buttonRef.current?.focus({ preventScroll: true }) }, [])
  // Esc·모바일 뒤로가기가 패널 대신 이 드롭다운을 닫게 한다
  useOverlayDismiss(open && close)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    const placeMenu = () => {
      const bounds = buttonRef.current?.getBoundingClientRect()
      if (!bounds) return
      // 위쪽에 남은 공간만 목록의 최대 높이로 쓴다. 따라서 화면 밖으로 넘어가지 않고 목록만 스크롤된다.
      const gap = 8
      setMenuPosition({
        left: Math.max(gap, bounds.left),
        bottom: Math.max(gap, window.innerHeight - bounds.top + gap),
        width: bounds.width,
        maxHeight: Math.max(48, bounds.top - gap * 2),
      })
    }
    placeMenu()
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    window.visualViewport?.addEventListener('resize', placeMenu)
    window.visualViewport?.addEventListener('scroll', placeMenu)
    return () => {
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
      window.visualViewport?.removeEventListener('resize', placeMenu)
      window.visualViewport?.removeEventListener('scroll', placeMenu)
    }
  }, [open])

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useEffect(() => {
    if (open) menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active, query, menuPosition])

  const current = options.find((o) => o.id === value)
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)) : options
  const activeIndex = Math.max(0, shown.findIndex(option => option.id === active))
  const pick = (id: string) => { if (id !== value) onPick(id); close() }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Tab') { setOpen(false); return }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!open && step) {
      event.preventDefault(); event.stopPropagation()
      const selected = options.findIndex(option => option.id === value)
      const index = (selected >= 0 ? selected : step > 0 ? -1 : options.length) + step
      if (options[index]) pick(options[index].id)
    } else if (open && (step || event.key === 'Home' || event.key === 'End' || event.key === 'Enter' || (event.key === ' ' && event.target === buttonRef.current))) {
      if ((event.key === 'Home' || event.key === 'End') && event.target instanceof HTMLInputElement) return
      event.preventDefault(); event.stopPropagation()
      if (step || event.key === 'Home' || event.key === 'End') {
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? shown.length - 1 : (activeIndex + step + shown.length) % shown.length
        setActive(shown[index]?.id ?? null)
      } else if (shown[activeIndex]) pick(shown[activeIndex].id)
    }
  }
  return (
    <div ref={ref} className={`relative min-w-0 ${className ?? ''} ${open ? 'z-50' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setQuery('')
          setActive(value)
          setOpen((v) => !v)
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-label={title}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && shown[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs hover:bg-surface-raised hover:text-ink ${
          open ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary disabled:cursor-default disabled:opacity-70'
        }`}
      >
        {trigger ?? <span className={caretEnd ? 'min-w-0 flex-1 truncate' : 'truncate'}>{current?.label ?? value}</span>}
        <span className={caretEnd ? 'ml-auto shrink-0' : 'shrink-0'}><CaretGlyph dir={open ? 'down' : 'up'} /></span>
      </button>
      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={listId}
          onKeyDown={onKeyDown}
          role="listbox"
          aria-label={title}
          className="fixed z-[1201] flex flex-col overflow-hidden whitespace-nowrap rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl"
          style={{ left: `${menuPosition.left}px`, bottom: `${menuPosition.bottom}px`, minWidth: `${menuPosition.width}px`, maxHeight: `${menuPosition.maxHeight}px` }}
        >
          {/* 모델 수가 많아도 화면에 맞춰 목록 자체만 스크롤한다. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {shown.map((option, index) => (
              <button
                key={option.id}
                type="button"
                id={`${listId}-${index}`}
                data-active={index === activeIndex || undefined}
                onFocus={() => setActive(option.id)}
                role="option"
                aria-selected={option.id === value}
                onClick={() => pick(option.id)}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-hover ${index === activeIndex ? 'bg-surface-hover' : ''} ${option.id === value ? 'text-ink' : 'text-ink-secondary'}`}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span className="flex w-3.5 shrink-0 items-center justify-center">{option.id === value && <CheckGlyph />}</span>
              </button>
            ))}
            {shown.length === 0 && <div className="px-2.5 py-1.5 text-xs text-ink-muted">{uiText("결과 없음")}</div>}
          </div>
          {searchable && (
            <input
              autoFocus={canAutoFocusInput()}
              value={query}
              role="combobox"
              aria-label={uiText('검색')}
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={shown[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              onChange={(e) => { setQuery(e.target.value); setActive(null) }}
              placeholder={uiText("검색")}
              className="mx-1 mt-1 w-[calc(100%-0.5rem)] rounded bg-surface px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-muted"
            />
          )}
        </div>
      , document.body)}
    </div>
  )
}


function CaretGlyph({ dir }: { dir: 'right' | 'down' | 'up' }) {
  useUiLocale()
  const rotate = dir === 'down' ? 'rotate-90' : dir === 'up' ? '-rotate-90' : ''
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${rotate}`}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}


function CheckGlyph() {
  useUiLocale()
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 12 5 5L20 6" />
    </svg>
  )
}
