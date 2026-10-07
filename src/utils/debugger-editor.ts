import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, hoverTooltip, keymap, type DecorationSet } from '@codemirror/view'
import { getUiLocale } from '@mew/ui/i18n-core'
import { debuggerCopy } from '../components/debugger-copy'
import { debuggerRequest, type DebuggerStatus } from '../api/debugger'
import { breakpointKey, type DebugConfig } from '../../shared/debugger'

type Marks = { breakpoints: { line: number; enabled: boolean; verified: boolean; key: string; column?: number }[]; line?: number }
export const setDebugMarks = StateEffect.define<Marks>()
export const debugMarks = StateField.define<Marks>({ create: () => ({ breakpoints: [] }), update(value, tr) {
  if (tr.docChanged) value = { ...value, breakpoints: value.breakpoints.filter(b => b.line > 0 && b.line <= tr.startState.doc.lines).map(b => {
    const old = tr.startState.doc.line(b.line), position = tr.changes.mapPos(Math.min(old.to, old.from + Math.max(0, (b.column ?? 1) - 1)), 1), line = tr.newDoc.lineAt(position)
    return { ...b, line: line.number, column: b.column === undefined ? undefined : position - line.from + 1, verified: false }
  }) }
  for (const effect of tr.effects) if (effect.is(setDebugMarks)) value = effect.value
  return value
} })
const debugLine = StateField.define<DecorationSet>({ create: () => Decoration.none, update(_value, tr) { const line = tr.state.field(debugMarks).line; return line && line <= tr.newDoc.lines ? Decoration.set([Decoration.line({ class: 'cm-debugger-execution' }).range(tr.newDoc.line(line).from)]) : Decoration.none }, provide: field => EditorView.decorations.from(field) })
class Marker extends GutterMarker {
  readonly enabled: boolean
  readonly verified: boolean
  constructor(enabled: boolean, verified: boolean) { super(); this.enabled = enabled; this.verified = verified }
  eq(other: Marker) { return other.enabled === this.enabled && other.verified === this.verified }
  toDOM() { const el = document.createElement('span'); el.className = `cm-debugger-marker${this.enabled ? '' : ' cm-debugger-disabled'}${this.verified ? ' cm-debugger-verified' : ''}`; el.setAttribute('aria-label', debuggerCopy[getUiLocale()].breakpoints); return el }
}
interface Store { status?: DebuggerStatus; controller: AbortController; listeners: Set<(status?: DebuggerStatus) => void>; timer?: ReturnType<typeof setTimeout>; saving: Promise<unknown>; pending: number; revision: number }
const stores = new Map<string, Store>()
const storeKey = (root: string, account: string) => JSON.stringify([root, account])
export function subscribeDebugger(root: string, account: string, listener: (status?: DebuggerStatus) => void) {
  const key = storeKey(root, account)
  let store = stores.get(key)
  if (!store) { store = { controller: new AbortController(), listeners: new Set(), saving: Promise.resolve(), pending: 0, revision: 0 }; stores.set(key, store) }
  store.listeners.add(listener); listener(store.status)
  const current = store
  async function refresh() {
    try { const revision = current.revision; const status = await debuggerRequest<DebuggerStatus>(root, '', undefined, 'GET', current.controller.signal); if (!current.controller.signal.aborted) { if (current.status && (current.pending || revision !== current.revision)) status.config = current.status.config; current.status = status; for (const callback of current.listeners) callback(status) } }
    catch { if (!current.controller.signal.aborted) { current.status = undefined; for (const callback of current.listeners) callback(undefined) } }
    if (!current.controller.signal.aborted) current.timer = setTimeout(refresh, 1000)
  }
  if (current.listeners.size === 1) void refresh()
  return () => { current.listeners.delete(listener); if (!current.listeners.size) { current.controller.abort(); clearTimeout(current.timer); stores.delete(key) } }
}
export function debuggerEditorExtension(root: string, account: string, file: string, lineOffset = 0, relocate = false): { extension: Extension; attach: (view: EditorView) => () => void } {
  let status: DebuggerStatus | undefined
  const absolute = file.startsWith('/') ? file : `${root}/${file}`
  const relative = absolute.startsWith(root + '/') ? absolute.slice(root.length + 1) : file
  const matches = (path: string) => path === absolute || path === relative
  let view: EditorView | undefined, errorTimer: ReturnType<typeof setTimeout> | undefined
  const showError = (error: unknown) => {
    if (!view) return
    const el = document.createElement('div'); el.className = 'cm-debugger-error'; el.setAttribute('role', 'alert'); el.textContent = error instanceof Error ? error.message : String(error); view.dom.querySelector('.cm-debugger-error')?.remove(); view.dom.append(el); clearTimeout(errorTimer); errorTimer = setTimeout(() => el.remove(), 6000)
  }
  const save = (change: (c: DebugConfig) => DebugConfig) => {
    const store = stores.get(storeKey(root, account)); if (!store?.status) return
    const config = change(store.status.config)
    store.status = { ...store.status, config }; ++store.pending; ++store.revision
    for (const callback of store.listeners) callback(store.status)
    store.saving = store.saving.catch(() => {}).then(async () => {
      if (!store.controller.signal.aborted) await debuggerRequest<DebugConfig>(root, '/config', config, 'PUT', store.controller.signal)
    }).catch(showError).finally(() => { --store.pending })
  }
  const toggle = (line: number) => {
    if (!status) return
    save(config => { const existing = config.breakpoints.find(b => matches(b.file) && b.line === line && !b.column); if (existing) { const key = breakpointKey(existing); return { ...config, breakpoints: config.breakpoints.filter(b => b !== existing).map(b => b.trigger === key ? { ...b, trigger: undefined } : b) } } return { ...config, breakpoints: [...config.breakpoints, { file: relative, line, enabled: true }] } })
  }
  const extension: Extension = [debugMarks, debugLine, gutter({ class: 'cm-debugger-gutter', initialSpacer: () => new Marker(false, false), lineMarker(v, line) { const number = v.state.doc.lineAt(line.from).number; const bp = v.state.field(debugMarks).breakpoints.find(b => b.line === number); return bp ? new Marker(bp.enabled, bp.verified) : null }, lineMarkerChange: update => update.state.field(debugMarks) !== update.startState.field(debugMarks), domEventHandlers: { mousedown(v, line, event) { if ((event as MouseEvent).button !== 0 || !status) return false; event.preventDefault(); toggle(v.state.doc.lineAt(line.from).number + lineOffset); return true } } }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged || !relocate || lineOffset) return
      const before = update.startState.field(debugMarks).breakpoints, after = update.state.field(debugMarks).breakpoints
      const moved = after.filter(b => before.some(old => old.key === b.key && (old.line !== b.line || old.column !== b.column)))
      if (!moved.length) return
      // Notifications dispatch marks; wait until the current editor transaction has completed.
      queueMicrotask(() => { if (view) save(config => {
        const keys = new Map<string, string>()
        const breakpoints = config.breakpoints.map(b => { const next = moved.find(m => m.key === breakpointKey(b)); if (!next) return b; const result = { ...b, line: next.line, column: next.column }; keys.set(breakpointKey(b), breakpointKey(result)); return result })
        return { ...config, breakpoints: breakpoints.map(b => b.trigger && keys.has(b.trigger) ? { ...b, trigger: keys.get(b.trigger) } : b) }
      }) })
    }),
    keymap.of([{ key: 'F9', run(v) { if (!status) return false; toggle(v.state.doc.lineAt(v.state.selection.main.head).number + lineOffset); return true } }, { key: 'Shift-F9', run(v) { if (status?.session.state !== 'stopped') return false; const line = v.state.doc.lineAt(v.state.selection.main.head); void debuggerRequest(root, '/command', { sessionId: status.session.id, command: 'runTo', arguments: { connectionId: status.session.connectionId, stopRevision: status.session.stopRevision, file: relative, line: line.number + lineOffset, column: v.state.selection.main.head - line.from + 1 } }).catch(showError); return true } }]),
    hoverTooltip(async (v, pos) => {
      const current = status?.session
      if (current?.state !== 'stopped' || current.capabilities.supportsEvaluateForHovers !== true || !current.frames[0] || !matches(current.frames[0].source?.path ?? '')) return null
      const line = v.state.doc.lineAt(pos), index = pos - line.from
      const word = [...line.text.matchAll(/[A-Za-z_$][\w$]*/g)].find(m => m.index <= index && m.index + m[0].length >= index)
      if (!word) return null
      try { const result = await debuggerRequest<{ result: string }>(root, '/command', { sessionId: current.id, command: 'evaluate', arguments: { connectionId: current.connectionId, stopRevision: current.stopRevision, frameId: current.frames[0].id, expression: word[0], context: 'hover' } }); if (current.id !== status?.session.id || current.stopRevision !== status.session.stopRevision) return null; return { pos: line.from + word.index, end: line.from + word.index + word[0].length, create() { const dom = document.createElement('div'); dom.className = 'cm-debugger-hover'; dom.textContent = `${word[0]} = ${result.result.slice(0, 4096)}`; return { dom } } } } catch { return null }
    }, { hoverTime: 600 }),
    EditorView.theme({ '.cm-debugger-gutter': { width: '20px', cursor: 'pointer' }, '.cm-debugger-gutter .cm-gutterElement': { padding: '0 4px' }, '.cm-debugger-marker': { display: 'inline-block', width: '10px', height: '10px', border: '1px solid var(--color-accent)', borderRadius: '50%' }, '.cm-debugger-verified': { background: 'var(--color-accent)' }, '.cm-debugger-disabled': { opacity: '0.35' }, '.cm-debugger-execution': { background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }, '.cm-debugger-hover': { maxWidth: '320px', padding: '4px 6px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--color-ink)', background: 'var(--color-surface-raised)', fontSize: '12px' }, '.cm-debugger-error': { position: 'sticky', bottom: '0', padding: '4px 6px', background: 'var(--color-surface-raised)', color: 'var(--color-ink)', fontSize: '12px' } })]
  return { extension, attach(v) { view = v; const unsubscribe = subscribeDebugger(root, account, next => { status = next; const frame = next?.session.state === 'stopped' ? next.session.frames.find(f => matches(f.source?.path ?? '')) : undefined; if (view) view.dispatch({ effects: setDebugMarks.of({ breakpoints: next?.config.breakpoints.filter(b => matches(b.file)).map(b => ({ key: breakpointKey(b), column: b.column, line: b.line - lineOffset, enabled: b.enabled, verified: next.session.breakpoints.some(p => matches(p.file) && p.line === b.line && p.column === b.column && p.verified) })) ?? [], line: frame ? frame.line - lineOffset : undefined }) }) }); return () => { view = undefined; unsubscribe(); clearTimeout(errorTimer) } } }
}
