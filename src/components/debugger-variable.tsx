import { useState } from 'react'
import { SelectField } from '@mew/ui'
import { NavArrowDown, NavArrowRight, Pin, EditPencil, Plus, Database, Check, Xmark } from 'iconoir-react'
import { useI18n } from '../i18n'
import type { DebugConfig, DebugDataBreakpoint, DebugVariable } from '../../shared/debugger'
import { debuggerCopy } from './debugger-copy'
import { DebugAction } from './debugger-controls'
import { debugInput, debuggerExtra, debugError, debugTextButton, type DebugCommand } from './debugger-helpers'

export function DebuggerVariable({ variable, parent, changed = false, command, pin, caps, config, save, onMemory, connectionId, sessionId, frameId, depth = 0 }: {
  variable: DebugVariable; parent?: number; changed?: boolean; command: DebugCommand; pin: (expression: string) => void; caps: Record<string, unknown>
  config: DebugConfig; save: (config: DebugConfig) => Promise<unknown>; onMemory: (reference: string) => void; connectionId?: string; sessionId?: string; frameId?: number | null; depth?: number
}) {
  const { locale } = useI18n(), c = { ...debuggerCopy[locale], ...debuggerExtra(locale) }
  const [children, setChildren] = useState<DebugVariable[]>([]), [open, setOpen] = useState(false), [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [more, setMore] = useState(false), [edit, setEdit] = useState(false), [value, setValue] = useState(variable.value)
  const [filter, setFilter] = useState<string>(variable.indexedVariables ? 'indexed' : ''), [view, setView] = useState<'tree' | 'table' | 'chart'>('tree')
  const [data, setData] = useState<{ dataId: string | null; description: string; accessTypes?: DebugDataBreakpoint['accessType'][]; canPersist?: boolean } | null>(null)
  const [access, setAccess] = useState<DebugDataBreakpoint['accessType']>('write')
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : c.error)
  async function load(start: number, selectedFilter = filter) {
    if (busy || children.length >= 2000) return
    setBusy(true); setError('')
    try {
      const result = await command<{ variables: DebugVariable[] }>('variables', { variablesReference: variable.variablesReference, start, count: 100, ...(selectedFilter ? { filter: selectedFilter } : {}) })
      setChildren(old => start ? [...old, ...result.variables] : result.variables); setLoaded(true)
      const total = selectedFilter === 'indexed' ? variable.indexedVariables : selectedFilter === 'named' ? variable.namedVariables : undefined
      setMore(result.variables.length === 100 && (total === undefined || start + result.variables.length < total))
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  async function change() {
    if (busy || !parent && !variable.evaluateName) return
    setBusy(true); setError('')
    try { await command(parent ? 'setVariable' : 'setExpression', parent ? { variablesReference: parent, name: variable.name, value } : { expression: variable.evaluateName, value, ...(frameId == null ? {} : { frameId }) }); setEdit(false) } catch (e) { fail(e) } finally { setBusy(false) }
  }
  async function info() {
    setBusy(true); setError('')
    try {
      const result = await command<NonNullable<typeof data>>('dataBreakpointInfo', { variablesReference: parent, name: variable.name })
      if (!result.dataId) throw new Error(result.description || c.unsupported)
      setData(result); setAccess(result.accessTypes?.includes('write') ? 'write' : result.accessTypes?.[0] ?? 'write')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const numeric = children.map(v => (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.value) ? Number(v.value) : NaN))
  const finite = numeric.filter(Number.isFinite), low = Math.min(0, ...finite), high = Math.max(1, ...finite)
  const points = numeric.slice(0, 200).map((v, i) => Number.isFinite(v) ? `${(i / Math.max(1, Math.min(200, numeric.length) - 1)) * 280},${90 - (v - low) / (high - low) * 80}` : '').filter(Boolean).join(' ')
  return <div className="min-w-0" data-debug-variable={variable.name}>
    <div className={`flex min-h-7 min-w-0 items-start gap-1 rounded px-1 py-0.5 text-xs hover:bg-surface-raised ${changed ? 'bg-accent/10' : ''}`} style={{ paddingLeft: Math.min(depth, 8) * 10 }}>
      {variable.variablesReference > 0 ? <button type="button" aria-label={`${open ? '−' : '+'} ${variable.name}`} aria-expanded={open} disabled={busy} className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-ink-secondary focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40" onClick={() => { setOpen(!open); if (!loaded && !open) void load(0) }}>{open ? <NavArrowDown width={12} aria-hidden="true" /> : <NavArrowRight width={12} aria-hidden="true" />}</button> : <span className="w-5 shrink-0" />}
      <div className="min-w-0 flex-1 break-words py-0.5 font-mono leading-5 [overflow-wrap:anywhere]">
        <span className="text-ink">{variable.name}</span><span className="px-1 text-ink-secondary">=</span>
        <span className={`whitespace-pre-wrap ${variable.type === 'number' || variable.type === 'boolean' ? 'text-syntax-number' : variable.type === 'string' ? 'text-syntax-string' : 'text-ink-secondary'}`} data-tip={variable.type}>{variable.value}</span>
        {changed && <span className="ml-1 font-sans text-accent">{c.changed}</span>}
        {variable.presentationHint?.lazy && <span className="ml-1 font-sans text-ink-secondary">{c.lazy}</span>}
      </div>
      <div className="flex shrink-0 items-center">
        {variable.evaluateName && <DebugAction compact label={`${c.pin}: ${variable.name}`} disabled={config.watches.includes(variable.evaluateName)} onClick={() => pin(variable.evaluateName!)}><Pin width={13} /></DebugAction>}
        {((parent && caps.supportsSetVariable === true) || (!parent && variable.evaluateName && caps.supportsSetExpression === true)) && !variable.presentationHint?.attributes?.some(a => ['readOnly', 'constant'].includes(a)) && <DebugAction compact label={`${c.edit}: ${variable.name}`} pressed={edit} disabled={busy} onClick={() => { setEdit(!edit); setValue(variable.value) }}><EditPencil width={13} /></DebugAction>}
        {parent && caps.supportsDataBreakpoints === true && <DebugAction compact label={`${c.data}: ${variable.name}`} disabled={busy} onClick={() => void info()}><Plus width={13} /></DebugAction>}
        {variable.memoryReference && caps.supportsReadMemoryRequest === true && <DebugAction compact label={`${c.memory}: ${variable.name}`} onClick={() => onMemory(variable.memoryReference!)}><Database width={13} /></DebugAction>}
      </div>
    </div>
    {edit && <form className="flex gap-1 py-1" onSubmit={e => { e.preventDefault(); void change() }}><input autoFocus aria-label={`${c.value}: ${variable.name}`} className={`${debugInput} flex-1`} value={value} onChange={e => setValue(e.target.value)} /><DebugAction label={c.save} disabled={busy} onClick={() => void change()}><Check width={14} /></DebugAction><DebugAction label={c.close} onClick={() => setEdit(false)}><Xmark width={14} /></DebugAction></form>}
    {data?.dataId && <div className="flex flex-wrap items-center gap-1 py-1 text-xs"><span className="min-w-0 flex-1 break-words">{data.description}</span><SelectField label={c.access} compact value={access ?? 'write'} options={(data.accessTypes ?? ['write']).map(value => ({ value: value!, label: value === 'read' ? c.readAccess : value === 'readWrite' ? c.both : c.writeAccess }))} onChange={value => setAccess(value as DebugDataBreakpoint['accessType'])} /><DebugAction label={c.add} disabled={busy} onClick={() => { void save({ ...config, dataBreakpoints: [...config.dataBreakpoints?.filter(b => b.dataId !== data.dataId) ?? [], { dataId: data.dataId!, description: data.description, accessType: access, canPersist: data.canPersist, connectionId, sessionId, enabled: true }] }).then(() => setData(null)).catch(fail) }}><Plus width={14} /></DebugAction><DebugAction label={c.close} onClick={() => setData(null)}><Xmark width={14} /></DebugAction></div>}
    {error && <div role="alert" className={debugError}>{error}</div>}
    {open && <div className="min-w-0">
      {!!children.length && <div className="flex flex-wrap gap-1 py-1"><SelectField compact label={c.value} value={view} options={[{ value: 'tree', label: c.variables }, { value: 'table', label: c.table }, { value: 'chart', label: c.chart, disabled: !finite.length }]} onChange={value => setView(value as typeof view)} />{variable.indexedVariables !== undefined && <SelectField compact label={c.variables} value={filter} options={[{ value: '', label: c.all }, { value: 'named', label: c.named }, { value: 'indexed', label: c.indexed }]} onChange={value => { setFilter(value); void load(0, value) }} />}</div>}
      {view === 'tree' && children.map((child, i) => <DebuggerVariable key={`${child.name}:${i}`} variable={child} parent={variable.variablesReference} command={command} caps={caps} pin={pin} config={config} save={save} onMemory={onMemory} connectionId={connectionId} sessionId={sessionId} frameId={frameId} depth={depth + 1} />)}
      {view === 'table' && <div className="max-h-64 overflow-auto"><table className="w-full text-left font-mono text-xs"><thead className="sticky top-0 bg-surface text-ink-secondary"><tr><th className="px-1 py-1">{c.name}</th><th className="px-1 py-1">{c.value}</th></tr></thead><tbody>{children.map((v, i) => <tr key={i} className="border-t border-edge"><td className="px-1 py-1">{v.name}</td><td className="break-all px-1 py-1">{v.value}</td></tr>)}</tbody></table></div>}
      {view === 'chart' && finite.length > 0 && <svg role="img" aria-label={`${c.chart}: ${variable.name}`} viewBox="0 0 280 100" className="h-28 w-full text-accent"><title>{`${low} … ${high}`}</title><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>}
      {busy && <span role="status" className="text-xs text-ink-muted">{c.loading}</span>}
      {more && children.length < 2000 && <button type="button" disabled={busy} className={debugTextButton} onClick={() => void load(children.length)}>{c.more}</button>}
    </div>}
  </div>
}
