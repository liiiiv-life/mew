import { Crown, Group, ShieldCheck, User } from 'iconoir-react'
import { SelectField } from '@mew/ui'
import type { AccessRow } from '../../shared/access-policy'

export function AccountRoleIcon({ role }: { role: AccessRow['role'] }) {
  const Icon = role === 'owner' ? Crown : role === 'manager' ? ShieldCheck : role === 'guest' ? Group : User
  return <Icon width={18} height={18} aria-hidden="true" />
}

const ACCOUNT_ROLE_OPTIONS = (['member', 'manager', 'owner'] as const).map(value => ({
  value, label: value, leading: <AccountRoleIcon role={value} />,
}))

export function AccountRoleSelect({ label, value, disabled, onChange, iconOnly = true, className, portalContainer, popupClassName }: {
  label: string
  value: AccessRow['role']
  disabled: boolean
  onChange: (role: AccessRow['role']) => void
  iconOnly?: boolean
  className?: string
  portalContainer?: HTMLElement | null
  popupClassName?: string
}) {
  if (value === 'guest') return <span aria-label="guest" data-tip="guest" className="mx-auto flex h-9 w-9 items-center justify-center text-ink-secondary pointer-coarse:h-11 pointer-coarse:w-11"><AccountRoleIcon role={value} /></span>
  if (!iconOnly) return <SelectField compact label={label} value={value} disabled={disabled} onChange={role => onChange(role as AccessRow['role'])}
    className={className} portalContainer={portalContainer} popupClassName={popupClassName} popupWidth={160} options={ACCOUNT_ROLE_OPTIONS} />
  return <SelectField compact label={`${label}: ${value}`} value={value} disabled={disabled} onChange={role => onChange(role as AccessRow['role'])}
    className="mx-auto w-9 pointer-coarse:w-11" popupWidth={160} options={ACCOUNT_ROLE_OPTIONS}
    triggerContent={<AccountRoleIcon role={value} />}
    triggerClassName="flex h-9 w-9 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:w-11" />
}
