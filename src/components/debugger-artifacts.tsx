import { useRef, useState } from 'react'
import { Download, Folder, Xmark } from 'iconoir-react'
import { useI18n } from '../i18n'
import { readDebugAnalysis, type DebugAnalysis } from '../../shared/debugger-analysis'
import { DebugAction, DebugSection } from './debugger-controls'
import { debugInput, debuggerExtra, downloadDebugFile, debugError } from './debugger-helpers'

export function DebuggerArtifacts({ onOpenFile }: { onOpenFile: (file: string, line: number) => void }) {
  const { locale } = useI18n(), c = debuggerExtra(locale)
  const file = useRef<HTMLInputElement>(null), raw = useRef('')
  const [artifact, setArtifact] = useState<DebugAnalysis | null>(null), [name, setName] = useState(''), [error, setError] = useState(''), [filter, setFilter] = useState(''), [limit, setLimit] = useState(100)
  async function load(selected?: File) {
    if (!selected) return
    setError('')
    try { if (selected.size > 8_000_000) throw new Error('8MB'); const text = await selected.text(); const result = readDebugAnalysis(text); raw.current = text; setArtifact(result); setName(selected.name); setFilter(''); setLimit(100) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const rows = artifact?.rows.filter(row => !filter || `${row.name} ${row.file ?? ''} ${row.detail ?? ''} ${row.traceId ?? ''}`.toLowerCase().includes(filter.toLowerCase())) ?? []
  const max = Math.max(1, ...rows.map(r => r.value))
  return <DebugSection title={c.artifacts} count={artifact?.rows.length}>
    <div className="flex min-w-0 items-center py-1"><DebugAction label={c.openArtifact} onClick={() => file.current?.click()}><Folder width={15} /></DebugAction><input ref={file} type="file" className="hidden" accept=".json,.cpuprofile,.heapprofile,.heapsnapshot,.log,.txt" onChange={e => { void load(e.target.files?.[0]); e.target.value = '' }} /><span className="min-w-0 flex-1 truncate text-xs" data-tip={name}>{name || c.openArtifact}</span>{artifact && <><DebugAction label={c.export} onClick={() => downloadDebugFile(name, raw.current, 'application/octet-stream')}><Download width={14} /></DebugAction><DebugAction label={c.clear} onClick={() => { raw.current = ''; setArtifact(null); setName('') }}><Xmark width={14} /></DebugAction></>}</div>
    {error && <div role="alert" className={debugError}>{error}</div>}
    {artifact && <><div role="status" className="py-1 text-xs text-ink-muted">{artifact.kind} · {artifact.total} · {artifact.unit}</div><input className={`${debugInput} w-full`} aria-label={c.name} placeholder={c.name} value={filter} onChange={e => { setFilter(e.target.value); setLimit(100) }} /><div className="max-h-80 overflow-auto"><table className="w-full table-fixed text-left text-xs"><thead className="sticky top-0 bg-surface"><tr><th className="px-1 py-1 text-ink-secondary">{c.name}</th><th className="px-1 py-1 text-right text-ink-secondary">{c.value}</th></tr></thead><tbody>{rows.slice(0, limit).map((row, i) => <tr key={i} className="border-t border-edge"><td className="w-3/4 break-words py-1"><button type="button" disabled={!row.file} className="w-full break-words text-left text-ink-secondary disabled:text-ink" onClick={() => row.file && onOpenFile(row.file.replace(/^file:\/\//, ''), row.line ?? 1)}>{row.name}</button>{(row.detail || row.file) && <div className="break-all text-ink-muted">{row.detail ?? row.file}{row.line ? `:${row.line}` : ''}</div>}{row.traceId && <div className="break-all font-mono text-ink-muted">{row.traceId} · {row.spanId}{row.parentSpanId ? ` ← ${row.parentSpanId}` : ''} · +{row.start?.toFixed(2)}ms</div>}</td><td className="pl-1 text-right tabular-nums">{Number(row.value.toFixed(2)).toLocaleString()}<div className="h-0.5 bg-accent" style={{ width: `${row.value / max * 100}%`, marginLeft: 'auto' }} /></td></tr>)}</tbody></table></div>{rows.length > limit && <button type="button" className="py-1 text-xs text-accent" onClick={() => setLimit(old => old + 100)}>{c.more}</button>}</>}
  </DebugSection>
}
