export interface AnalysisRow { name: string; value: number; file?: string; line?: number; detail?: string; start?: number; traceId?: string; spanId?: string; parentSpanId?: string }
export interface DebugAnalysis { kind: 'cpu' | 'heap' | 'coverage' | 'trace' | 'sanitizer' | 'stops'; unit: string; rows: AnalysisRow[]; total: number }
const label = (value: unknown) => String(value ?? '').slice(0, 2048)
const number = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0 }
const call = (frame: any, value: number): AnalysisRow => ({ name: label(frame?.functionName || '(anonymous)'), value, file: typeof frame?.url === 'string' ? frame.url : undefined, line: Number.isSafeInteger(frame?.lineNumber) && frame.lineNumber >= 0 ? frame.lineNumber + 1 : undefined })
export function readDebugAnalysis(text: string): DebugAnalysis {
  if (text.length > 8_000_000) throw new Error('Analysis file exceeds 8MB')
  let data: any
  try { data = JSON.parse(text) } catch {
    if (!/(?:Address|Thread|Memory|UndefinedBehavior)Sanitizer|runtime error:/.test(text)) throw new Error('Supported: CPU/heap profiles, heap snapshots, V8 coverage, OTLP traces, debugger exports and sanitizer reports')
    const lines = text.split('\n'), rows: AnalysisRow[] = []
    for (const line of lines) {
      const location = /(?:^|\s)([^\s]+\.(?:c|cc|cpp|h|hpp|rs|go|py|js|ts)):(\d+)(?::\d+)?/.exec(line)
      if (location || /Sanitizer|runtime error:|SUMMARY:/.test(line)) rows.push({ name: label(line.trim()), value: 1, file: location?.[1], line: location ? Number(location[2]) : undefined })
    }
    return { kind: 'sanitizer', unit: 'entries', rows: rows.slice(0, 2000), total: rows.length }
  }
  if (!data || typeof data !== 'object') throw new Error('Invalid analysis file')
  let kind: DebugAnalysis['kind'], unit: string, rows: AnalysisRow[] = []
  if (Array.isArray(data.nodes) && Array.isArray(data.samples) && !data.snapshot) {
    if (data.nodes.length > 100000 || data.samples.length > 1_000_000) throw new Error('CPU profile exceeds sample limit')
    kind = 'cpu'; unit = Array.isArray(data.timeDeltas) ? 'ms' : 'samples'
    const totals = new Map<number, number>()
    for (let i = 0; i < data.samples.length; i++) totals.set(data.samples[i], (totals.get(data.samples[i]) ?? 0) + (unit === 'ms' ? number(data.timeDeltas[i]) : 1))
    rows = data.nodes.map((n: any) => call(n.callFrame, (totals.get(n.id) ?? 0) / (unit === 'ms' ? 1000 : 1))).filter((r: AnalysisRow) => r.value > 0)
  } else if (data.head?.callFrame && Array.isArray(data.head.children)) {
    kind = 'heap'; unit = 'bytes'; const pending = [data.head]
    for (let visited = 0; pending.length; visited++) {
      if (visited >= 100000) throw new Error('Heap profile exceeds node limit')
      const node = pending.pop(); if (number(node.selfSize)) rows.push(call(node.callFrame, number(node.selfSize)))
      if (Array.isArray(node.children)) for (const child of node.children.slice(0, 100000)) pending.push(child)
    }
  } else if (data.snapshot?.meta && Array.isArray(data.nodes) && Array.isArray(data.strings)) {
    kind = 'heap'; unit = 'bytes'; const fields = data.snapshot.meta.node_fields, width = fields?.length, name = fields?.indexOf('name'), size = fields?.indexOf('self_size')
    if (!width || name < 0 || size < 0 || data.nodes.length % width || data.nodes.length / width > 200000) throw new Error('Invalid or excessive heap snapshot')
    const totals = new Map<string, number>()
    for (let i = 0; i < data.nodes.length; i += width) { const key = label(data.strings[data.nodes[i + name]]); totals.set(key, (totals.get(key) ?? 0) + number(data.nodes[i + size])) }
    rows = [...totals].map(([name, value]) => ({ name, value }))
  } else if (Array.isArray(data.result) && (data.kind === 'coverage' || data.result.every((s: any) => Array.isArray(s.functions)))) {
    kind = 'coverage'; unit = 'hits'
    for (const script of data.result.slice(0, 2000)) for (const fn of script.functions.slice(0, 2000)) { const range = fn.ranges?.[0]; rows.push({ name: label(fn.functionName || '(anonymous)'), value: number(range?.count), file: label(script.url), detail: `offset ${number(range?.startOffset)} … ${number(range?.endOffset)}` }); if (rows.length >= 100000) throw new Error('Coverage exceeds function limit') }
  } else if (Array.isArray(data.resourceSpans)) {
    kind = 'trace'; unit = 'ms'; let earliest: bigint | undefined
    for (const resource of data.resourceSpans) for (const scope of resource.scopeSpans ?? []) for (const span of scope.spans ?? []) {
      if (rows.length >= 100000) throw new Error('Trace exceeds span limit')
      if (!/^\d+$/.test(String(span.startTimeUnixNano)) || !/^\d+$/.test(String(span.endTimeUnixNano))) throw new Error('Invalid OTLP span timestamps')
      const start = BigInt(span.startTimeUnixNano), end = BigInt(span.endTimeUnixNano)
      if (end < start) throw new Error('Invalid OTLP span duration')
      earliest = earliest === undefined || start < earliest ? start : earliest
      rows.push({ name: label(span.name), value: Number(end - start) / 1e6, detail: span.status?.code === 2 ? 'ERROR' : label(resource.resource?.attributes?.find((a: any) => a.key === 'service.name')?.value?.stringValue), start: Number(start / 1000n) / 1000, traceId: label(span.traceId), spanId: label(span.spanId), parentSpanId: label(span.parentSpanId) })
    }
    const origin = earliest === undefined ? 0 : Number(earliest / 1000n) / 1000
    rows = rows.map(row => ({ ...row, start: Math.max(0, row.start! - origin) }))
  } else if (data.version === 1 && Array.isArray(data.history)) {
    kind = 'stops'; unit = 'stops'
    for (const stop of data.history.slice(0, 32)) for (const variable of stop.variables ?? []) rows.push({ name: `#${stop.id} · ${label(variable.scope)} · ${label(variable.name)}`, value: 1, detail: label(variable.value) })
  } else throw new Error('Unrecognized analysis format')
  if (kind !== 'trace' && kind !== 'stops') rows.sort((a, b) => b.value - a.value)
  return { kind, unit, total: rows.length, rows: rows.slice(0, 2000) }
}
