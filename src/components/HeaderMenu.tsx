// 헤더 오른쪽 도구 버튼들을 하나로 접는 햄버거 메뉴.
// 아이콘만 늘어놓으면 모바일에서 프로젝트 탭 자리를 다 먹는다 — 버튼은 하나만 두고,
// 안에서는 아이콘과 이름을 같이 보여 무슨 기능인지 눌러 보지 않아도 알게 한다.
import { useRef, useState, type ReactNode } from 'react'
import { ActionMenu, ActionMenuItem } from '@mew/ui'
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
  const trigger = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  if (items.length === 0) return null

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect()
          setPosition({ x: rect.left, y: rect.bottom + 4 }); setOpen(v => !v)
        }}
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
      {open && <ActionMenu x={position.x} y={position.y} label={t('common.menu')} trigger={trigger.current} onClose={() => setOpen(false)}>
        {items.map(item => <ActionMenuItem key={item.id} icon={item.icon} hint={item.hint} disabled={item.disabled}
          checked={item.active} onClick={item.onSelect}>{item.label}</ActionMenuItem>)}
      </ActionMenu>}
    </div>
  )
}
