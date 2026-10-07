import { useCallback, useEffect, useRef, useState } from 'react'
import { HoverTipLayer, SelectField } from '@mew/ui'
import { ArrowDown, ArrowRight, ArrowUp, Pause, Play, Plus, Settings, Square, Xmark, RefreshDouble, Download, Undo, NavArrowDown } from 'iconoir-react'
import { useI18n } from '../i18n'
import { debuggerRequest, type DebuggerStatus } from '../api/debugger'
import { breakpointKey, type DebugConfig, type DebugSnapshot, type DebugVariable, type DebugScope } from '../../shared/debugger'
import { debuggerCopy } from './debugger-copy'
import { DockGrip } from './DockWorkspace'
import { DebuggerSourceField } from './debugger-source-field'
import { DebugAction as Action, DebugSection } from './debugger-controls'
import { PanelCloseButton } from './panel-close-button'
import { debugButton as iconButton, debugInput as input, debuggerExtra, downloadDebugFile, debugError, debugTextButton } from './debugger-helpers'
import { DebuggerVariable } from './debugger-variable'
import { DebuggerInspector } from './debugger-inspector'
import { DebuggerArtifacts } from './debugger-artifacts'
import { DebuggerBrowser } from './debugger-browser'

export default function DebuggerPanel({ root, onClose, onSettings, onOpenFile }: { root: string; onClose: () => void; onSettings: () => void; onOpenFile: (file: string, line: number) => void }) {
  const { locale } = useI18n(), c = { ...debuggerCopy[locale] ?? debuggerCopy.en, ...debuggerExtra(locale) }
  const [status, setStatus] = useState<DebuggerStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [file, setFile] = useState(''), [line, setLine] = useState(1), [expression, setExpression] = useState('')
  const [column, setColumn] = useState(''), [condition, setCondition] = useState(''), [hitCondition, setHitCondition] = useState(''), [logMessage, setLogMessage] = useState('')
  const [historyId, setHistoryId] = useState(''), [memoryReference, setMemoryReference] = useState(''), [hex, setHex] = useState(false), [granularity, setGranularity] = useState(''), [singleThread, setSingleThread] = useState(false)
  const [scopes, setScopes] = useState<DebugScope[]>([]), [extraScopes, setExtraScopes] = useState<string[]>([])
  const [functionName, setFunctionName] = useState(''), [instruction, setInstruction] = useState(''), [targets, setTargets] = useState<{ id: number; label: string }[]>([])
  const [locations, setLocations] = useState<{ file: string; line: number; positions: { line: number; column?: number }[] } | null>(null)
  const [targetKind, setTargetKind] = useState<'stepIn' | 'goto'>('stepIn')
  const [compound, setCompound] = useState(''), [programInput, setProgramInput] = useState(''), [inputProcess, setInputProcess] = useState('')
  const [profile, setProfile] = useState(''), [testRunner, setTestRunner] = useState('node'), [testFile, setTestFile] = useState(''), [testName, setTestName] = useState('')
  const [frameId, setFrameId] = useState<number | null>(null)
  const [variables, setVariables] = useState<(DebugVariable & { changed: boolean; scope: string; parent: number })[]>([])
  const [watches, setWatches] = useState<{ expression: string; value: string; changed: boolean; variable: DebugVariable }[]>([])
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
  const session = status?.session, history = session?.history?.find(h => String(h.id) === historyId), stopped = session?.state === 'stopped' && !history, live = !!session && ['starting', 'running', 'stopped'].includes(session.state), caps = session?.capabilities ?? {}
  const anyLive = status?.sessions?.some(s => ['starting', 'running', 'stopped'].includes(s.state)) ?? live
  const firstFrameId = session?.frames.find(f => f.presentationHint !== 'label')?.id ?? null
  useEffect(() => { setFrameId(stopped ? firstFrameId : null) }, [stopped, session?.id, session?.stopRevision, firstFrameId])
  const commandSession = session?.id, commandConnection = session?.connectionId, commandRevision = session?.stopRevision
  const command = useCallback(async <T = Record<string, unknown>,>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    return debuggerRequest<T>(root, '/command', { sessionId: commandSession, command: name, arguments: { connectionId: commandConnection, stopRevision: commandRevision, ...args } })
  }, [root, commandSession, commandConnection, commandRevision])
  useEffect(() => { setHistoryId(''); setMemoryReference(''); setTargets([]); setExtraScopes([]); setGranularity(''); setSingleThread(false); setHex(false); setInputProcess(''); previous.current.clear(); previousWatches.current.clear() }, [session?.id, session?.connectionId])
  const selectedFrame = session?.frames.find(f => f.id === frameId)
  const framePath = selectedFrame?.source?.path, frameName = selectedFrame?.name
  const watchKey = status?.config.watches.join('\u0000')
  const stopRevision = session?.stopRevision
  useEffect(() => {
    let cancelled = false
    if (!stopped || frameId === null) { setVariables([]); setWatches([]); return }
    async function inspect() {
      try {
        const result = await command<{ scopes: DebugScope[] }>('scopes', { frameId })
        if (cancelled) return
        setScopes(result.scopes)
        const rows: (DebugVariable & { changed: boolean; scope: string; parent: number })[] = []
        for (const scope of result.scopes.filter(scope => !scope.expensive || extraScopes.includes(scope.name))) {
          if (cancelled) return
          const result = await command<{ variables: DebugVariable[] }>('variables', { variablesReference: scope.variablesReference, start: 0, count: 200, ...(hex && caps.supportsValueFormattingOptions === true ? { format: { hex: true } } : {}) })
          for (const variable of result.variables.slice(0, 200)) {
            const key = JSON.stringify([session?.connectionId, session?.threadId, framePath, frameName, scope.name, variable.name]), old = previous.current.get(key)
            const changed = old && old.revision === stopRevision ? old.changed : old !== undefined && old.value !== variable.value
            rows.push({ ...variable, scope: scope.name, changed, parent: scope.variablesReference })
            if (!cancelled) previous.current.set(key, { value: variable.value, revision: stopRevision, changed })
          }
        }
        const values = []
        for (const expression of configRef.current?.watches ?? []) {
          if (cancelled) return
          let value: string
          let variable: DebugVariable = { name: expression, value: '', variablesReference: 0 }
          try { const evaluated = await command<DebugVariable & { result: string }>('evaluate', { expression, frameId, context: 'watch' }); value = evaluated.result; variable = { ...evaluated, name: expression, value } } catch (e) { value = e instanceof Error ? e.message : c.error; variable.value = value }
          const watchIdentity = JSON.stringify([session?.connectionId, session?.threadId, framePath, frameName, expression])
          const old = previousWatches.current.get(watchIdentity)
          const changed = old && old.revision === stopRevision ? old.changed : old !== undefined && old.value !== value
          values.push({ expression, value, changed, variable })
          if (!cancelled) previousWatches.current.set(watchIdentity, { value, revision: stopRevision, changed })
        }
        if (!cancelled) { setVariables(rows.sort((a, b) => Number(b.changed) - Number(a.changed))); setWatches(values) }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : c.error) }
    }
    void inspect()
    return () => { cancelled = true }
  // Every stop invalidates DAP variable references, even if the frame id is reused.
  }, [root, stopped, frameId, framePath, frameName, session?.id, session?.connectionId, session?.invalidationRevision, stopRevision, watchKey, command, session?.threadId, c.error, hex, extraScopes, caps.supportsValueFormattingOptions])
  async function save(config: DebugConfig) {
    ++configRevision.current; ++pendingSaves.current
    configRef.current = config; setStatus(previous => previous && { ...previous, config })
    const queued = saveQueue.current.catch(() => {}).then(() => debuggerRequest<DebugConfig>(root, '/config', config, 'PUT'))
    saveQueue.current = queued
    try { await queued } catch (e) { setError(e instanceof Error ? e.message : c.error); throw e } finally { --pendingSaves.current }
  }
  const pin = (expression: string) => { const config = configRef.current; if (config && !config.watches.includes(expression)) void save({ ...config, watches: [...config.watches, expression] }).catch(() => {}) }
  const persist = (config: DebugConfig) => void save(config).catch(() => {})
  async function action(name: string, args: Record<string, unknown> = {}) {
    setBusy(true); setError('')
    try {
      await saveQueue.current
      if (name === 'start' || name === 'startAdditional') await debuggerRequest(root, compound ? '/compound' : '/start', compound ? { name: compound } : { ...(profile ? { profile } : {}), additional: name === 'startAdditional' })
      else if (name === 'stop') await debuggerRequest(root, '/stop', { sessionId: current.current?.id })
      else if (name === 'select') await debuggerRequest(root, '/select', args)
      else await command(name, { ...(['next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue', 'continue'].includes(name) ? { ...(caps.supportsSteppingGranularity === true && granularity && name !== 'continue' && name !== 'reverseContinue' ? { granularity } : {}), ...(caps.supportsSingleThreadExecutionRequests === true && singleThread ? { singleThread: true } : {}) } : {}), ...args })
      const value = await debuggerRequest<DebuggerStatus>(root); current.current = value.session; setStatus(value)
      if (name === 'start' || name === 'startAdditional') { setHistoryId(''); previous.current.clear(); previousWatches.current.clear() }
    } catch (e) { setError(e instanceof Error ? e.message : c.error) }
    finally { setBusy(false) }
  }
  const variableProps = status && session ? { command, pin, caps, config: status.config, save, onMemory: setMemoryReference, connectionId: session.connectionId, sessionId: session.id ?? undefined, frameId } : null
  const currentInput = session?.inputProcesses?.some(p => String(p.id) === inputProcess) ? inputProcess : String(session?.inputProcesses?.[0]?.id ?? '')
  const extraMarker = (kind: 'function' | 'data' | 'instruction', key: string) => { const bp = session?.extraBreakpoints?.find(b => b.kind === kind && b.key === key); return <span role="img" aria-label={bp?.verified ? c.verified : c.unverified} data-tip={bp?.message || (bp?.verified ? c.verified : c.unverified)} className={`h-1.5 w-1.5 shrink-0 rounded-full ${bp?.verified ? 'bg-accent' : 'bg-ink-secondary'}`} /> }
  const breakpointsSection = <DebugSection key="breakpoints" title={c.breakpoints} count={status?.config.breakpoints.length} open>
          <form className="min-w-0" onSubmit={event => { event.preventDefault(); const config = configRef.current; if (!config || !file.trim()) return; const bp = { file: file.trim(), line, enabled: true, ...(column ? { column: Number(column) } : {}), ...(condition ? { condition } : {}), ...(hitCondition ? { hitCondition } : {}), ...(logMessage ? { logMessage } : {}) }; if (config.breakpoints.some(b => breakpointKey(b) === breakpointKey(bp))) return; persist({ ...config, breakpoints: [...config.breakpoints, bp] }); setFile('') }}>
            <div className="flex min-w-0 items-center gap-1"><DebuggerSourceField root={root} label={c.file} value={file} onChange={setFile} /><input className={`${input} w-16`} aria-label={c.line} type="number" min={1} value={line} onChange={e => setLine(Number(e.target.value))} required /><button type="submit" aria-label={c.add} data-tip={c.add} className={iconButton}><Plus width={16} /></button></div>
            {caps.supportsBreakpointLocationsRequest === true && <button type="button" disabled={!file || busy} className="py-1 text-xs text-accent disabled:opacity-40" onClick={() => void command<{ breakpoints: { line: number; column?: number }[] }>('breakpointLocations', { source: { path: file }, line, endLine: line }).then(result => setLocations({ file, line, positions: result.breakpoints })).catch(e => setError(e.message))}>{c.locations}</button>}
            {locations?.file === file && locations.line === line && <SelectField label={c.locations} compact value="" options={locations.positions.map((p, i) => ({ value: String(i), label: `${p.line}:${p.column ?? 1}` }))} onChange={value => { const position = locations.positions[Number(value)]; setLine(position.line); setColumn(String(position.column ?? 1)); setLocations(null) }} />}
            <details className="py-1"><summary className="cursor-pointer text-xs text-ink-muted">{c.options}</summary><div className="grid grid-cols-2 gap-1 py-1"><label className="text-xs text-ink-secondary">{c.column}<input aria-label={c.column} type="number" min={1} className={`${input} w-full`} value={column} onChange={e => setColumn(e.target.value)} /></label><label className="text-xs text-ink-secondary">{c.hitCondition}<input aria-label={c.hitCondition} disabled={live && !caps.supportsHitConditionalBreakpoints} className={`${input} w-full`} value={hitCondition} onChange={e => setHitCondition(e.target.value)} /></label><label className="col-span-2 text-xs text-ink-secondary">{c.condition}<input aria-label={c.condition} disabled={live && !caps.supportsConditionalBreakpoints} className={`${input} w-full font-mono`} value={condition} onChange={e => setCondition(e.target.value)} /></label><label className="col-span-2 text-xs text-ink-secondary">{c.logMessage}<input aria-label={c.logMessage} disabled={live && !caps.supportsLogPoints} className={`${input} w-full`} value={logMessage} onChange={e => setLogMessage(e.target.value)} /></label></div></details>
          </form>
          {status?.config.breakpoints.map((bp, index) => { const full = bp.file.startsWith('/') ? bp.file : `${root}/${bp.file}`, key = breakpointKey(bp), verified = session?.breakpoints.find(b => b.file === full && b.line === bp.line && b.column === bp.column); const change = (patch: Partial<typeof bp>) => { const config = configRef.current!; persist({ ...config, breakpoints: config.breakpoints.map((b, i) => i === index ? { ...b, ...patch } : b) }) }; return <details key={key} className="min-w-0"><summary className="flex min-h-8 min-w-0 cursor-pointer list-none items-center gap-1.5 rounded px-1 text-xs hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"><input type="checkbox" aria-label={`${bp.file}:${bp.line}`} checked={bp.enabled} onChange={e => change({ enabled: e.target.checked })} className="accent-accent" /><button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-ink hover:text-accent" aria-label={`${bp.file}:${bp.line}`} data-tip={`${bp.file}:${bp.line}`} onClick={e => { e.preventDefault(); onOpenFile(bp.file, bp.line) }}><span className="min-w-0 flex-1 truncate">{bp.file.split('/').at(-1)}</span><span className="shrink-0 font-mono tabular-nums text-ink-secondary">{bp.line}{bp.column ? `:${bp.column}` : ''}</span></button><span role="img" aria-label={verified?.verified ? c.verified : c.unverified} data-tip={verified?.message || (verified?.verified ? c.verified : c.unverified)} className={`h-1.5 w-1.5 shrink-0 rounded-full ${verified?.verified ? 'bg-accent' : 'bg-ink-secondary'}`} /><NavArrowDown width={12} aria-hidden="true" /><Action compact label={`${c.remove} ${bp.file}:${bp.line}`} onClick={() => { const config = configRef.current!; persist({ ...config, breakpoints: config.breakpoints.filter((_, i) => i !== index).map(b => b.trigger === key ? { ...b, trigger: undefined } : b) }) }}><Xmark width={13} /></Action></summary><div className="space-y-1 py-1">{(['condition', 'hitCondition', 'logMessage'] as const).map(field => <label key={field} className="block text-xs text-ink-secondary">{c[field]}<input className={`${input} w-full`} defaultValue={bp[field] ?? ''} onBlur={e => { if (e.target.value !== (bp[field] ?? '')) change({ [field]: e.target.value }) }} /></label>)}<SelectField label={c.trigger} compact value={bp.trigger ?? ''} options={[{ value: '', label: c.none }, ...status.config.breakpoints.filter(b => breakpointKey(b) !== key).map(b => ({ value: breakpointKey(b), label: `${b.file}:${b.line}` }))]} onChange={trigger => change({ trigger: trigger || undefined })} /><div className="flex gap-1"><Action label={c.runTo} disabled={!stopped || busy} onClick={() => void action('runTo', { file: bp.file, line: bp.line, ...(bp.column ? { column: bp.column } : {}) })}><Play width={14} /></Action>{caps.supportsGotoTargetsRequest === true && <button type="button" className="py-1 text-xs text-accent" disabled={!stopped || busy} onClick={() => { void command<{ targets: typeof targets }>('gotoTargets', { source: { path: full }, line: bp.line }).then(result => { setTargetKind('goto'); setTargets(result.targets) }).catch(e => setError(e.message)) }}>{c.goto}</button>}</div></div></details> })}
          {!status?.config.breakpoints.length && <p className="py-1 text-xs text-ink-secondary">{c.emptyBreakpoints}</p>}
          {status && (caps.supportsFunctionBreakpoints === true || caps.supportsInstructionBreakpoints === true || Array.isArray(caps.exceptionBreakpointFilters) || !!status.config.dataBreakpoints?.length) && <DebugSection title={c.advancedBreakpoints} count={(status.config.functionBreakpoints?.length ?? 0) + (status.config.dataBreakpoints?.length ?? 0) + (status.config.instructionBreakpoints?.length ?? 0)}>
            {status && caps.supportsFunctionBreakpoints === true && <details className="py-1"><summary className="cursor-pointer text-xs">{c.functions}</summary><form className="flex gap-1" onSubmit={e => { e.preventDefault(); if (functionName.trim()) { persist({ ...status.config, functionBreakpoints: [...status.config.functionBreakpoints ?? [], { name: functionName.trim(), enabled: true, ...(condition ? { condition } : {}), ...(hitCondition ? { hitCondition } : {}) }] }); setFunctionName('') } }}><input aria-label={c.functionName} placeholder={c.functionName} className={`${input} flex-1`} value={functionName} onChange={e => setFunctionName(e.target.value)} /><button type="submit" className={iconButton} aria-label={c.add}><Plus width={14} /></button></form>{status.config.functionBreakpoints?.map((b, i) => <div key={i} className="flex items-center gap-1 text-xs"><input type="checkbox" aria-label={b.name} checked={b.enabled} onChange={e => persist({ ...status.config, functionBreakpoints: status.config.functionBreakpoints?.map((p, j) => i === j ? { ...p, enabled: e.target.checked } : p) })} /><span className="min-w-0 flex-1 truncate">{b.name}</span>{extraMarker('function', b.name)}<Action label={`${c.remove} ${b.name}`} onClick={() => persist({ ...status.config, functionBreakpoints: status.config.functionBreakpoints?.filter((_, j) => i !== j) })}><Xmark width={13} /></Action></div>)}</details>}
          {status && Array.isArray(caps.exceptionBreakpointFilters) && <details className="py-1"><summary className="cursor-pointer text-xs">{c.exceptions}</summary>{(caps.exceptionBreakpointFilters as { filter: string; label: string; description?: string; default?: boolean }[]).map(f => <label key={f.filter} className="flex items-center gap-1 py-1 text-xs" data-tip={f.description}><input type="checkbox" className="accent-accent" checked={status.config.exceptionFilters?.includes(f.filter) ?? f.default ?? false} onChange={e => persist({ ...status.config, exceptionFilters: e.target.checked ? [...status.config.exceptionFilters ?? (caps.exceptionBreakpointFilters as { filter: string; default?: boolean }[]).filter(s => s.default).map(s => s.filter), f.filter] : (status.config.exceptionFilters ?? (caps.exceptionBreakpointFilters as { filter: string; default?: boolean }[]).filter(s => s.default).map(s => s.filter)).filter(v => v !== f.filter) })} />{f.label}</label>)}</details>}
          {status?.config.dataBreakpoints?.map((b, i) => <div key={b.dataId} className="flex items-center gap-1 py-1 text-xs"><input type="checkbox" aria-label={b.description} checked={b.enabled} onChange={e => persist({ ...status.config, dataBreakpoints: status.config.dataBreakpoints?.map((p, j) => i === j ? { ...p, enabled: e.target.checked } : p) })} /><span className="min-w-0 flex-1 truncate">{b.description} · {b.accessType}</span>{extraMarker('data', b.dataId)}<Action label={`${c.remove} ${b.description}`} onClick={() => persist({ ...status.config, dataBreakpoints: status.config.dataBreakpoints?.filter((_, j) => i !== j) })}><Xmark width={13} /></Action></div>)}
          {status && caps.supportsInstructionBreakpoints === true && <details className="py-1"><summary className="cursor-pointer text-xs">{c.instructions}</summary><form className="flex gap-1" onSubmit={e => { e.preventDefault(); if (instruction) { persist({ ...status.config, instructionBreakpoints: [...status.config.instructionBreakpoints ?? [], { instructionReference: instruction, enabled: true }] }); setInstruction('') } }}><input aria-label={c.instructionReference} placeholder={c.instructionReference} className={`${input} flex-1`} value={instruction} onChange={e => setInstruction(e.target.value)} /><button type="submit" className={iconButton} aria-label={c.add}><Plus width={14} /></button></form>{status.config.instructionBreakpoints?.map((b, i) => <div key={i} className="flex items-center gap-1 py-1 text-xs"><input type="checkbox" checked={b.enabled} aria-label={b.instructionReference} onChange={e => persist({ ...status.config, instructionBreakpoints: status.config.instructionBreakpoints?.map((p, j) => i === j ? { ...p, enabled: e.target.checked } : p) })} /><span className="min-w-0 flex-1 truncate">{b.instructionReference}</span>{extraMarker('instruction', b.instructionReference)}<Action label={`${c.remove} ${b.instructionReference}`} onClick={() => persist({ ...status.config, instructionBreakpoints: status.config.instructionBreakpoints?.filter((_, j) => i !== j) })}><Xmark width={13} /></Action></div>)}</details>}
          </DebugSection>}
        </DebugSection>
  return <HoverTipLayer className="flex h-full min-h-0 min-w-0 flex-col bg-surface text-ink" placement="bottom">
    <section aria-label={c.title} className="flex h-full min-h-0 min-w-0 flex-col">
      <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
        <DockGrip group="debugger" />
        <span className="min-w-0 flex-1 truncate px-2 text-xs font-medium">{c.title}</span>
        <span role="status" className={`mr-1 inline-flex min-w-0 items-center gap-1.5 truncate text-xs ${history ? 'text-warning-ink' : session?.state === 'error' ? 'text-danger-ink' : session?.state === 'stopped' ? 'text-accent' : 'text-ink-secondary'}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${history ? 'bg-warning' : session?.state === 'running' ? 'bg-success' : session?.state === 'error' ? 'bg-danger' : session?.state === 'stopped' ? 'bg-accent' : 'bg-ink-secondary'}`} />
          <span className="truncate">{history ? c.readOnly : session ? c[session.state] : c.loading}</span>
        </span>
        <Action label={c.manage} compact onClick={onSettings}><Settings width={14} /></Action>
        <PanelCloseButton aria-label={c.close} onClick={onClose} />
      </header>
      <div aria-label={c.title} role="toolbar" className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge bg-surface-deep px-2 py-1">
        <div className="flex items-center gap-0.5">
          <Action primary label={session?.state === 'running' ? c.pause : live ? c.continue : c.start} disabled={busy || !status || !!history || session?.state === 'starting'} onClick={() => void action(session?.state === 'running' ? 'pause' : live ? 'continue' : 'start')}>
            {session?.state === 'running' ? <Pause width={15} /> : <Play width={15} />}
            <span>{session?.state === 'running' ? c.pause : live ? c.continueShort : c.startShort}</span>
          </Action>
          <Action label={c.stop} disabled={!live} onClick={() => void action('stop')}><Square width={14} /></Action>
        </div>
        <div className="flex items-center border-l border-edge pl-1">
          <Action label={c.next} disabled={busy || !stopped} onClick={() => void action('next')}><ArrowRight width={16} /></Action>
          <Action label={c.stepIn} disabled={busy || !stopped} onClick={() => void action('stepIn')}><ArrowDown width={16} /></Action>
          <Action label={c.stepOut} disabled={busy || !stopped} onClick={() => void action('stepOut')}><ArrowUp width={16} /></Action>
          {caps.supportsRestartRequest === true && <Action label={c.restart} disabled={busy || !live || !!history} onClick={() => void action('restart')}><RefreshDouble width={15} /></Action>}
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {(error || session?.state === 'error') && <div role="alert" className={`m-2 ${debugError}`}>{error || session?.reason}</div>}
        {status && <DebugSection title={c.sessionOptions} meta={profile || status.config.kind}>
        {!!status?.config.profiles?.length && <SelectField label={c.profiles} compact disabled={busy} value={profile} options={[{ value: '', label: c.defaultProfile }, ...status.config.profiles.map(p => ({ value: p.name, label: p.name }))]} onChange={value => { setProfile(value); setCompound('') }} />}
        {!!status?.config.compounds?.length && <SelectField label={c.compounds} compact disabled={busy} value={compound} options={[{ value: '', label: c.none }, ...status.config.compounds.map(p => ({ value: p.name, label: p.name }))]} onChange={setCompound} />}
        {(status?.sessions?.length ?? 0) > 1 && <SelectField label={c.session} compact disabled={busy} value={session?.id ?? ''} options={status!.sessions!.map(s => ({ value: s.id, label: `${s.name} · ${c[s.state]}` }))} onChange={sessionId => void action('select', { sessionId })} />}
        {!anyLive && status && <details className="border-b border-edge py-1"><summary className="cursor-pointer text-xs text-ink-secondary">{c.tests}</summary><form className="space-y-1 py-1" onSubmit={e => { e.preventDefault(); setBusy(true); setError(''); void debuggerRequest<NonNullable<DebugConfig['profiles']>[number]>(root, '/profiles/test', { runner: testRunner, file: testFile, name: testName }).then(async p => { const config = configRef.current!; await save({ ...config, profiles: [...config.profiles?.filter(old => old.name !== p.name) ?? [], p] }); setProfile(p.name) }).catch(e => setError(e.message)).finally(() => setBusy(false)) }}><SelectField compact label={c.runner} value={testRunner} options={[{ value: 'node', label: 'Node.js · js-debug' }, { value: 'vitest', label: 'Vitest · js-debug' }, { value: 'pytest', label: 'pytest · debugpy' }, { value: 'go', label: 'Go test · Delve' }]} onChange={setTestRunner} /><DebuggerSourceField root={root} label={c.testFile} value={testFile} onChange={setTestFile} /><input aria-label={c.testName} placeholder={c.testName} className={`${input} w-full`} value={testName} onChange={e => setTestName(e.target.value)} /><button type="submit" disabled={busy || !testFile || ((testRunner === 'node' || testRunner === 'vitest') ? status.config.kind !== 'js-debug' && status.config.kind !== 'custom' : testRunner === 'pytest' ? status.config.kind !== 'debugpy' && status.config.kind !== 'custom' : status.config.kind !== 'delve' && status.config.kind !== 'custom')} className="py-1 text-xs text-accent disabled:opacity-40">{c.add}</button></form></details>}
        {!!session?.connections?.length && session.connections.length > 1 && <SelectField label={c.connection} compact value={session.connectionId ?? ''} options={session.connections.map(s => ({ value: s.id, label: `${s.name} · ${c[s.state]}`, disabled: s.state === 'terminated' }))} onChange={value => { setHistoryId(''); void action('selectConnection', { connectionId: value }) }} />}
        {!!session?.threads?.length && <div className="flex flex-wrap items-center gap-1 py-1"><div className="min-w-0 flex-1"><SelectField label={c.thread} compact value={String(session.threadId ?? '')} options={session.threads.map(t => ({ value: String(t.id), label: `${t.name}${t.stopped ? ` · ${c.stopped}` : ''}` }))} disabled={busy || !!history} onChange={value => void action('selectThread', { threadId: Number(value) })} /></div>{caps.supportsSingleThreadExecutionRequests === true && <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="accent-accent" checked={singleThread} onChange={e => setSingleThread(e.target.checked)} />{c.singleThread}</label>}</div>}
        {caps.supportsSteppingGranularity === true && <SelectField label={c.granularity} compact value={granularity} options={[{ value: '', label: c.none }, { value: 'line', label: c.line }, { value: 'statement', label: c.statement }, { value: 'instruction', label: c.instructions }]} onChange={setGranularity} />}
        {!!session?.history?.length && <div className="flex items-center gap-1 py-1"><div className="min-w-0 flex-1"><SelectField label={c.history} compact value={historyId} options={[{ value: '', label: c.live }, ...session.history.slice().reverse().map(h => ({ value: String(h.id), label: `#${h.id} · ${h.reason} · ${new Date(h.time).toLocaleTimeString()}` }))]} onChange={setHistoryId} /></div><Action label={c.export} onClick={() => downloadDebugFile('debug-session.json', JSON.stringify({ version: 1, target: status?.config.kind, breakpoints: status?.config.breakpoints, history: session.history }, null, 2))}><Download width={14} /></Action></div>}
          {live && <button type="button" disabled={busy || (status.sessions?.filter(s => ['starting', 'running', 'stopped'].includes(s.state)).length ?? 0) >= 8} className={debugTextButton} onClick={() => void action('startAdditional')}><Plus width={14} aria-hidden="true" />{c.addSession}</button>}
          {caps.supportsStepBack === true && <div className="flex items-center gap-1"><Action label={c.stepBack} disabled={busy || !stopped} onClick={() => void action('stepBack')}><Undo width={15} /></Action><span className="text-xs text-ink-secondary">{c.stepBack}</span><Action label={c.reverse} disabled={busy || !stopped} onClick={() => void action('reverseContinue')}><Undo width={15} /></Action><span className="text-xs text-ink-secondary">{c.reverse}</span></div>}
        </DebugSection>}
        {session?.progress?.map(p => <div key={p.id} role="status" className="flex items-center gap-1 py-1 text-xs"><span className="min-w-0 flex-1 truncate">{p.title} {p.percentage === undefined ? '' : `${p.percentage}%`} {p.message}</span>{p.cancellable && caps.supportsCancelRequest === true && <Action label={c.cancel} onClick={() => void action('cancel', { progressId: p.id })}><Xmark width={14} /></Action>}</div>)}
        {!stopped && !history && breakpointsSection}
        <DebugSection title={c.stack} count={(history?.frames ?? session?.frames)?.length} open={stopped || !!history}>{(history?.frames ?? session?.frames)?.map(frame => <div key={frame.id} className="flex min-w-0 items-center"><button type="button" aria-pressed={frameId === frame.id} disabled={frame.presentationHint === 'label'} data-tip={frame.source?.path} className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded px-1 text-left text-xs ${frameId === frame.id ? 'bg-accent/10 text-accent' : 'text-ink-secondary hover:bg-surface-raised'}`} onClick={() => { if (!history) setFrameId(frame.id); if (frame.source?.path) onOpenFile(frame.source.path, frame.line); if (frame.instructionPointerReference) setMemoryReference(frame.instructionPointerReference) }}><span className="min-w-0 flex-1 truncate">{frame.name}</span><span className="max-w-36 shrink-0 truncate font-mono tabular-nums text-ink-secondary">{frame.source?.name ?? frame.source?.path?.split('/').at(-1)}:{frame.line}</span></button>{caps.supportsRestartFrame === true && frame.canRestart !== false && <Action compact label={c.restartFrame} disabled={!stopped || busy} onClick={() => void action('restartFrame', { frameId: frame.id })}><RefreshDouble width={13} /></Action>}</div>)}{!stopped && !history && <p className="pt-1 text-xs text-ink-secondary">{c.noFrames}</p>}{stopped && session && (session.totalFrames === undefined ? session.frames.length > 0 && session.frames.length % 40 === 0 : session.frames.length < session.totalFrames) && session.frames.length < 200 && <button type="button" className="py-1 text-xs text-accent" onClick={() => void action('stackTrace', { startFrame: session.frames.length, levels: 40 })}>{c.more}</button>}{stopped && caps.supportsStepInTargetsRequest === true && frameId !== null && <button type="button" className="py-1 text-xs text-accent" onClick={() => void command<{ targets: typeof targets }>('stepInTargets', { frameId }).then(r => { setTargetKind('stepIn'); setTargets(r.targets) }).catch(e => setError(e.message))}>{c.targets}</button>}{!!targets.length && <SelectField label={c.targets} compact value="" options={targets.map(t => ({ value: String(t.id), label: t.label }))} onChange={value => { setTargets([]); void action(targetKind, { targetId: Number(value) }) }} />}</DebugSection>
        {history ? <DebugSection title={c.compare} count={history.variables.length + history.watches.length} open>{history.variables.map((v, i) => { const prior = session?.history?.filter(h => h.id < history.id && h.connectionId === history.connectionId).at(-1)?.variables.find(p => p.scope === v.scope && p.name === v.name); return <div key={i} className={`break-words py-1 font-mono text-xs ${prior && prior.value !== v.value ? 'bg-accent/10' : ''}`}>{v.name} = {prior && prior.value !== v.value ? `${prior.value} → ` : ''}{v.value}</div> })}{history.watches.map(w => <div key={w.expression} className="break-words py-1 font-mono text-xs">{w.expression} = {w.value}</div>)}{!history.variables.length && !history.watches.length && <div className="py-1 text-xs text-ink-muted">{c.noHistory}</div>}</DebugSection> : <>
          <DebugSection title={c.watches} count={status?.config.watches.length} open={!!status?.config.watches.length}><form className="mt-1 flex gap-1" onSubmit={e => { e.preventDefault(); if (expression.trim()) { pin(expression.trim()); setExpression('') } }}><input className={`${input} flex-1`} aria-label={c.expression} placeholder={c.expression} value={expression} onChange={e => setExpression(e.target.value)} /><button type="submit" aria-label={c.add} data-tip={c.add} className={iconButton}><Plus width={16} /></button></form>{status?.config.watches.map(expression => { const value = watches.find(w => w.expression === expression); return <div key={expression} className="flex min-w-0 items-start gap-1 py-1 text-xs"><div className="min-w-0 flex-1">{variableProps && <DebuggerVariable key={`${stopRevision}:${session?.invalidationRevision}:${expression}`} variable={value?.variable ?? { name: expression, value: '—', variablesReference: 0 }} changed={value?.changed} {...variableProps} />}</div><Action label={`${c.remove} ${expression}`} onClick={() => { const config = configRef.current!; persist({ ...config, watches: config.watches.filter(w => w !== expression) }) }}><Xmark width={13} /></Action></div> })}{!status?.config.watches.length && <p className="py-1 text-xs text-ink-secondary">{c.noWatches}</p>}</DebugSection>
          <DebugSection title={c.variables} count={variables.length} open={stopped}>{caps.supportsValueFormattingOptions === true && <label className="flex items-center justify-end gap-1 text-xs text-ink-secondary"><input type="checkbox" checked={hex} className="accent-accent" onChange={e => setHex(e.target.checked)} />{c.hex}</label>}{variableProps && variables.map((variable, index) => <div key={`${variable.scope}:${variable.name}:${index}`}>{scopes.length > 1 && (index === 0 || variables[index - 1].scope !== variable.scope) && <div className="border-b border-edge py-1 text-xs font-medium text-ink-secondary">{variable.scope}</div>}<DebuggerVariable key={`${stopRevision}:${session?.invalidationRevision}:${frameId}:${variable.scope}:${variable.name}:${index}:${hex}`} variable={variable} parent={variable.parent} changed={variable.changed} {...variableProps} /></div>)}{scopes.filter(s => s.expensive && !extraScopes.includes(s.name)).map(s => <button key={s.name} type="button" className="block py-1 text-xs text-accent" onClick={() => setExtraScopes(old => [...old, s.name])}>{c.expensive}: {s.name}</button>)}{!variables.length && <p className="py-1 text-xs text-ink-secondary">{c.noVariables}</p>}</DebugSection>
          {session && status && live && <DebuggerInspector snapshot={session} frameId={frameId} config={status.config} save={save} command={command} onOpenFile={onOpenFile} memoryReference={memoryReference} onMemory={setMemoryReference} pin={pin} />}
        </>}
        {(stopped || !!history) && breakpointsSection}
        {!!session?.inputProcesses?.length && <DebugSection title={c.outputInput}><SelectField compact label={c.connection} value={currentInput} options={session.inputProcesses.map(p => ({ value: String(p.id), label: `${p.name} · ${p.id}` }))} onChange={setInputProcess} /><form className="flex gap-1 py-1" onSubmit={e => { e.preventDefault(); void action('input', { processId: Number(currentInput), text: programInput + '\n' }); setProgramInput('') }}><input aria-label={c.outputInput} className={`${input} flex-1`} value={programInput} onChange={e => setProgramInput(e.target.value)} /><button type="submit" disabled={busy} className="px-1 text-accent" aria-label={c.send}><Play width={14} /></button><Action label={c.eof} disabled={busy} onClick={() => void action('input', { processId: Number(currentInput), text: '', end: true })}><Square width={13} /></Action></form></DebugSection>}
        <DebuggerBrowser root={root} />
        <DebuggerArtifacts onOpenFile={onOpenFile} />
        <DebugSection title={c.output} open={session?.state === 'error' || undefined}><pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-ink-secondary">{session?.output || c.noOutput}</pre></DebugSection>
      </div>
    </section>
  </HoverTipLayer>
}
