import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Group, Trash, User, Xmark } from 'iconoir-react'
import { useOverlayDismiss } from '@mew/ui'
import type { AccessRow } from '../../shared/access-policy'
import { uiText } from '@mew/ui/i18n-core'
import { useI18n } from '../i18n'
import { AccountRoleSelect } from './account-role-select'

interface AccountControls {
  onRoleChange: (subject: string, role: AccessRow['role']) => Promise<void>
  onDelete: (subject: string) => Promise<void>
  disabled: boolean
  lastOwner: boolean
}

function AccountIcon({ account, onRoleChange, onDelete, disabled, lastOwner }: { account: AccessRow } & AccountControls) {
  const { t } = useI18n()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [position, setPosition] = useState<CSSProperties>({})
  const name = account.subject === 'guest' ? account.displayName : `${account.displayName} (${account.subject})`
  const close = () => { if (!busy) { setOpen(false); setConfirming(false); setError('') } }
  useOverlayDismiss(open && close, { outside: () => popup.current, outsideIgnore: () => trigger.current })
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = (viewport?.offsetLeft ?? 0) + 8, top = (viewport?.offsetTop ?? 0) + 8
      const width = (viewport?.width ?? window.innerWidth) - 16
      const bottom = top + (viewport?.height ?? window.innerHeight) - 16
      const popupWidth = Math.min(288, width)
      const height = popup.current?.getBoundingClientRect().height ?? 0
      setPosition({ width: popupWidth, maxHeight: bottom - top,
        left: Math.max(left, Math.min(rect.left + rect.width / 2 - popupWidth / 2, left + width - popupWidth)),
        top: Math.max(top, Math.min(rect.bottom + 4, bottom - height)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [open, confirming, error])
  async function act(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() }
    catch (err) { setError(err instanceof Error ? err.message : t('access.saveFailed')) }
    finally { setBusy(false) }
  }
  const showAvatar = account.subject !== 'guest' && account.avatarDataUrl && account.avatarDataUrl !== failedAvatar
  const Icon = account.subject === 'guest' ? Group : User
  return <>
    <button ref={trigger} type="button" aria-label={name} aria-expanded={open} aria-controls={open ? id : undefined} data-tip={name}
      onClick={() => { if (open) close(); else setOpen(true) }}
      className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-surface focus-visible:ring-2 focus-visible:ring-accent ${open ? 'bg-accent/15 text-ink ring-2 ring-accent' : 'bg-surface-raised text-ink-secondary hover:ring-2 hover:ring-edge-bright hover:text-ink'}`}>
      {showAvatar
        ? <img src={account.avatarDataUrl!} alt="" className="h-9 w-9 rounded-full object-cover" onError={() => setFailedAvatar(account.avatarDataUrl)} />
        : <Icon width={18} height={18} aria-hidden="true" />}
    </button>
    {open && createPortal(<div ref={popup} id={id} role="region" aria-label={`${t('access.account')}: ${account.displayName}`} style={position}
      className="mew-dialog fixed z-[1300] overflow-auto rounded-xl border border-edge-bright bg-surface p-3 text-left text-sm font-normal text-ink shadow-xl">
      <div className="flex items-start gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-raised text-ink-secondary" aria-hidden="true">
          {showAvatar ? <img src={account.avatarDataUrl!} alt="" className="h-full w-full object-cover" onError={() => setFailedAvatar(account.avatarDataUrl)} /> : <Icon width={20} height={20} />}
        </div>
        <div className="min-w-0 flex-1 py-0.5">
          <div className="select-text break-words font-semibold text-ink-bright">{account.displayName}</div>
          {account.subject !== 'guest' && <div className="select-text mt-0.5 break-all text-xs text-ink-secondary">{account.subject}</div>}
        </div>
        <button type="button" aria-label={t('common.close')} data-tip={t('common.close')} disabled={busy} onClick={close} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"><Xmark width={14} height={14} aria-hidden="true" /></button>
      </div>
      {account.subject !== 'guest' && <>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-edge pt-3">
          <span className="text-xs text-ink-secondary">{t('access.role')}</span>
          <AccountRoleSelect iconOnly={false} className="w-32" portalContainer={popup.current} popupClassName="z-[1400]" label={`${account.subject} ${uiText('역할 변경')}`} value={account.role} disabled={busy || disabled || lastOwner}
            onChange={role => void act(() => onRoleChange(account.subject, role))} />
        </div>
        {lastOwner && <p className="mt-2 text-xs text-ink-secondary">{uiText('마지막 owner 계정은 유지해야 합니다.')}</p>}
        <div className="mt-3 border-t border-edge pt-2">
          {confirming ? <>
            <p className="mb-2 text-xs leading-relaxed text-ink-secondary">{uiText('계정과 로그인 권한을 삭제합니다. 프로젝트 파일과 작업 기록은 유지됩니다.')}</p>
            <div className="flex items-center gap-1">
              <button type="button" disabled={busy || disabled} onClick={() => void act(() => onDelete(account.subject))} className="flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-danger-strong px-2 text-xs font-medium text-ink-on-danger hover:bg-danger disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent">{busy ? t('access.saving') : uiText('삭제 확인')}</button>
              <button type="button" disabled={busy} aria-label={uiText('삭제 취소')} data-tip={uiText('취소')} onClick={() => { setConfirming(false); setError('') }} className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"><Xmark width={16} height={16} aria-hidden="true" /></button>
            </div>
          </> : <button type="button" disabled={busy || disabled || lastOwner} onClick={() => setConfirming(true)} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-xs text-danger hover:bg-danger/10 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent"><Trash width={16} height={16} aria-hidden="true" />{uiText('계정 삭제')}</button>}
        </div>
        {error && <p role="alert" className="select-text mt-2 break-words text-xs text-danger">{error}</p>}
      </>}
    </div>, trigger.current?.closest('[role="dialog"]') ?? document.body)}
  </>
}

export function AccountColumnHeaders({ accounts, onRoleChange, onDelete, disabled }: { accounts: AccessRow[] } & Omit<AccountControls, 'lastOwner'>) {
  const { t } = useI18n()
  return <thead><tr>
    <th scope="col" className="sticky left-0 top-0 z-20 w-32 min-w-32 max-w-32 border-b border-r border-edge bg-surface-raised px-3 py-2 text-left text-xs font-medium">{t('access.account')}</th>
    {accounts.map(account => <th key={account.subject} scope="col" className="sticky top-0 z-10 w-16 min-w-16 border-b border-edge bg-surface-raised px-1 py-2">
      <AccountIcon account={account} onRoleChange={onRoleChange} onDelete={onDelete} disabled={disabled} lastOwner={account.role === 'owner' && accounts.filter(row => row.role === 'owner').length === 1} />
    </th>)}
  </tr></thead>
}
