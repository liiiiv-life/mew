import { useCallback, useEffect, useRef, useState } from 'react'
import { SelectField } from '@mew/ui'
import { Undo } from 'iconoir-react'
import { FEATURES, GUEST_FEATURES, type AccessSettings, type Feature } from '../../shared/access-policy'
import { fetchAccessSettings, fetchAccessPath, saveFeatureAccess, saveFileAccess, type AccessPathSettings, type AdminUser, type Role } from '../api/client'
import { uiText } from '@mew/ui/i18n-core'
import { useI18n } from '../i18n'
import { AccountColumnHeaders } from './account-column-headers'
import { AccountRoleSelect } from './account-role-select'

export function AccountAccessMatrix({ users, onRoleChange, onDelete }: { users: AdminUser[]; onDelete: (email: string) => Promise<void>; onRoleChange: (email: string, role: Role) => Promise<void> }) {
  const { t } = useI18n()
  const [settings, setSettings] = useState<AccessSettings | null>(null)
  const [tab, setTab] = useState<'features' | 'files'>('features')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [project, setProject] = useState('.workspace')
  const [selectedPath, setSelectedPath] = useState('')
  const [pathInput, setPathInput] = useState('')
  const [pathSettings, setPathSettings] = useState<AccessPathSettings | null>(null)
  const request = useRef(0)
  useEffect(() => {
    let cancelled = false
    fetchAccessSettings().then(value => { if (!cancelled) setSettings(value) }).catch(err => { if (!cancelled) setError(err.message || t('access.loadFailed')) })
    return () => { cancelled = true }
  }, [users, t])
  const loadPath = useCallback(async () => {
    const version = ++request.current
    setPathSettings(null)
    try { const result = await fetchAccessPath(project, selectedPath); if (version === request.current) setPathSettings(result) }
    catch (err) { if (version === request.current) setError(err instanceof Error ? err.message : t('access.loadFailed')) }
  }, [project, selectedPath, t])
  const cancelPathRequest = useCallback(() => { request.current++ }, [])
  useEffect(() => {
    if (tab === 'files') { void loadPath(); setPathInput(selectedPath) }
    return cancelPathRequest
  }, [tab, loadPath, selectedPath, cancelPathRequest])
  async function mutate(action: () => Promise<void>) {
    if (busy) return
    setBusy(true); setSaved(false); setError('')
    try { await action(); setSaved(true) }
    catch (err) { setError(err instanceof Error ? err.message : t('access.saveFailed')) }
    finally { setBusy(false) }
  }
  function toggle(subject: string, feature: Feature, enabled: boolean | null) {
    void mutate(async () => { setSettings(await saveFeatureAccess(subject, feature, enabled)) })
  }
  async function changeRole(subject: string, role: Role) {
    await onRoleChange(subject, role)
    setSettings(await fetchAccessSettings())
  }
  async function deleteAccount(subject: string) {
    await onDelete(subject)
    setSettings(current => current ? { ...current, rows: current.rows.filter(row => row.subject !== subject) } : current)
    if (tab === 'files') await loadPath()
  }
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="flex items-center gap-1" role="tablist" aria-label={t('admin.title')}>
      {(['features', 'files'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} disabled={busy} onClick={() => { setTab(value); setError('') }} className={`min-h-9 rounded-md px-3 text-xs ${tab === value ? 'bg-surface-raised text-ink-bright font-semibold' : 'text-ink-secondary hover:bg-surface-hover hover:text-ink'}`}>{t(`access.${value}`)}</button>)}
      <span role="status" className="ml-auto shrink-0 text-xs text-ink-secondary">{busy ? t('access.saving') : saved ? t('access.saved') : ''}</span>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!settings ? <p role="status" className="py-5 text-sm text-ink-secondary">{t('common.loading')}</p> : tab === 'features' ? <>
      <div className="min-h-0 overflow-auto rounded-lg border border-edge" role="tabpanel">
        <table className="w-max border-separate border-spacing-0 text-sm">
          <AccountColumnHeaders accounts={settings.rows} onRoleChange={changeRole} onDelete={deleteAccount} disabled={busy} />
          <tbody>
            <tr>
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-edge bg-surface px-3 py-1 text-left text-xs font-medium">{t('access.role')}</th>
              {settings.rows.map(row => <td key={row.subject} className="border-b border-edge py-1 text-center">
                <AccountRoleSelect label={`${row.subject} ${t('access.role')}`} value={row.role}
                  disabled={busy || (row.role === 'owner' && settings.rows.filter(account => account.role === 'owner').length === 1)}
                  onChange={value => void mutate(async () => { await onRoleChange(row.subject, value); setSettings(await fetchAccessSettings()) })} />
              </td>)}
            </tr>
            {FEATURES.map(feature => <tr key={feature} className="hover:bg-surface-raised/40">
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-edge bg-surface px-3 text-left text-xs font-medium">{t(`access.${feature}`)}</th>
              {settings.rows.map(row => {
              const locked = row.subject === 'guest' && !GUEST_FEATURES.includes(feature)
              return <td key={row.subject} className="border-b border-edge px-1 text-center">
                <div className={`relative flex items-center ${row.overrides[feature] !== undefined ? 'justify-start' : 'justify-center'}`}>
                  <label className="flex h-8 w-8 items-center justify-center" data-tip={locked ? t('access.guestHint') : t(`access.${feature}`)}><input type="checkbox" aria-label={`${row.subject} ${t(`access.${feature}`)}`} checked={row.capabilities[feature]} disabled={busy || locked} onChange={event => toggle(row.subject, feature, event.target.checked)} className="h-4 w-4 accent-accent disabled:opacity-30" /></label>
                  {row.overrides[feature] !== undefined && <button type="button" disabled={busy} onClick={() => toggle(row.subject, feature, null)} aria-label={`${row.subject} ${t(`access.${feature}`)} ${t('access.featureReset')}`} data-tip={t('access.featureReset')} className="absolute right-0 flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"><Undo width={14} height={14} aria-hidden="true" /></button>}
                </div>
              </td>
            })}</tr>)}
          </tbody>
        </table>
      </div>
      <details className="text-xs text-ink-secondary">
        <summary className="w-fit cursor-pointer py-1 hover:text-ink">{uiText('권한 안내')}</summary>
        <div className="space-y-1 pt-1"><p>{t('access.featureHint')}</p><p>{t('access.shellHint')}</p><p>{t('access.terminalRequired')}</p><p>{t('access.guestHint')}</p></div>
      </details>
    </> : <>
      <p className="text-xs text-ink-secondary">{t('access.fileHint')}</p>
      <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); const nextPath = pathInput.trim().replace(/^\/+|\/+$/g, ''); setError(''); if (nextPath === selectedPath) void loadPath(); else setSelectedPath(nextPath) }}>
        <SelectField label={t('project.path')} value={project} disabled={busy} className="w-40 max-w-full" onChange={value => { setProject(value); setSelectedPath('') }} options={[{ value: '.workspace', label: t('access.root') }, { value: 'docs', label: t('project.documents') }]} />
        <input aria-label={t('access.openPath')} value={pathInput} onChange={event => setPathInput(event.target.value)} placeholder="/" disabled={busy} className="min-h-9 min-w-28 flex-1 rounded border border-edge-strong bg-surface px-2 text-sm text-ink" />
        <button type="submit" disabled={busy} className="min-h-9 rounded border border-edge-strong px-3 text-xs">{t('access.openPath')}</button>
      </form>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto md:flex-row" role="tabpanel">
        <nav aria-label={t('access.files')} className="max-h-48 shrink-0 overflow-y-auto rounded border border-edge md:max-h-none md:w-44">
          <button type="button" disabled={busy || !selectedPath} onClick={() => setSelectedPath(selectedPath.split('/').slice(0, -1).join('/'))} className="flex min-h-10 w-full items-center gap-2 border-b border-edge px-3 text-left text-sm disabled:opacity-40"><span aria-hidden="true">↑</span>{t('access.parent')}</button>
          {!pathSettings ? <p className="p-3 text-xs text-ink-secondary">{error ? t('access.loadFailed') : t('common.loading')}</p> : pathSettings.entries.map(entry => <button key={entry.path} type="button" disabled={busy} onClick={() => { setSelectedPath(entry.path); setError('') }} className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-raised">
            <svg aria-hidden="true" className="shrink-0 text-ink-secondary" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">{entry.type === 'dir' ? <path d="M3 6h6l2 2h10v12H3Z" /> : <path d="M5 3h9l5 5v13H5Zm9 0v6h5" />}</svg><span className="break-all">{entry.name}</span>
          </button>)}
          {pathSettings?.directory && !pathSettings.entries.length && <p className="p-3 text-xs text-ink-secondary">{t('access.emptyFolder')}</p>}
        </nav>
        <div className="min-w-0 flex-1">
          <p className="select-text mb-2 break-all text-sm font-medium">{selectedPath || t('access.root')}</p>
          {pathSettings && <div className="overflow-auto rounded-lg border border-edge">
            <table className="w-max border-separate border-spacing-0 text-sm">
              <AccountColumnHeaders accounts={settings.rows} onRoleChange={changeRole} onDelete={deleteAccount} disabled={busy} />
              <tbody>
                <tr>
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-edge bg-surface px-3 py-1 text-left text-xs font-medium">{t('access.rule')}</th>
                  {settings.rows.map(row => {
                    const permission = pathSettings.permissions.find(item => item.subject === row.subject)
                    const rule = permission?.explicit
                    const value = !rule ? 'inherit' : rule.edit ? 'edit' : rule.view ? 'view' : 'deny'
                    return <td key={row.subject} className="min-w-20 border-b border-edge px-1 py-1">
                      {permission && <SelectField compact label={`${row.subject} ${t('access.files')}`} disabled={busy} value={value} popupWidth={176} onChange={access => void mutate(async () => { await saveFileAccess(row.subject, project, selectedPath, access, pathSettings.workspace); await loadPath() })} options={(['inherit', 'deny', 'view', 'edit'] as const).map(access => ({ value: access, label: t(`access.${access}`) }))} />}
                    </td>
                  })}
                </tr>
                <tr>
                  <th scope="row" className="sticky left-0 z-10 border-r border-edge bg-surface px-3 py-2 text-left text-xs font-medium">{t('access.applied')}</th>
                  {settings.rows.map(row => {
                    const permission = pathSettings.permissions.find(item => item.subject === row.subject)
                    return <td key={row.subject} className="px-1 py-2 text-center text-xs text-ink-secondary">{permission && (permission.effective.edit ? t('access.edit') : permission.effective.view ? t('access.readOnly') : t('access.blocked'))}</td>
                  })}
                </tr>
              </tbody>
            </table>
          </div>}
        </div>
      </div>
    </>}
  </div>
}
