import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Settings, Square } from 'iconoir-react'
import { SelectField } from '@mew/ui'
import { useI18n } from '../i18n'
import { fetchAgentRuntimes, type AgentRuntimeStatus } from '../api/client'
import type { MewcatAssistantState } from '../hooks/use-mewcat-assistant'

export function MewcatAssistant({ state, runtime, onConnect, onRuntimeChange }: { state: MewcatAssistantState; runtime: string | null; onConnect: () => void; onRuntimeChange: (runtime: string) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const [settings, setSettings] = useState(false)
  const [runtimes, setRuntimes] = useState<AgentRuntimeStatus[]>([])
  const scroll = useRef<HTMLElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    const container = scroll.current?.closest<HTMLDivElement>('.mewcat-notifications-content')
    if (!container) return
    const track = () => { follow.current = container.scrollHeight - container.scrollTop - container.clientHeight < 48 }
    container.addEventListener('scroll', track, { passive: true })
    return () => container.removeEventListener('scroll', track)
  }, [])
  useEffect(() => {
    const container = scroll.current?.closest<HTMLDivElement>('.mewcat-notifications-content')
    if (container && follow.current) container.scrollTo({ top: container.scrollHeight })
  }, [state.messages, state.busy])
  useEffect(() => {
    if (!settings && !runtime) return
    let alive = true
    void fetchAgentRuntimes().then(result => { if (alive) setRuntimes(result.runtimes.filter(item => item.surface === 'acp' && item.installed)) }).catch(() => { if (alive) setRuntimes([]) })
    return () => { alive = false }
  }, [settings, runtime])
  const submit = () => { if (state.ask(draft.trim())) setDraft('') }
  const allow = state.permission?.options.find(option => option.kind === 'allow_once')
  const deny = state.permission?.options.find(option => option.kind === 'reject_once' || option.kind === 'reject_always')
  return <section ref={scroll} className="mewcat-assistant border-t border-edge p-2.5" aria-label={t('mewcat.assistant.title')}>
    <div className="mb-2 flex items-center gap-2">
      <h2 className="flex-1 text-xs font-medium text-ink">{t('mewcat.assistant.title')}</h2>
      {runtime && <span className="truncate text-[11px] text-ink-secondary">{runtimes.find(item => item.id === runtime)?.label ?? runtime}</span>}
      {runtime && <>
        <button type="button" className="mewcat-notification-button text-ink-secondary disabled:opacity-40" disabled={state.busy || !state.ready || !state.messages.length} onClick={state.newConversation} aria-label={t('mewcat.assistant.clear')} title={t('mewcat.assistant.clear')}><span className="px-1 text-[11px]">{t('mewcat.assistant.clear')}</span></button>
        <button type="button" className="mewcat-notification-button text-ink-secondary" disabled={state.busy} onClick={() => setSettings(value => !value)} aria-expanded={settings} aria-label={t('mewcat.assistant.change')} title={t('mewcat.assistant.change')}><Settings width={16} height={16} /></button>
      </>}
    </div>
    {settings && <div className="mb-2 flex flex-col gap-2">
      <SelectField compact popupClassName="mewcat-assistant-menu" label={t('mewcat.assistant.agent')} value={runtime ?? ''} options={runtimes.map(item => ({ value: item.id, label: item.label }))} onChange={value => { onRuntimeChange(value); setSettings(false) }} />
      <button type="button" className="min-h-9 rounded border border-edge px-2 text-xs text-ink hover:bg-surface-raised" onClick={onConnect}>{t('mewcat.assistant.connect')}</button>
    </div>}
    {!runtime || state.login ? <div className="flex flex-col items-start gap-2">
      <p className="text-xs leading-5 text-ink-secondary">{t(state.login ? 'mewcat.assistant.login' : 'mewcat.assistant.guide')}</p>
      <button type="button" className="min-h-9 rounded bg-accent px-3 text-xs text-ink-on-accent hover:bg-accent-strong" onClick={onConnect}>{t('mewcat.assistant.connect')}</button>
    </div> : <>
      <div className="mewcat-assistant-conversation space-y-2" role="log" aria-label={t('mewcat.assistant.title')} aria-live="polite" aria-relevant="additions">
        {state.messages.map((message, index) => <p key={index} className={`whitespace-pre-wrap break-words rounded-lg px-2.5 py-2 text-xs leading-5 ${message.role === 'user' ? 'ml-5 bg-surface-raised text-ink-secondary' : 'mr-3 bg-surface-hover text-ink'}`}>{message.text}</p>)}
      </div>
      {(state.busy || (!state.ready && !state.error)) && <p role="status" className="my-2 text-xs text-ink-secondary">{state.action ? t(`mewcat.assistant.${state.action}`) : t(state.busy ? 'mewcat.assistant.thinking' : 'mewcat.assistant.preparing')}</p>}
      {state.permission && <div className="my-2 space-y-2" role="alert">
        <p className="text-xs text-ink">{t('mewcat.assistant.permission')}</p>
        <p className="break-words text-xs text-ink-secondary">{state.permission.toolCall.title}</p>
        <div className="flex gap-2">
          {allow && <button type="button" className="min-h-9 rounded border border-edge px-2 text-xs text-ink" onClick={() => state.answerPermission(allow.optionId)}>{t('mewcat.assistant.allow')}</button>}
          <button type="button" className="min-h-9 rounded border border-edge px-2 text-xs text-ink" onClick={() => state.answerPermission(deny?.optionId ?? null)}>{t('mewcat.assistant.deny')}</button>
        </div>
      </div>}
      {state.error && <div className="my-2 text-xs leading-5 text-danger" role="alert">
        <p>{t('mewcat.assistant.failed')}</p>
        <button type="button" className="min-h-9 underline underline-offset-2" onClick={state.reconnect}>{t('mewcat.assistant.retry')}</button>
        {!state.error.startsWith('MEWCAT_') && <details className="text-ink-secondary"><summary>{t('mewcat.assistant.details')}</summary><p className="whitespace-pre-wrap break-words">{state.error}</p></details>}
      </div>}
      <form className="mt-2 flex items-end gap-1 rounded-lg border border-edge bg-surface-raised p-1 focus-within:border-accent" onSubmit={event => { event.preventDefault(); submit() }}>
        <textarea rows={2} className="min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-xs leading-5 text-ink outline-none placeholder:text-ink-secondary" aria-label={t('mewcat.assistant.input')} placeholder={t('mewcat.assistant.hint')} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); submit() }
        }} />
        <button type={state.busy ? 'button' : 'submit'} disabled={!state.busy && (!state.ready || !draft.trim())} onClick={state.busy ? state.cancel : undefined} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-ink-on-accent hover:bg-accent-strong disabled:opacity-40" aria-label={t(state.busy ? 'mewcat.assistant.stop' : 'mewcat.assistant.send')} title={t(state.busy ? 'mewcat.assistant.stop' : 'mewcat.assistant.send')}>
          {state.busy ? <Square width={15} height={15} /> : <ArrowUp width={18} height={18} />}
        </button>
      </form>
    </>}
  </section>
}
