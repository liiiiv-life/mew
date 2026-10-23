import { useEffect, useId, useState } from 'react'
import { DialogFrame } from '@mew/ui'
import { fetchProjectSetup, previewProjectSetup, saveProjectSetup } from '../api/project-setup'
import { useI18n } from '../i18n'
import type { ProjectSetupInput, ProjectSetupPlan } from '../../shared/project-agent-context'

const inputClass = 'mt-1 w-full rounded-md border border-edge-bright bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50'
const buttonClass = 'min-h-10 rounded-md border border-edge-bright px-3 py-2 text-sm text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50'

export function DocsAgentContext({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const { t } = useI18n()
  const titleId = useId()
  const [input, setInput] = useState<ProjectSetupInput | null>(null)
  const [entries, setEntries] = useState('')
  const [plan, setPlan] = useState<ProjectSetupPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    fetchProjectSetup().then(value => {
      if (active) { setInput(value); setEntries(value.settings.entrypoints.join('\n')); setError('') }
    }).catch(reason => { if (active) setError(String(reason.message ?? reason)) })
    return () => { active = false }
  }, [reload])

  function change(next: ProjectSetupInput) { setInput(next); setPlan(null); setError('') }
  async function submit(apply: boolean) {
    if (!input) return
    setBusy(true); setError('')
    const request = { ...input, settings: { ...input.settings, entrypoints: entries.split('\n').map(p => p.trim()).filter(Boolean) } }
    try {
      if (apply && plan) {
        await saveProjectSetup(request, plan.revision)
        onDone(t('docs.contextDone'))
        // Documents paths and open collaborative rooms must use the new binding.
        location.reload()
      } else setPlan(await previewProjectSetup(request))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setPlan(null) }
    finally { setBusy(false) }
  }

  return <DialogFrame labelledBy={titleId} onClose={onClose} busy={busy} className="max-w-xl max-h-[90dvh] flex flex-col">
    <header className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
      <h2 id={titleId} className="text-base font-semibold text-ink">{t('docs.contextTitle')}</h2>
      <button type="button" className={buttonClass} onClick={onClose} disabled={busy}>{t('docs.contextBack')}</button>
    </header>
    <div className="min-h-0 overflow-y-auto p-4">
      <p className="text-sm leading-relaxed text-ink-secondary">{t('docs.contextHint')}</p>
      {error && <div role="alert" className="mt-3 select-text text-sm text-danger-ink">{error}</div>}
      {!input ? <div role="status" className="mt-4 text-sm text-ink-secondary">
        {error ? <button type="button" className={buttonClass} onClick={() => setReload(n => n + 1)}>{t('docs.contextRetry')}</button> : t('docs.contextLoading')}
      </div> : <fieldset disabled={busy} className="mt-4 space-y-4">
        <p className="break-all font-mono text-xs text-ink-secondary">{input.projectRoot}</p>
        <label className="block text-sm text-ink">{t('docs.contextFolder')}
          <input className={inputClass} value={input.settings.docsDir} onChange={event => change({ ...input, settings: { ...input.settings, docsDir: event.target.value } })} spellCheck={false} />
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={input.settings.enabled} onChange={event => change({ ...input, settings: { ...input.settings, enabled: event.target.checked } })} />
          {t('docs.contextEnabled')}
        </label>
        <label className="block text-sm text-ink">{t('docs.contextEntries')}
          <textarea className={inputClass} rows={2} value={entries} onChange={event => { setEntries(event.target.value); setPlan(null) }} spellCheck={false} />
        </label>
        <label className="block text-sm text-ink">{t('docs.contextInstructions')}
          <textarea className={inputClass} rows={3} maxLength={8000} value={input.settings.instructions} onChange={event => change({ ...input, settings: { ...input.settings, instructions: event.target.value } })} />
        </label>
        <div className="border-t border-edge pt-3">
          <label className="flex min-h-10 items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={input.initDocs ?? false} onChange={event => change({ ...input, initDocs: event.target.checked })} />
            {t('docs.contextInit')}
          </label>
          <label className="flex min-h-10 items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={input.exportAgents ?? false} onChange={event => change({ ...input, exportAgents: event.target.checked })} />
            {t('docs.contextExport')}
          </label>
          <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{t('docs.contextPreserve')}</p>
        </div>
        {plan && <section aria-label={t('docs.contextChanges')} className="border-t border-edge pt-3">
          <h3 className="text-sm font-semibold text-ink">{t('docs.contextChanges')}</h3>
          <ul className="mt-2 space-y-1 text-xs text-ink-secondary">{plan.files.map(file => <li key={file.path} className="flex justify-between gap-3">
            <span className="break-all font-mono">{file.path}</span><span className="shrink-0">{t(file.action === 'create' ? 'docs.contextCreate' : file.action === 'update' ? 'docs.contextUpdate' : 'docs.contextKeep')}</span>
          </li>)}</ul>
          <details className="mt-3 text-sm text-ink">
            <summary className="cursor-pointer py-2">{t('docs.contextActual')}</summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-raised p-3 text-xs leading-relaxed">{plan.context || t('docs.contextDisabled')}</pre>
          </details>
        </section>}
      </fieldset>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-edge p-3">
      <p role="status" className="mr-auto basis-full text-xs text-ink-secondary sm:basis-auto">{busy ? t('docs.contextWorking') : t('docs.contextSessions')}</p>
      <button type="button" className={buttonClass} disabled={!input || busy} onClick={() => void submit(false)}>{t('docs.contextPreview')}</button>
      <button type="button" className={`${buttonClass} font-semibold`} disabled={!plan || busy} onClick={() => void submit(true)}>{t('docs.contextApply')}</button>
    </footer>
  </DialogFrame>
}
