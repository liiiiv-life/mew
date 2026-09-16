import { useCallback, useEffect, useRef, useState } from 'react'
import { FEATURES, GUEST_FEATURES, type AccessSettings, type Feature } from '../../shared/access-policy'
import { fetchAccessSettings, fetchAccessPath, saveFeatureAccess, saveFileAccess, type AccessPathSettings, type AdminUser, type Role } from '../api/client'
import { useI18n } from '../i18n'

export function AccountAccessMatrix({ users, onRoleChange }: { users: AdminUser[]; onRoleChange: (email: string, role: Role) => Promise<void> }) {
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
  const selectClass = 'min-h-9 rounded border border-edge-strong bg-surface px-2 text-sm text-ink disabled:opacity-50'
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="flex items-center gap-1 border-b border-edge" role="tablist" aria-label={t('admin.title')}>
      {(['features', 'files'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} disabled={busy} onClick={() => { setTab(value); setError('') }} className={`min-h-10 border-b-2 px-3 text-sm ${tab === value ? 'border-ink text-ink font-medium' : 'border-transparent text-ink-secondary'}`}>{t(`access.${value}`)}</button>)}
      <span role="status" className="ml-auto shrink-0 text-xs text-ink-secondary">{busy ? t('access.saving') : saved ? t('access.saved') : ''}</span>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!settings ? <p role="status" className="py-5 text-sm text-ink-secondary">{t('common.loading')}</p> : tab === 'features' ? <>
      <p className="text-xs text-ink-secondary">{t('access.featureHint')}</p>
      <div className="min-h-0 overflow-auto rounded border border-edge" role="tabpanel">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead><tr><th scope="col" className="sticky left-0 top-0 z-20 min-w-44 border-b border-edge bg-surface p-3 text-left md:min-w-64">{t('access.account')} / {t('access.role')}</th>
            {FEATURES.map(feature => <th key={feature} scope="col" className="sticky top-0 z-10 min-w-24 border-b border-edge bg-surface px-2 py-3 text-center text-xs font-medium">{t(`access.${feature}`)}</th>)}</tr></thead>
          <tbody>{settings.rows.map(row => <tr key={row.subject}>
            <th scope="row" className="sticky left-0 z-10 max-w-64 border-b border-edge bg-surface-deep p-3 text-left font-normal">
              <div className="break-words font-medium">{row.displayName}</div>
              {row.subject !== 'guest' && <div className="select-text mt-0.5 break-all text-xs text-ink-secondary">{row.subject}</div>}
              {row.role === 'guest' ? <span className="text-xs text-ink-secondary">guest</span> : <select aria-label={`${row.subject} ${t('access.role')}`} value={row.role} disabled={busy} className={`${selectClass} mt-2 w-full`} onChange={event => void mutate(async () => { await onRoleChange(row.subject, event.target.value as Role); setSettings(await fetchAccessSettings()) })}>
                {(['member', 'manager', 'owner'] as const).map(role => <option key={role}>{role}</option>)}
              </select>}
            </th>
            {FEATURES.map(feature => {
              const locked = row.subject === 'guest' && !GUEST_FEATURES.includes(feature)
              return <td key={feature} className="border-b border-edge px-2 py-3 text-center">
                <label className="flex min-h-10 items-center justify-center" title={locked ? t('access.guestHint') : t(`access.${feature}`)}><input type="checkbox" aria-label={`${row.subject} ${t(`access.${feature}`)}`} checked={row.capabilities[feature]} disabled={busy || locked} onChange={event => toggle(row.subject, feature, event.target.checked)} className="h-4 w-4 accent-accent disabled:opacity-30" /></label>
                {row.overrides[feature] !== undefined && <button type="button" disabled={busy} onClick={() => toggle(row.subject, feature, null)} aria-label={`${row.subject} ${t(`access.${feature}`)} ${t('access.featureReset')}`} title={t('access.featureReset')} className="min-h-8 px-2 text-xs text-ink-secondary underline underline-offset-2">{t('common.reset')}</button>}
              </td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-ink-secondary">{t('access.shellHint')}</p>
      <p className="text-xs text-ink-secondary">{t('access.terminalRequired')}</p>
      <p className="text-xs text-ink-secondary">{t('access.guestHint')}</p>
    </> : <>
      <p className="text-xs text-ink-secondary">{t('access.fileHint')}</p>
      <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); const nextPath = pathInput.trim().replace(/^\/+|\/+$/g, ''); setError(''); if (nextPath === selectedPath) void loadPath(); else setSelectedPath(nextPath) }}>
        <select aria-label={t('project.path')} value={project} disabled={busy} className={selectClass} onChange={event => { setProject(event.target.value); setSelectedPath('') }}><option value=".workspace">{t('access.root')}</option><option value="docs">{t('project.documents')}</option></select>
        <input aria-label={t('access.openPath')} value={pathInput} onChange={event => setPathInput(event.target.value)} placeholder="/" disabled={busy} className="min-h-9 min-w-28 flex-1 rounded border border-edge-strong bg-surface px-2 text-sm text-ink" />
        <button type="submit" disabled={busy} className="min-h-9 rounded border border-edge-strong px-3 text-xs">{t('access.openPath')}</button>
      </form>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto md:flex-row" role="tabpanel">
        <nav aria-label={t('access.files')} className="max-h-48 shrink-0 overflow-y-auto rounded border border-edge md:max-h-none md:w-60">
          <button type="button" disabled={busy || !selectedPath} onClick={() => setSelectedPath(selectedPath.split('/').slice(0, -1).join('/'))} className="flex min-h-10 w-full items-center gap-2 border-b border-edge px-3 text-left text-sm disabled:opacity-40"><span aria-hidden="true">↑</span>{t('access.parent')}</button>
          {!pathSettings ? <p className="p-3 text-xs text-ink-secondary">{error ? t('access.loadFailed') : t('common.loading')}</p> : pathSettings.entries.map(entry => <button key={entry.path} type="button" disabled={busy} onClick={() => { setSelectedPath(entry.path); setError('') }} className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-surface-raised">
            <svg aria-hidden="true" className="shrink-0 text-ink-secondary" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">{entry.type === 'dir' ? <path d="M3 6h6l2 2h10v12H3Z" /> : <path d="M5 3h9l5 5v13H5Zm9 0v6h5" />}</svg><span className="break-all">{entry.name}</span>
          </button>)}
          {pathSettings?.directory && !pathSettings.entries.length && <p className="p-3 text-xs text-ink-secondary">{t('access.emptyFolder')}</p>}
        </nav>
        <div className="min-w-0 flex-1">
          <p className="select-text mb-2 break-all text-sm font-medium">{selectedPath || t('access.root')}</p>
          {pathSettings && <table className="w-full text-sm"><thead><tr className="border-b border-edge"><th scope="col" className="py-2 text-left">{t('access.account')}</th><th scope="col" className="px-2 py-2 text-left">{t('access.rule')}</th><th scope="col" className="py-2 text-left">{t('access.applied')}</th></tr></thead><tbody>{settings.rows.map(row => {
            const permission = pathSettings.permissions.find(item => item.subject === row.subject)
            if (!permission) return null
            const rule = permission.explicit
            const value = !rule ? 'inherit' : rule.edit ? 'edit' : rule.view ? 'view' : 'deny'
            return <tr key={row.subject} className="border-b border-edge">
              <th scope="row" className="max-w-32 break-all py-3 text-left font-normal"><span>{row.displayName}</span>{row.subject !== 'guest' && <span className="select-text mt-1 block text-xs text-ink-secondary">{row.subject}</span>}</th>
              <td className="px-2 py-3"><select aria-label={`${row.subject} ${t('access.files')}`} disabled={busy} value={value} className={`${selectClass} max-w-full`} onChange={event => { const access = event.target.value; void mutate(async () => { await saveFileAccess(row.subject, project, selectedPath, access, pathSettings.workspace); await loadPath() }) }}>{(['inherit', 'deny', 'view', 'edit'] as const).map(access => <option key={access} value={access}>{t(`access.${access}`)}</option>)}</select></td>
              <td className="py-3 text-xs text-ink-secondary">{permission.effective.edit ? t('access.edit') : permission.effective.view ? t('access.readOnly') : t('access.blocked')}</td>
            </tr>
          })}</tbody></table>}
        </div>
      </div>
    </>}
  </div>
}
