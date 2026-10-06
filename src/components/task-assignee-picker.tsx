import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, RefreshDouble, Search, User, UserPlus } from 'iconoir-react'
import { canAutoFocusInput, useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { TASK_ASSIGNEE_LIMIT } from '../../shared/task-assignees'
import { identityColor } from '../utils/collabColor'
import type { MemberProfile } from '../api/client'
import { useTaskAssignees } from './task-assignees'

function Avatar({ member }: { member: MemberProfile }) {
  return <span className="task-assignee-avatar" style={{ '--assignee-color': identityColor(member.email) } as CSSProperties} aria-hidden="true">
    {member.avatarDataUrl ? <img src={member.avatarDataUrl} alt="" /> : member.displayName ? member.displayName.slice(0, 2).toUpperCase() : <User width={14} height={14} />}
  </span>
}
const fallback = (email: string): MemberProfile => ({ email, displayName: email.split('@')[0], avatarDataUrl: null })

export function TaskAssigneeAvatars({ assignees }: { assignees: string[] }) {
  const { members } = useTaskAssignees()
  const profiles = assignees.map(email => members.find(member => member.email === email) ?? fallback(email))
  return <>{profiles.slice(0, 3).map(member => <span key={member.email} data-tip={`${member.displayName} (${member.email})`}><Avatar member={member} /></span>)}{profiles.length > 3 && <span className="task-assignee-count">+{profiles.length - 3}</span>}</>
}

export function TaskAssigneePicker({ assignees, disabled, onChange }: { assignees: string[]; disabled: boolean; onChange: (assignees: string[]) => void }) {
  const { members, loading, error, retry } = useTaskAssignees()
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null)
  const id = useId()
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties>({})
  const profiles = [...members, ...assignees.filter(email => !members.some(member => member.email === email)).map(fallback)]
  const choices = profiles.filter(member => `${member.displayName} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()))
  const names = assignees.map(email => { const member = profiles.find(value => value.email === email); return `${member?.displayName ?? email} (${email})` }).join(', ')
  const label = `${uiText('담당자')}${names ? `: ${names}` : ''}`
  const close = () => { setOpen(false); if (popup.current?.contains(document.activeElement) || document.activeElement === document.body) trigger.current?.focus({ preventScroll: true }) }
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useOverlayDismiss(open && close, { escapePhase: 'capture', outside: () => popup.current })
  useLayoutEffect(() => { if (open) { if (canAutoFocusInput()) popup.current?.querySelector('input')?.focus({ preventScroll: true }); else popup.current?.focus({ preventScroll: true }) } }, [open])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const viewport = window.visualViewport, left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const right = left + (viewport?.width ?? innerWidth), bottom = top + (viewport?.height ?? innerHeight)
      const width = Math.min(240, right - left - 16), below = bottom - rect.bottom - 12, above = rect.top - top - 12
      const down = below >= Math.min(260, popup.current?.scrollHeight ?? 260) || below >= above
      setPosition({ left: Math.max(left + 8, Math.min(rect.left, right - width - 8)), width, maxHeight: Math.max(48, Math.min(260, down ? below : above)), ...(down ? { top: rect.bottom + 4 } : { bottom: innerHeight - rect.top + 4 }) })
    }
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !root.current?.contains(event.target as Node)) close() }
    place(); document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place) }
  }, [open, choices.length, loading, error])
  useLayoutEffect(() => { if (open) popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active, open])
  const toggle = (email: string) => { if (assignees.includes(email)) onChange(assignees.filter(value => value !== email)); else if (assignees.length < TASK_ASSIGNEE_LIMIT) onChange([...assignees, email]) }
  const avatars = <TaskAssigneeAvatars assignees={assignees} />
  if (disabled && !assignees.length) return null
  return <div ref={root} className="task-assignees">
    {disabled ? assignees.length > 0 && <span className="task-assignee-trigger" role="img" aria-label={label} data-tip={label}>{avatars}</span> : <button ref={trigger} type="button" className="task-assignee-trigger" aria-label={label} data-tip={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(value => !value); setQuery(''); setActive(0) }}>{assignees.length ? avatars : <UserPlus width={16} height={16} aria-hidden="true" />}</button>}
    {open && createPortal(<div ref={popup} className="task-assignee-picker-menu task-tag-suggestions" role="dialog" tabIndex={-1} aria-label={uiText('담당자')} style={position} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) close() }}>
      <label className="task-tag-picker-search"><Search width={15} height={15} aria-hidden="true" /><input value={query} placeholder={uiText('담당자 검색')} aria-label={uiText('담당자 검색')} aria-controls={id} aria-activedescendant={choices.length ? `${id}-${Math.min(active, choices.length - 1)}` : undefined} onChange={event => { setQuery(event.target.value); setActive(0) }} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % Math.max(1, choices.length)) }
        if (event.key === 'Enter' && choices.length) { event.preventDefault(); toggle(choices[Math.min(active, choices.length - 1)].email) }
      }} /></label>
      {loading && <p className="task-assignee-status" role="status">{uiText('불러오는 중…')}</p>}
      {error && <div className="task-assignee-status" role="alert">{uiText('담당자를 불러오지 못했습니다')} <button type="button" onClick={retry} aria-label={uiText('다시 시도')} data-tip={uiText('다시 시도')}><RefreshDouble width={14} height={14} aria-hidden="true" /></button></div>}
      {!loading && !error && !choices.length && <p className="task-assignee-status" role="status">{uiText('일치하는 사용자 없음')}</p>}
      <div id={id} role="listbox" aria-label={uiText('담당자')} aria-multiselectable="true">
        {choices.map((member, index) => <button key={member.email} id={`${id}-${index}`} className="task-assignee-option" type="button" role="option" aria-selected={assignees.includes(member.email)} data-active={index === Math.min(active, choices.length - 1)} disabled={!assignees.includes(member.email) && assignees.length >= TASK_ASSIGNEE_LIMIT} onClick={() => toggle(member.email)} onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length); popup.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[(index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]?.focus() }
        }}><Avatar member={member} /><span className="task-assignee-identity"><span>{member.displayName}</span><small>{member.email}</small></span>{assignees.includes(member.email) && <Check width={14} height={14} aria-hidden="true" />}</button>)}
      </div>
    </div>, document.body)}
  </div>
}
