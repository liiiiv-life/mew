// 헤더 오른쪽 도구 버튼들을 하나로 접는 햄버거 메뉴.
// 아이콘만 늘어놓으면 모바일에서 프로젝트 탭 자리를 다 먹는다 — 버튼은 하나만 두고,
// 안에서는 아이콘과 이름을 같이 보여 무슨 기능인지 눌러 보지 않아도 알게 한다.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { useI18n } from '../i18n'

export type HeaderMenuItem = {
  id: string
  label: string
  icon: ReactNode
  onSelect: () => void
  /** 단축키처럼 이름 오른쪽에 흐리게 붙는 꼬리표 */
  hint?: string
  disabled?: boolean
  /** 켜고 끄는 항목이 지금 켜져 있는지(에이전트 창 등) */
  active?: boolean
}

export function HeaderMenu({ items }: { items: HeaderMenuItem[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // Esc·모바일 뒤로가기가 이 메뉴부터 닫게 한다(다른 오버레이와 같은 스택)
  useOverlayDismiss(open && close)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 items-center justify-center gap-2 rounded border border-edge-strong px-2 hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink md:h-9 md:px-3 md:text-sm md:font-medium ${open ? 'bg-surface-raised text-ink' : ''}`}
        title={t('common.menu')}
        aria-label={t('common.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="hidden md:inline">{t('common.menu')}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('common.menu')}
          className="absolute right-0 top-full z-[1050] mt-1 min-w-[12rem] whitespace-nowrap rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:opacity-40 disabled:hover:bg-transparent ${
                item.active ? 'text-ink' : 'text-ink-secondary'
              }`}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.hint && <span className="shrink-0 text-xs text-ink-muted">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
