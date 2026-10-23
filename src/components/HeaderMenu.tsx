// 헤더 오른쪽 도구 버튼들을 하나로 접는 햄버거 메뉴.
import { useRef, useState, type ReactNode } from 'react'
import { openDropdownOnArrow, HoverTipLayer } from '@mew/ui'
import { HeaderMenuPopup } from './header-menu-popup'
import { headerIconControlClassName } from './header-control'
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
    <div className="relative flex items-center">
      <HoverTipLayer className="contents" placement="bottom"><button
        ref={trigger}
        type="button"
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect()
          setPosition({ x: rect.left, y: rect.bottom + 4 }); setOpen(v => !v)
        }}
        className={headerIconControlClassName}
        data-tip={t('common.menu')}
        aria-label={t('common.menu')}
        onKeyDown={openDropdownOnArrow}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button></HoverTipLayer>
      {open && <HeaderMenuPopup x={position.x} y={position.y} label={t('common.menu')}
        trigger={trigger.current} items={items} onClose={() => setOpen(false)} />}
    </div>
  )
}
