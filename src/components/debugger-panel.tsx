import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { HoverTipLayer } from '@mew/ui'
import { ArrowDown, ArrowRight, ArrowUp, Pause, Pin, Play, Plus, Settings, Square, Xmark, NavArrowDown, NavArrowRight } from 'iconoir-react'
import { useI18n } from '../i18n'
import { debuggerRequest, type DebuggerStatus } from '../api/debugger'
import type { DebugConfig, DebugSnapshot, DebugVariable } from '../../shared/debugger'
import { debuggerCopy, type DebuggerCopy } from './debugger-copy'
import { DockGrip } from './DockWorkspace'
import { DebuggerSourceField } from './debugger-source-field'

const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-35'
function Action({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={iconButton} aria-label={label} data-tip={label} disabled={disabled} onClick={onClick}>{children}</button>
}
function VariableRow({ variable, changed, c, load, pin, depth = 0 }: { variable: DebugVariable; changed: boolean; c: DebuggerCopy; load: (ref: number) => Promise<DebugVariable[]>; pin: (expression: string) => void; depth?: number }) {
  const [children, setChildren] = useState<DebugVariable[] | null>(null), [open, setOpen] = useState(false), [error, setError] = useState('')
  async function expand() {
    setOpen(!open)
    if (!open && !children) {
      try { setChildren(await load(variable.variablesReference)) } catch (e) { setError(e instanceof Error ? e.message : c.error) }
    }
  }
  return <div className="min-w-0">
    <div className={`flex min-w-0 items-start gap-1 rounded py-0.5 text-xs ${changed ? 'bg-accent/10' : ''}`} style={{ paddingLeft: Math.min(depth, 12) * 12 }}>
      {variable.variablesReference > 0 ? <button type="button" aria-label={`${open ? '−' : '+'} ${variable.name}`} aria-expanded={open} className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-secondary" onClick={() => void expand()}>{open ? <NavArrowDown width={12} /> : <NavArrowRight width={12} />}</button> : <span className="w-6 shrink-0" />}
      <div className="min-w-0 flex-1 break-words py-1 font-mono"><span className="text-ink">{variable.name}</span><span className="px-1 text-ink-muted">=</span><span className="whitespace-pre-wrap text-ink-secondary">{variable.value}</span>{changed && <span className="ml-1 font-sans text-accent">{c.changed}</span>}</div>
      {variable.evaluateName && <Action label={`${c.pin}: ${variable.name}`} onClick={() => pin(variable.evaluateName!)}><Pin width={13} height={13} /></Action>}
    </div>
    {open && error && <div role="alert" className="break-words text-xs text-red-400">{error}</div>}
    {open && children?.slice(0, 200).map((child, i) => <VariableRow key={`${child.name}:${i}`} variable={child} changed={false} c={c} load={load} pin={pin} depth={depth + 1} />)}
  </div>
}
export default function DebuggerPanel({ root, onClose, onSettings, onOpenFile }: { root: string; onClose: () => void; onSettings: () => void; onOpenFile: (file: string, line: number) => void }) {
  const { locale } = useI18n(), c = debuggerCopy[locale] ?? debuggerCopy.en
  const [status, setStatus] = useState<DebuggerStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [file, setFile] = useState(''), [line, setLine] = useState(1), [expression, setExpression] = useState('')
  const [frameId, setFrameId] = useState<number | null>(null)
  const [variables, setVariables] = useState<(DebugVariable & { changed: boolean; scope: string })[]>([])
  const [watches, setWatches] = useState<{ expression: string; value: string; changed: boolean }[]>([])
  const previous = useRef(new Map<string, { value: string; revision: number | undefined; changed: boolean }>()), previousWatches = useRef(new Map<string, { value: string; revision: number | undefined; changed: boolean }>())
  const configRef = useRef<DebugConfig | null>(null)
  const current = useRef<DebugSnapshot | null>(null)
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const configRevision = useRef(0), pendingSaves = useRef(0)
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const revision = configRevision.current
        const value = await debuggerRequest<DebuggerStatus>(root, '', undefined, 'GET', controller.signal)
        if (controller.signal.aborted) return
        current.current = value.session
        if (configRef.current && (pendingSaves.current > 0 || revision !== configRevision.current)) value.config = configRef.current
        configRef.current = value.config; setStatus(value)
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : c.error) }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 1000)
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [root, c.error])
  const session = status?.session, stopped = session?.state === 'stopped', live = !!session && ['starting', 'running', 'stopped'].includes(session.state)
  const firstFrameId = session?.frames[0]?.id ?? null
  useEffect(() => { setFrameId(stopped ? firstFrameId : null) }, [stopped, session?.id, session?.stopRevision, firstFrameId])
  const command = useCallback(async <T = Record<string, unknown>,>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    return debuggerRequest<T>(root, '/command', { sessionId: current.current?.id, command: name, arguments: args })
  }, [root])
  const selectedFrame = session?.frames.find(f => f.id === frameId)
  const framePath = selectedFrame?.source?.path, frameName = selectedFrame?.name
  const watchKey = status?.config.watches.join('\u0000')
  const stopRevision = session?.stopRevision
  useEffect(() => {
    let cancelled = false
    if (!stopped || frameId === null) { setVariables([]); setWatches([]); return }
    async function inspect() {
      try {
        const result = await command<{ scopes: { name: string; variablesReference: number; expensive?: boolean }[] }>('scopes', { frameId })
        const rows: (DebugVariable & { changed: boolean; scope: string })[] = []
        for (const scope of result.scopes.filter(scope => !scope.expensive)) {
          const result = await command<{ variables: DebugVariable[] }>('variables', { variablesReference: scope.variablesReference, start: 0, count: 200 })
          for (const variable of result.variables.slice(0, 200)) {
            const key = JSON.stringify([framePath, frameName, scope.name, variable.name]), old = previous.current.get(key)
            const changed = old && old.revision === stopRevision ? old.changed : old !== undefined && old.value !== variable.value
            rows.push({ ...variable, scope: scope.name, changed })
            if (!cancelled) previous.current.set(key, { value: variable.value, revision: stopRevision, changed })
          }
        }
        const values = []
        for (const expression of configRef.current?.watches ?? []) {
          let value: string
          try { value = (await command<{ result: string }>('evaluate', { expression, frameId, context: 'watch' })).result } catch (e) { value = e instanceof Error ? e.message : c.error }
          const old = previousWatches.current.get(expression)
          const changed = old && old.revision === stopRevision ? old.changed : old !== undefined && old.value !== value
          values.push({ expression, value, changed })
          if (!cancelled) previousWatches.current.set(expression, { value, revision: stopRevision, changed })
        }
        if (!cancelled) { setVariables(rows.sort((a, b) => Number(b.changed) - Number(a.changed))); setWatches(values) }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : c.error) }
    }
    void inspect()
    return () => { cancelled = true }
  // Every stop invalidates DAP variable references, even if the frame id is reused.
  }, [root, stopped, frameId, framePath, frameName, session?.id, stopRevision, watchKey, command, c.error])
  async function save(config: DebugConfig) {
    ++configRevision.current; ++pendingSaves.current
    configRef.current = config; setStatus(previous => previous && { ...previous, config })
    const queued = saveQueue.current.catch(() => {}).then(() => debuggerRequest<DebugConfig>(root, '/config', config, 'PUT'))
    saveQueue.current = queued
    try { await queued } catch (e) { setError(e instanceof Error ? e.message : c.error) } finally { --pendingSaves.current }
  }
  const pin = (expression: string) => { const config = configRef.current; if (config && !config.watches.includes(expression)) void save({ ...config, watches: [...config.watches, expression] }) }
  async function action(name: string) {
    setBusy(true); setError('')
    try {
      await saveQueue.current
      if (name === 'start' || name === 'stop') await debuggerRequest(root, `/${name}`, name === 'stop' ? { sessionId: current.current?.id } : {})
      else await command(name)
      const value = await debuggerRequest<DebuggerStatus>(root); current.current = value.session; setStatus(value)
      if (name === 'start') { previous.current.clear(); previousWatches.current.clear() }
    } catch (e) { setError(e instanceof Error ? e.message : c.error) }
    finally { setBusy(false) }
  }
  const input = 'min-w-0 rounded border border-edge bg-surface-deep px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none'
  return <HoverTipLayer className="flex h-full min-h-0 min-w-0 flex-col bg-surface text-ink" placement="bottom">
    <section aria-label={c.title} className="flex h-full min-h-0 min-w-0 flex-col">
      <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep"><DockGrip group="debugger" /><span className="min-w-0 flex-1 truncate px-2 text-xs">{c.title}</span><Action label={c.manage} onClick={onSettings}><Settings width={15} height={15} /></Action><Action label={c.close} onClick={onClose}><Xmark width={16} height={16} /></Action></header>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-edge px-1">
        <Action label={live ? c.continue : c.start} disabled={busy || !status || live && !stopped} onClick={() => void action(live ? 'continue' : 'start')}><Play width={16} height={16} /></Action>
        <Action label={c.pause} disabled={busy || session?.state !== 'running'} onClick={() => void action('pause')}><Pause width={16} height={16} /></Action>
        <Action label={c.stop} disabled={!live} onClick={() => void action('stop')}><Square width={14} height={14} /></Action>
        <Action label={c.next} disabled={busy || !stopped} onClick={() => void action('next')}><ArrowRight width={16} height={16} /></Action>
        <Action label={c.stepIn} disabled={busy || !stopped} onClick={() => void action('stepIn')}><ArrowDown width={16} height={16} /></Action>
        <Action label={c.stepOut} disabled={busy || !stopped} onClick={() => void action('stepOut')}><ArrowUp width={16} height={16} /></Action>
        <span role="status" className="ml-auto truncate px-1 text-xs text-ink-secondary">{session ? c[session.state] : '…'}</span>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto p-2">
        {(error || session?.state === 'error') && <div role="alert" className="mb-2 break-words text-xs text-red-400">{error || session?.reason}</div>}
        <details open className="border-b border-edge pb-2"><summary className="cursor-pointer py-1 text-xs font-medium">{c.breakpoints}</summary>
          <form className="flex min-w-0 items-center gap-1" onSubmit={event => { event.preventDefault(); const config = configRef.current; if (!config || !file.trim() || config.breakpoints.some(b => b.file === file.trim() && b.line === line)) return; void save({ ...config, breakpoints: [...config.breakpoints, { file: file.trim(), line, enabled: true }] }); setFile('') }}>
            <DebuggerSourceField root={root} label={c.file} value={file} onChange={setFile} /><input className={`${input} w-16`} aria-label={c.line} type="number" min={1} value={line} onChange={e => setLine(Number(e.target.value))} required /><button type="submit" aria-label={c.add} data-tip={c.add} className={iconButton}><Plus width={16} /></button>
          </form>
          {status?.config.breakpoints.map((bp, index) => { const full = bp.file.startsWith('/') ? bp.file : `${root}/${bp.file}`; const verified = session?.breakpoints.find(b => b.file === full && b.line === bp.line); return <div key={`${bp.file}:${bp.line}`} className="flex min-w-0 items-center gap-1 py-0.5 text-xs"><input type="checkbox" aria-label={`${bp.file}:${bp.line}`} checked={bp.enabled} onChange={e => { const config = configRef.current!; void save({ ...config, breakpoints: config.breakpoints.map((b, i) => i === index ? { ...b, enabled: e.target.checked } : b) }) }} className="accent-accent" /><button type="button" className="min-w-0 flex-1 truncate text-left text-ink-secondary hover:text-accent" onClick={() => onOpenFile(bp.file, bp.line)}>{bp.file}:{bp.line}</button><span aria-label={verified?.verified ? undefined : c.unverified} data-tip={verified?.message || (!verified?.verified ? c.unverified : undefined)} className={verified?.verified ? 'text-accent' : 'text-ink-muted'}>●</span><Action label={`${c.remove} ${bp.file}:${bp.line}`} onClick={() => { const config = configRef.current!; void save({ ...config, breakpoints: config.breakpoints.filter((_, i) => i !== index) }) }}><Xmark width={13} /></Action></div> })}
        </details>
        <details open className="border-b border-edge py-2"><summary className="cursor-pointer text-xs font-medium">{c.stack}</summary>{session?.frames.map(frame => <button key={frame.id} type="button" aria-pressed={frameId === frame.id} className={`mt-1 flex w-full min-w-0 gap-1 rounded px-1 py-1 text-left text-xs ${frameId === frame.id ? 'bg-accent/10 text-accent' : 'text-ink-secondary hover:bg-surface-raised'}`} onClick={() => { setFrameId(frame.id); if (frame.source?.path) onOpenFile(frame.source.path, frame.line) }}><span className="min-w-0 flex-1 truncate">{frame.name}</span><span className="max-w-36 truncate">{frame.source?.name ?? frame.source?.path?.split('/').at(-1)}:{frame.line}</span></button>)}{!stopped && <p className="pt-1 text-xs text-ink-muted">{c.noFrames}</p>}</details>
        <details open className="border-b border-edge py-2"><summary className="cursor-pointer text-xs font-medium">{c.watches}</summary><form className="mt-1 flex gap-1" onSubmit={e => { e.preventDefault(); if (expression.trim()) { pin(expression.trim()); setExpression('') } }}><input className={`${input} flex-1`} aria-label={c.expression} placeholder={c.expression} value={expression} onChange={e => setExpression(e.target.value)} /><button type="submit" aria-label={c.add} data-tip={c.add} className={iconButton}><Plus width={16} /></button></form>{status?.config.watches.map(expression => { const value = watches.find(w => w.expression === expression); return <div key={expression} className={`flex min-w-0 gap-1 py-1 text-xs ${value?.changed ? 'bg-accent/10' : ''}`}><div className="min-w-0 flex-1 break-words font-mono">{expression}<span className="text-ink-secondary"> = {value?.value ?? '—'}</span>{value?.changed && <span className="pl-1 font-sans text-accent">{c.changed}</span>}</div><Action label={`${c.remove} ${expression}`} onClick={() => { const config = configRef.current!; void save({ ...config, watches: config.watches.filter(w => w !== expression) }) }}><Xmark width={13} /></Action></div> })}</details>
        <details open className="border-b border-edge py-2"><summary className="cursor-pointer text-xs font-medium">{c.variables}</summary>{variables.map((variable, index) => <VariableRow key={`${session?.stopRevision}:${frameId}:${variable.scope}:${variable.name}:${index}`} variable={variable} changed={variable.changed} c={c} load={async ref => (await command<{ variables: DebugVariable[] }>('variables', { variablesReference: ref, start: 0, count: 200 })).variables} pin={pin} />)}</details>
        <details className="py-2" open={session?.state === 'error' || undefined}><summary className="cursor-pointer text-xs font-medium">{c.output}</summary><pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-ink-secondary">{session?.output}</pre></details>
      </div>
    </section>
  </HoverTipLayer>
}
