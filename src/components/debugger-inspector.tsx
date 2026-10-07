import { useEffect, useState } from 'react'
import { Play, Plus, RefreshDouble, Download, EditPencil, Xmark } from 'iconoir-react'
import { useI18n } from '../i18n'
import type { DebugConfig, DebugSnapshot, DebugSource, DebugVariable } from '../../shared/debugger'
import { debuggerCopy } from './debugger-copy'
import { DebugAction } from './debugger-controls'
import { debugInput, debuggerExtra, downloadDebugFile, type DebugCommand } from './debugger-helpers'
import { DebuggerVariable } from './debugger-variable'

export function DebuggerInspector({ snapshot, frameId, config, save, command, onOpenFile, memoryReference, onMemory, pin }: {
  snapshot: DebugSnapshot; frameId: number | null; config: DebugConfig; save: (c: DebugConfig) => Promise<unknown>; command: DebugCommand; onOpenFile: (file: string, line: number) => void
  memoryReference: string; onMemory: (reference: string) => void; pin: (expression: string) => void
}) {
  const { locale } = useI18n(), c = { ...debuggerCopy[locale], ...debuggerExtra(locale) }, caps = snapshot.capabilities, stopped = snapshot.state === 'stopped'
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [text, setText] = useState('')
  const [consoleRows, setConsoleRows] = useState<{ text: string; result: DebugVariable }[]>([]), [suggestions, setSuggestions] = useState<{ label: string; text?: string; start?: number; length?: number }[]>([])
  const [reference, setReference] = useState(memoryReference), [offset, setOffset] = useState(0), [count, setCount] = useState(256)
  const [memory, setMemory] = useState<{ address?: string; data?: string; unreadableBytes?: number } | null>(null), [hex, setHex] = useState(''), [written, setWritten] = useState<number | null>(null)
  const [instructions, setInstructions] = useState<{ address: string; instruction: string; instructionBytes?: string; location?: DebugSource; line?: number }[]>([])
  const [modules, setModules] = useState<{ id: string | number; name: string; path?: string; symbolStatus?: string }[]>([]), [moduleTotal, setModuleTotal] = useState<number | null>(null)
  const [sources, setSources] = useState<DebugSource[]>([]), [source, setSource] = useState<{ content: string; mimeType?: string } | null>(null)
  const [exception, setException] = useState<Record<string, unknown> | null>(null)
  useEffect(() => { setReference(memoryReference); setMemory(null); setWritten(null) }, [memoryReference])
  useEffect(() => { setConsoleRows([]); setSources([]); setModules([]); setSource(null); setSuggestions([]); setMemory(null); setInstructions([]); setError('') }, [snapshot.id, snapshot.connectionId])
  useEffect(() => { setMemory(null); setException(null); setSuggestions([]); setConsoleRows(old => old.map(row => ({ ...row, result: { ...row.result, variablesReference: 0, memoryReference: undefined } }))) }, [snapshot.stopRevision, snapshot.state, snapshot.invalidationRevision])
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); try { await task() } catch (e) { setError(e instanceof Error ? e.message : c.error) } finally { setBusy(false) } }
  async function evaluate() {
    if (!text.trim()) return
    await run(async () => {
      const result = await command<DebugVariable & { result: string }>('evaluate', { expression: text, ...(frameId === null ? {} : { frameId }), context: 'repl' })
      setConsoleRows(old => [...old, { text, result: { ...result, name: text, value: result.result, evaluateName: text } }].slice(-64)); setText(''); setSuggestions([])
    })
  }
  const decode = (data: string) => Uint8Array.from(atob(data), char => char.charCodeAt(0))
  const bytes = memory?.data ? decode(memory.data) : new Uint8Array()
  const memoryLines = Array.from({ length: Math.ceil(bytes.length / 16) }, (_, i) => {
    const row = bytes.slice(i * 16, i * 16 + 16)
    let address = `+${i * 16}`
    try { if (memory?.address) address = `0x${(BigInt(memory.address) + BigInt(i * 16)).toString(16)}` } catch { /* opaque adapter address */ }
    return `${address.padEnd(18)} ${Array.from(row, b => b.toString(16).padStart(2, '0')).join(' ')}  ${Array.from(row, b => b >= 32 && b < 127 ? String.fromCharCode(b) : '.').join('')}`
  }).join('\n')
  async function read() {
    await run(async () => { const result = await command<NonNullable<typeof memory>>('readMemory', { memoryReference: reference, offset, count }); setMemory(result); setWritten(null); setHex(result.data ? Array.from(decode(result.data), b => b.toString(16).padStart(2, '0')).join(' ') : '') })
  }
  const variableProps = { command, caps, config, save, onMemory, connectionId: snapshot.connectionId, sessionId: snapshot.id ?? undefined, frameId, pin }
  return <>
    {error && <div role="alert" className="break-words py-1 text-xs text-red-400">{error}</div>}
    <details className="border-b border-edge py-2"><summary className="cursor-pointer text-xs font-medium">{c.console}</summary>
      <div className="max-h-72 overflow-auto py-1">{consoleRows.map((row, i) => <DebuggerVariable key={`${snapshot.stopRevision}:${i}`} variable={row.result} {...variableProps} />)}</div>
      <form className="flex gap-1" onSubmit={e => { e.preventDefault(); void evaluate() }}><input aria-label={c.console} disabled={!stopped || busy} className={`${debugInput} flex-1 font-mono`} value={text} onChange={e => { setText(e.target.value); setSuggestions([]) }} onKeyDown={e => { if (e.ctrlKey && e.code === 'Space' && caps.supportsCompletionsRequest) { e.preventDefault(); void run(async () => setSuggestions((await command<{ targets: typeof suggestions }>('completions', { text, column: text.length + 1, ...(frameId === null ? {} : { frameId }) })).targets)) } }} />
        <DebugAction label={c.execute} disabled={busy || !stopped || !text.trim()} onClick={() => void evaluate()}><Play width={14} /></DebugAction>
        {caps.supportsCompletionsRequest === true && <DebugAction label={c.completions} disabled={busy || !stopped} onClick={() => void run(async () => setSuggestions((await command<{ targets: typeof suggestions }>('completions', { text, column: text.length + 1, ...(frameId === null ? {} : { frameId }) })).targets))}><Plus width={14} /></DebugAction>}
      </form>
      {!!suggestions.length && <ul className="max-h-32 overflow-auto py-1">{suggestions.slice(0, 50).map((s, i) => <li key={i}><button type="button" className="w-full truncate px-1 py-1 text-left text-xs text-accent" onClick={() => { const start = Math.max(0, Math.min(text.length, s.start ?? 0)); setText(text.slice(0, start) + (s.text ?? s.label) + text.slice(start + Math.max(0, s.length ?? text.length))); setSuggestions([]) }}>{s.label}</button></li>)}</ul>}
    </details>
    {caps.supportsExceptionInfoRequest === true && <details className="border-b border-edge py-2"><summary className="cursor-pointer text-xs font-medium">{c.details}</summary><DebugAction label={c.refresh} disabled={!stopped || busy} onClick={() => void run(async () => setException(await command('exceptionInfo')))}><RefreshDouble width={14} /></DebugAction>{exception && <pre className="whitespace-pre-wrap break-words text-xs text-ink-secondary">{JSON.stringify(exception, null, 2)}</pre>}</details>}
    {(caps.supportsReadMemoryRequest === true || caps.supportsDisassembleRequest === true) && <details open={!!memoryReference || undefined} className="border-b border-edge py-2"><summary className="cursor-pointer text-xs font-medium">{c.memory}</summary>
      <label className="block py-1 text-xs text-ink-secondary">{c.reference}<input className={`${debugInput} w-full font-mono`} value={reference} onChange={e => { setReference(e.target.value); setMemory(null) }} /></label>
      <div className="flex flex-wrap items-end gap-1"><label className="min-w-0 flex-1 text-xs text-ink-secondary">{c.offset}<input aria-label={c.offset} type="number" className={`${debugInput} w-full`} value={offset} onChange={e => { setOffset(Number(e.target.value)); setMemory(null) }} /></label><label className="min-w-0 flex-1 text-xs text-ink-secondary">{c.count}<input aria-label={c.count} type="number" min={1} max={4096} className={`${debugInput} w-full`} value={count} onChange={e => setCount(Number(e.target.value))} /></label>
        {caps.supportsReadMemoryRequest === true && <DebugAction label={c.read} disabled={busy || !stopped || !reference} onClick={() => void read()}><RefreshDouble width={14} /></DebugAction>}
        {caps.supportsDisassembleRequest === true && <DebugAction label={c.disassemble} disabled={busy || !stopped || !reference} onClick={() => void run(async () => setInstructions((await command<{ instructions: typeof instructions }>('disassemble', { memoryReference: reference, offset, instructionCount: 64, resolveSymbols: true })).instructions))}><Play width={14} /></DebugAction>}
        {memory?.data && <DebugAction label={c.export} onClick={() => downloadDebugFile('debug-memory.bin', bytes, 'application/octet-stream')}><Download width={14} /></DebugAction>}
      </div>
      {memory && <><pre className="max-h-64 overflow-auto py-1 font-mono text-xs text-ink-secondary">{memoryLines}</pre>{!!memory.unreadableBytes && <div role="status" className="text-xs text-ink-muted">{c.unreadable}: {memory.unreadableBytes}</div>}
        {caps.supportsWriteMemoryRequest === true && <form onSubmit={e => { e.preventDefault(); void run(async () => { const clean = hex.replace(/\s/g, ''); if (clean.length > 8192 || !/^(?:[\da-f]{2})+$/i.test(clean)) throw new Error(c.hex); const data = btoa(String.fromCharCode(...clean.match(/../g)!.map(b => parseInt(b, 16)))); const result = await command<{ bytesWritten?: number }>('writeMemory', { memoryReference: reference, offset, data, allowPartial: false }); setWritten(result.bytesWritten ?? 0); setMemory(null) }) }}><label className="block text-xs text-ink-secondary">{c.hex}<textarea rows={3} spellCheck={false} className={`${debugInput} w-full font-mono`} value={hex} onChange={e => setHex(e.target.value)} /></label><button type="submit" disabled={busy || !stopped} className="flex items-center gap-1 px-1 py-1 text-xs text-accent disabled:opacity-40"><EditPencil width={14} />{c.write}</button></form>}</>}
      {written !== null && <div role="status" className="py-1 text-xs">{c.bytesWritten}: {written}</div>}
      {!!instructions.length && <div className="max-h-64 overflow-auto font-mono text-xs">{instructions.map((ins, i) => <div key={i} className="flex min-w-0 items-center gap-1 border-t border-edge py-0.5"><span className="shrink-0 text-ink-muted">{ins.address}</span><button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => ins.location?.path && onOpenFile(ins.location.path, ins.line ?? 1)}>{ins.instruction}</button>{caps.supportsInstructionBreakpoints === true && <DebugAction label={`${c.instructions}: ${ins.address}`} onClick={() => void save({ ...config, instructionBreakpoints: [...config.instructionBreakpoints?.filter(b => b.instructionReference !== ins.address) ?? [], { instructionReference: ins.address, enabled: true }] }).catch(e => setError(String(e)))}><Plus width={13} /></DebugAction>}</div>)}</div>}
    </details>}
    {caps.supportsModulesRequest === true && <details className="border-b border-edge py-2"><summary className="cursor-pointer text-xs font-medium">{c.modules}</summary><DebugAction label={c.refresh} disabled={busy} onClick={() => void run(async () => { const result = await command<{ modules: typeof modules; totalModules?: number }>('modules'); setModules(result.modules); setModuleTotal(result.totalModules ?? null) })}><RefreshDouble width={14} /></DebugAction>{modules.map(m => <div key={m.id} className="break-words border-t border-edge py-1 text-xs">{m.name}<span className="pl-1 text-ink-muted">{m.symbolStatus ?? m.path}</span></div>)}{modules.length > 0 && modules.length < 2000 && (moduleTotal === null ? modules.length % 200 === 0 : modules.length < moduleTotal) && <button type="button" disabled={busy} className="py-1 text-xs text-accent" onClick={() => void run(async () => { const result = await command<{ modules: typeof modules }>('modules', { startModule: modules.length, moduleCount: 200 }); setModules(old => [...old, ...result.modules]) })}>{c.more}</button>}</details>}
    {(caps.supportsLoadedSourcesRequest === true || snapshot.frames.some(f => f.source?.sourceReference)) && <details className="border-b border-edge py-2"><summary className="cursor-pointer text-xs font-medium">{c.sources}</summary>{caps.supportsLoadedSourcesRequest === true && <DebugAction label={c.refresh} disabled={busy} onClick={() => void run(async () => setSources((await command<{ sources: DebugSource[] }>('loadedSources')).sources))}><RefreshDouble width={14} /></DebugAction>}{[...sources, ...snapshot.frames.filter(f => f.source?.sourceReference).map(f => f.source!)].map((s, i) => <button key={i} type="button" className="block w-full truncate border-t border-edge py-1 text-left text-xs text-ink-secondary" onClick={() => s.sourceReference ? void run(async () => setSource(await command('source', { sourceReference: s.sourceReference }))) : s.path && onOpenFile(s.path, 1)}>{s.name ?? s.path}</button>)}</details>}
    {source && <details open className="border-b border-edge py-2"><summary className="flex cursor-pointer items-center text-xs font-medium"><span className="flex-1">{c.source}</span><DebugAction label={c.close} onClick={() => setSource(null)}><Xmark width={14} /></DebugAction></summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{source.content}</pre></details>}
  </>
}
