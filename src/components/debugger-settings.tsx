import { useEffect, useState } from 'react'
import { HoverTipLayer, SelectField } from '@mew/ui'
import { RefreshDouble } from 'iconoir-react'
import { useI18n } from '../i18n'
import { debuggerRequest, type DebuggerStatus } from '../api/debugger'
import { defaultDebugConfig, type DebugAdapterKind, type DebugConfig } from '../../shared/debugger'
import { debuggerCopy } from './debugger-copy'
import { debuggerExtra } from './debugger-helpers'

export default function DebuggerSettings({ root, portalContainer, onOpen }: { root: string; portalContainer?: HTMLElement | null; onOpen: () => void }) {
  const { locale } = useI18n(), c = { ...debuggerCopy[locale] ?? debuggerCopy.en, ...debuggerExtra(locale) }
  const [config, setConfig] = useState<DebugConfig | null>(null)
  const [args, setArgs] = useState('[]'), [launch, setLaunch] = useState('{}'), [profiles, setProfiles] = useState('[]'), [compounds, setCompounds] = useState('[]')
  const [adapter, setAdapter] = useState<DebuggerStatus['adapter'] | null>(null)
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const apply = (value: DebugConfig) => { setConfig(value); setArgs(JSON.stringify(value.args)); setLaunch(JSON.stringify(value.configuration, null, 2)); setProfiles(JSON.stringify(value.profiles ?? [], null, 2)); setCompounds(JSON.stringify(value.compounds ?? [], null, 2)) }
  let jsOptions: Record<string, unknown> = {}
  try { jsOptions = JSON.parse(launch) } catch { /* form validation reports invalid JSON on save */ }
  const changeOptions = (patch: Record<string, unknown>) => { try { const value = JSON.parse(launch); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); setLaunch(JSON.stringify({ ...value, ...patch }, null, 2)) } catch { setError(c.configError) } }
  useEffect(() => {
    const controller = new AbortController()
    debuggerRequest<DebuggerStatus>(root, '', undefined, 'GET', controller.signal).then(value => { apply(value.config); setAdapter(value.adapter); setLive(value.sessions?.some(s => ['starting', 'running', 'stopped'].includes(s.state)) ?? ['starting', 'running', 'stopped'].includes(value.session.state)) }, e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [root])
  async function action(kind: 'save' | 'test' | 'install') {
    if (!config) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (kind === 'install') {
        let configuration: unknown
        try { configuration = JSON.parse(launch) } catch { throw new Error(c.configError) }
        await debuggerRequest(root, '/config', { ...config, configuration }, 'PUT')
        const installed = await debuggerRequest<DebugConfig>(root, '/install', {})
        apply(installed); setAdapter(previous => previous && { ...previous, installed: true }); setMessage(c.installed)
      } else {
        let parsedArgs: unknown, configuration: unknown
        try { parsedArgs = JSON.parse(args) } catch { throw new Error(c.adapterArgsError) }
        try { configuration = JSON.parse(launch) } catch { throw new Error(c.configError) }
        if (!Array.isArray(parsedArgs) || parsedArgs.some(x => typeof x !== 'string')) throw new Error(c.adapterArgsError)
        if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) throw new Error(c.configError)
        let parsedProfiles: unknown
        try { parsedProfiles = JSON.parse(profiles) } catch { throw new Error(c.configError) }
        const saved = await debuggerRequest<DebugConfig>(root, '/config', { ...config, args: parsedArgs, configuration, profiles: parsedProfiles, compounds: JSON.parse(compounds) }, 'PUT')
        apply(saved)
        if (kind === 'test') await debuggerRequest(root, '/test', {})
        setMessage(kind === 'test' ? c.connected : c.saved)
      }
    } catch (e) { setError(e instanceof Error ? e.message : c.error) }
    finally { setBusy(false) }
  }
  const input = 'w-full min-w-0 rounded border border-edge bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none'
  return <HoverTipLayer className="min-w-0 space-y-3" portalTarget={portalContainer}>
    {!config && !error && <div role="status" className="text-xs text-ink-secondary">…</div>}
    {error && <div role="alert" className="break-words text-sm text-red-400">{error}</div>}
    {config && <>
      <SelectField label={c.adapter} value={config.kind} disabled={busy || live} portalContainer={portalContainer} options={[
        { value: 'js-debug', label: 'js-debug · JavaScript / TypeScript' }, { value: 'debugpy', label: 'debugpy · Python' }, { value: 'lldb-dap', label: 'LLDB DAP · C / C++ / Rust' }, { value: 'codelldb', label: 'CodeLLDB · C / C++ / Rust' }, { value: 'delve', label: 'Delve · Go' }, { value: 'custom', label: 'Custom DAP' },
      ]} onChange={value => { const preset = defaultDebugConfig(value as DebugAdapterKind, root); apply({ ...preset, breakpoints: config.breakpoints, watches: config.watches, agentBridge: config.agentBridge }) }} />
      {config.kind === 'js-debug' && <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary"><span>js-debug {adapter?.version} · {adapter?.installed ? c.installed : c.notInstalled}</span><button type="button" disabled={busy || live} onClick={() => void action('install')} className="rounded border border-edge px-2 py-1.5 text-ink hover:bg-surface-raised disabled:opacity-40">{c.install}</button></div>}
      <p className="text-xs text-ink-secondary">{c.external}</p>
      <fieldset disabled={busy || live} className="min-w-0 space-y-2 disabled:opacity-60">
        <label className="block text-xs text-ink-secondary">{c.command}<input className={input} value={config.command} onChange={event => setConfig({ ...config, command: event.target.value })} autoComplete="off" spellCheck={false} /></label>
        <label className="block text-xs text-ink-secondary">{c.args}<textarea className={`${input} font-mono`} rows={2} value={args} onChange={event => setArgs(event.target.value)} spellCheck={false} /></label>
        <div className="grid grid-cols-2 gap-2"><SelectField label={c.transport} value={config.transport} portalContainer={portalContainer} options={[{ value: 'stdio', label: 'stdio' }, { value: 'tcp', label: 'TCP · 127.0.0.1' }]} onChange={value => setConfig({ ...config, transport: value as DebugConfig['transport'] })} />{config.transport === 'tcp' && <label className="block text-xs text-ink-secondary">{c.port}<input type="number" min={0} max={65535} className={input} value={config.port} onChange={event => setConfig({ ...config, port: Number(event.target.value) })} /></label>}</div>
        <SelectField label={c.request} value={config.request} portalContainer={portalContainer} options={[{ value: 'launch', label: c.launch }, { value: 'attach', label: c.attach }]} onChange={value => setConfig({ ...config, request: value as DebugConfig['request'] })} />
        <label className="block text-xs text-ink-secondary">{c.configuration}<textarea rows={8} spellCheck={false} className={`${input} font-mono text-xs`} value={launch} onChange={event => setLaunch(event.target.value)} /></label>
        {config.kind === 'js-debug' && <details><summary className="cursor-pointer text-xs text-ink-secondary">JavaScript / TypeScript</summary><label className="block py-1 text-xs text-ink-secondary">{c.skipFiles}<textarea rows={2} className={`${input} font-mono text-xs`} value={Array.isArray(jsOptions?.skipFiles) ? jsOptions.skipFiles.join('\n') : ''} onChange={e => changeOptions({ skipFiles: e.target.value.split('\n').filter(Boolean) })} /></label>{(['smartStep', 'asyncStacks'] as const).map(option => { const key = option === 'asyncStacks' ? 'showAsyncStacks' : option; return <label key={key} className="flex items-center gap-1 py-1 text-xs"><input type="checkbox" className="accent-accent" checked={jsOptions?.[key] !== false} onChange={e => changeOptions({ [key]: e.target.checked })} />{c[option]}</label> })}</details>}
        <details><summary className="cursor-pointer text-xs text-ink-secondary">{c.profiles}</summary><button type="button" className="py-1 text-xs text-accent" onClick={() => { setBusy(true); setError(''); void debuggerRequest<{ profiles: DebugConfig['profiles']; compounds: DebugConfig['compounds'] }>(root, '/profiles/import', {}).then(result => { setProfiles(JSON.stringify(result.profiles, null, 2)); setCompounds(JSON.stringify(result.compounds, null, 2)); setMessage(c.import) }).catch(e => setError(e.message)).finally(() => setBusy(false)) }}>{c.import}</button><textarea aria-label={c.profiles} rows={4} className={`${input} font-mono text-xs`} value={profiles} onChange={e => setProfiles(e.target.value)} spellCheck={false} /></details>
        <details><summary className="cursor-pointer text-xs text-ink-secondary">{c.compounds}</summary><textarea aria-label={c.compounds} rows={3} className={`${input} font-mono text-xs`} value={compounds} onChange={e => setCompounds(e.target.value)} spellCheck={false} /></details>
      </fieldset>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" disabled={busy} className="accent-accent" checked={config.agentBridge === true} onChange={e => { const enabled = e.target.checked; setBusy(true); setError(''); void debuggerRequest<DebugConfig>(root, '/bridge', { enabled }).then(value => { setConfig(previous => previous && { ...previous, agentBridge: value.agentBridge }); setMessage(c.saved) }).catch(e => setError(e.message)).finally(() => setBusy(false)) }} />{c.agentBridge}</label>
      <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={busy || live} onClick={() => void action('save')} className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40">{c.save}</button><button type="button" disabled={busy || live} onClick={() => void action('test')} className="flex items-center gap-1 rounded border border-edge px-2 py-1.5 text-sm text-ink disabled:opacity-40"><RefreshDouble width={14} height={14} aria-hidden="true" />{c.test}</button><button type="button" disabled={busy} onClick={onOpen} className="rounded px-2 py-1.5 text-sm text-accent hover:bg-surface-raised">{c.open}</button></div>
      {message && <div role="status" className="text-xs text-ink-secondary">{message}</div>}
    </>}
  </HoverTipLayer>
}
