import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { canAutoFocusInput, SelectField, useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { Check, GitBranch, NavArrowDown, Plus } from 'iconoir-react'
import { fetchGitBranches, type GitBranchRef, type GitRepositoryInfo } from '../api/client'

export function GitBranchPicker({ info, project, path, disabled, busy, onAction }: {
  info: GitRepositoryInfo | null; project: string; path: string; disabled: boolean; busy: boolean
  onAction: (action: 'switch' | 'create', ref: string, name?: string) => Promise<void>
}) {
  useUiLocale()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), nameField = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false), [creating, setCreating] = useState(false)
  const [query, setQuery] = useState(''), [name, setName] = useState(''), [base, setBase] = useState('HEAD')
  const [refs, setRefs] = useState<GitBranchRef[]>([]), [loading, setLoading] = useState(false)
  const [error, setError] = useState(''), [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  useEffect(() => { if (creating && canAutoFocusInput()) nameField.current?.focus({ preventScroll: true }) }, [creating])
  const request = useRef(0), pending = useRef(false)
  const close = (restore = true) => {
    request.current++
    setOpen(false)
    if (restore) trigger.current?.focus({ preventScroll: true })
  }
  useOverlayDismiss(open ? () => close() : false)
  useEffect(() => { if (disabled) { request.current++; setOpen(false) } }, [disabled])
  useEffect(() => { request.current++; setOpen(false); setRefs([]) }, [project, path])
  useEffect(() => () => { request.current++ }, [])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect(), viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      const below = top + height - rect.bottom - 8, above = rect.top - top - 8
      const down = below >= Math.min(360, above) || below >= above
      const panelWidth = Math.min(320, width - 16)
      setPosition({ width: panelWidth, left: Math.max(left + 8, Math.min(rect.left, left + width - panelWidth - 8)),
        maxHeight: Math.max(0, down ? below : above), ...(down ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) })
    }
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      // SelectField owns a nested portal; let its own dismissal stack handle it.
      if ((target instanceof Element && target.closest('[role="listbox"]')) || trigger.current?.contains(target) || popup.current?.contains(target)) return
      close(false)
    }
    place()
    if (canAutoFocusInput()) search.current?.focus({ preventScroll: true })
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [open])
  const show = async () => {
    if (disabled || busy) return
    const version = ++request.current
    setOpen(true); setCreating(false); setQuery(''); setName(''); setBase('HEAD'); setError(''); setActive(0); setLoading(true)
    try {
      const result = await fetchGitBranches(path, project)
      if (request.current === version) setRefs(result.branches)
    } catch (err) { if (request.current === version) setError(err instanceof Error ? err.message : String(err)) }
    finally { if (request.current === version) setLoading(false) }
  }
  const branches = refs.filter(ref => ref.kind !== 'tag' && ref.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const activeIndex = Math.min(active, Math.max(0, branches.length - 1))
  useEffect(() => { if (open && !creating) popup.current?.querySelector(`[id="${id}-${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' }) }, [open, creating, id, activeIndex])
  const execute = async (action: 'switch' | 'create', ref: string, branchName?: string) => {
    if (busy || pending.current || loading) return
    pending.current = true
    const version = request.current
    setError('')
    try {
      await onAction(action, ref, branchName)
      if (version === request.current) close()
    } catch (err) { if (version === request.current) setError(err instanceof Error ? err.message : String(err)) }
    finally { pending.current = false }
  }
  const pick = (ref: GitBranchRef) => {
    if (!info?.detached && ref.ref === `refs/heads/${info?.branch}`) { close(); return }
    void execute('switch', ref.ref)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || busy || loading) return
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      setActive(event.key === 'Home' ? 0 : event.key === 'End' ? branches.length - 1 : Math.max(0, Math.min(branches.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter') { event.preventDefault(); if (branches[activeIndex]) pick(branches[activeIndex]) }
  }
  const bases = [{ value: 'HEAD', label: uiText('현재 HEAD') }, ...refs.map(ref => ({ value: ref.kind === 'tag' ? `tag:${ref.name}` : ref.name, label: ref.kind === 'tag' ? `tag: ${ref.name}` : ref.name }))]
  const baseRef = base === 'HEAD' ? 'HEAD' : refs.find(ref => (ref.kind === 'tag' ? `tag:${ref.name}` : ref.name) === base)?.ref ?? base
  return <>
    <button ref={trigger} type="button" aria-label={uiText('브랜치 선택')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={disabled || busy} title={info?.detached ? 'detached HEAD' : info?.branch ?? uiText('브랜치 선택')}
      onClick={() => open ? close() : void show()} onKeyDown={event => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); void show() } }}
      className="flex h-7 min-w-10 max-w-36 items-center gap-1 rounded px-1.5 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">
      <GitBranch width={14} height={14} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{info?.detached ? 'detached HEAD' : info?.branch ?? uiText('브랜치')}</span>
      <NavArrowDown width={12} height={12} className="shrink-0" aria-hidden="true" />
    </button>
    {open && position && createPortal(<div ref={popup} id={id} role="dialog" aria-label={uiText('브랜치 선택')} style={position}
      onKeyDown={event => { if (event.key === 'Tab') { const target = event.target as Element; if (event.shiftKey && target === popup.current?.querySelector('input') || !event.shiftKey && target === popup.current?.querySelector('[data-branch-last]')) close(false) } }}
      className="fixed z-[1200] flex flex-col overflow-y-auto overscroll-contain rounded border border-edge-bright bg-surface-raised text-xs text-ink shadow-xl">
      {error && <p role="alert" className="break-words border-b border-edge px-2.5 py-2 text-danger">{error}</p>}
      {creating ? <form className="flex flex-col gap-2 p-2.5" onSubmit={event => { event.preventDefault(); if (name.trim() && base.trim()) void execute('create', baseRef, name.trim()) }}>
        <label className="flex flex-col gap-1">{uiText('새 브랜치 이름')}<input aria-label={uiText('새 브랜치 이름')} value={name} disabled={busy} spellCheck={false} autoComplete="off"
          ref={nameField}
          onChange={event => setName(event.target.value)} className="h-8 min-w-0 rounded border border-edge-strong bg-surface px-2 text-sm focus-visible:outline-2 focus-visible:outline-accent" /></label>
        <div className="flex flex-col gap-1"><span>{uiText('기준 브랜치·태그·커밋')}</span><SelectField label={uiText('기준 브랜치·태그·커밋')} editable value={base} disabled={busy}
          options={bases.filter(option => base === 'HEAD' || option.value.toLocaleLowerCase().includes(base.toLocaleLowerCase()))} portalContainer={popup.current} onChange={setBase} /></div>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => { setCreating(false); setError(''); if (canAutoFocusInput()) window.setTimeout(() => search.current?.focus(), 0) }} className="h-8 rounded px-2 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent">{uiText('취소')}</button>
          <button data-branch-last type="submit" disabled={busy || !name.trim() || !base.trim()} className="h-8 rounded bg-accent px-2 text-ink-on-accent hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40">{busy ? uiText('전환 중…') : uiText('생성 후 전환')}</button>
        </div>
      </form> : <>
        <div className="p-2"><input ref={search} role="combobox" aria-label={uiText('브랜치 검색')} aria-expanded="true" aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={branches.length ? `${id}-${activeIndex}` : undefined} disabled={busy} value={query} spellCheck={false} autoComplete="off" placeholder={uiText('브랜치 검색')}
          onChange={event => { setQuery(event.target.value); setActive(0) }} onKeyDown={onKeyDown}
          className="h-8 w-full rounded border border-edge-strong bg-surface px-2 text-sm placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-accent" /></div>
        <div id={`${id}-list`} role="listbox" aria-label={uiText('브랜치')} aria-busy={loading} className="max-h-64 shrink-0 overflow-y-auto overscroll-contain">
          {branches.map((ref, index) => <button type="button" tabIndex={-1} key={ref.ref} id={`${id}-${index}`} role="option" aria-selected={!info?.detached && ref.ref === `refs/heads/${info?.branch}`} disabled={busy || loading}
            onPointerDown={event => event.preventDefault()} onClick={() => pick(ref)} title={ref.name}
            className={`flex min-h-9 w-full items-center gap-2 px-2.5 text-left hover:bg-surface-hover pointer-coarse:min-h-11 ${index === activeIndex ? 'bg-surface-hover' : ''}`}>
            <span className="min-w-0 flex-1 truncate">{ref.name}</span>
            {ref.kind === 'remote' && <span className="shrink-0 text-ink-muted">{uiText('원격')}</span>}
            <span className="w-4 shrink-0">{!info?.detached && ref.ref === `refs/heads/${info?.branch}` && <Check width={14} height={14} aria-hidden="true" />}</span>
          </button>)}
          {(loading || !branches.length) && <p role="status" className="px-2.5 py-3 text-ink-secondary">{loading ? uiText('브랜치를 불러오는 중…') : uiText('브랜치가 없습니다')}</p>}
        </div>
        <button data-branch-last type="button" disabled={busy || loading || !!error} onClick={() => setCreating(true)} className="flex min-h-9 items-center gap-1.5 border-t border-edge px-2.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11">
          <Plus width={14} height={14} aria-hidden="true" />{uiText('새 브랜치')}
        </button>
      </>}
    </div>, document.body)}
  </>
}
