import { defaultDockTree, dockIds, normalizeDock, pruneDock, type DockKind, type DockNode, type DockState } from './dock-layout.ts'

export const layoutPanels = ['sidebar', 'editor', 'agent', 'terminal', 'git', 'browser', 'features', 'memo', 'tasks', 'debugger', 'chat', 'android'] as const
export type LayoutPanel = typeof layoutPanels[number]
export type PopupRect = { x: number; y: number; width: number; height: number }
export type LayoutSnapshot = {
  version: 1
  dock: DockState
  open: Record<LayoutPanel, boolean>
  sidebarWidth: number
  androidWidth: number
  tools: { memo: 'tab' | 'popup'; tasks: 'tab' | 'popup' }
  popups: Partial<Record<'memo' | 'tasks', PopupRect>>
}
export type LayoutPreset = { id: string; number: number; name?: string; layout: LayoutSnapshot }
const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
export function normalizeLayoutSnapshot(value: unknown): LayoutSnapshot {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<LayoutSnapshot>
  const popups: LayoutSnapshot['popups'] = {}
  for (const tool of ['memo', 'tasks'] as const) {
    const rect = raw.popups?.[tool]
    if (rect && ['x', 'y', 'width', 'height'].every(key => typeof rect[key as keyof PopupRect] === 'number' && Number.isFinite(rect[key as keyof PopupRect]))) {
      popups[tool] = { x: number(rect.x, 0, 0, 10000), y: number(rect.y, 0, 0, 10000), width: number(rect.width, 420, 240, 10000), height: number(rect.height, 480, 160, 10000) }
    }
  }
  return {
    version: 1, dock: { ...normalizeDock(raw.dock), tabs: {}, active: {} },
    open: Object.fromEntries(layoutPanels.map(id => [id, raw.open?.[id] === true])) as LayoutSnapshot['open'],
    sidebarWidth: number(raw.sidebarWidth, 256, 180, 480), androidWidth: number(raw.androidWidth, 760, 380, 1200),
    tools: { memo: raw.tools?.memo === 'popup' ? 'popup' : 'tab', tasks: raw.tools?.tasks === 'popup' ? 'popup' : 'tab' }, popups,
  }
}

/** Compare geometry and panel kinds, never generated group IDs, sessions or active tabs. */
export function layoutFingerprint(value: LayoutSnapshot): string {
  const layout = normalizeLayoutSnapshot(value)
  const visible = new Set(layout.dock.groups.filter(group => layout.open[group.kind] && !(group.kind in layout.tools && layout.tools[group.kind as 'memo' | 'tasks'] === 'popup')).map(group => group.id))
  const geometry: (string | number)[][] = []
  const walk = (node: DockNode | null, x = 0, y = 0, width = 1, height = 1) => {
    if (!node) return
    if ('id' in node) {
      geometry.push([layout.dock.groups.find(group => group.id === node.id)!.kind, ...[x, y, width, height].map(value => Math.round(value * 1000))])
      return
    }
    if (node.axis === 'row') {
      walk(node.first, x, y, width * node.ratio, height)
      walk(node.second, x + width * node.ratio, y, width * (1 - node.ratio), height)
    } else {
      walk(node.first, x, y, width, height * node.ratio)
      walk(node.second, x, y + height * node.ratio, width, height * (1 - node.ratio))
    }
  }
  walk(pruneDock(layout.dock.tree, visible))
  geometry.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  return JSON.stringify({
    geometry, open: layout.open,
    sidebar: layout.open.sidebar ? Math.round(layout.sidebarWidth) : null,
    android: layout.open.android ? Math.round(layout.androidWidth) : null,
    popups: (['memo', 'tasks'] as const).filter(tool => layout.open[tool] && layout.tools[tool] === 'popup').map(tool => [tool, layout.popups[tool] ?? { x: 24, y: 24, width: 420, height: 480 }]),
  })
}

export function factoryLayout(current: LayoutSnapshot): LayoutSnapshot {
  const editor = current.dock.groups.find(group => group.kind === 'editor') ?? { id: 'editor:main', kind: 'editor' as const }
  const groups = [editor, ...(['terminal', 'git', 'agent', 'features', 'tasks'] as DockKind[]).map(kind => ({ id: kind, kind }))]
  return normalizeLayoutSnapshot({ ...current, dock: { version: 1, groups, tree: defaultDockTree({ id: editor.id }, groups), tabs: {}, active: {} },
    open: Object.fromEntries(layoutPanels.map(id => [id, ['sidebar', 'editor', 'terminal', 'git', 'agent', 'features', 'tasks'].includes(id)])), sidebarWidth: 256, tools: { memo: 'tab', tasks: 'tab' }, popups: {} })
}
export function initialLayoutPresets(factory: LayoutSnapshot): LayoutPreset[] {
  const editor = factory.dock.groups.find(group => group.kind === 'editor')!
  const focus = normalizeLayoutSnapshot({ ...factory, dock: { ...factory.dock, tree: { id: editor.id } }, open: { editor: true, sidebar: factory.open.sidebar } })
  const terminal = factory.dock.groups.find(group => group.kind === 'terminal')!
  const coding = normalizeLayoutSnapshot({ ...factory, dock: { ...factory.dock, tree: { axis: 'col', ratio: .7, first: { id: editor.id }, second: { id: terminal.id } } }, open: { editor: true, sidebar: factory.open.terminal ? factory.open.sidebar : false, terminal: factory.open.terminal } })
  const result: LayoutPreset[] = []
  for (const [index, candidate] of [factory, focus, coding].entries()) {
    let layout = candidate
    if (result.some(preset => layoutFingerprint(preset.layout) === layoutFingerprint(layout))) {
      const second = { id: `editor:layout-${index}`, kind: 'editor' as const }
      layout = normalizeLayoutSnapshot({ ...focus, dock: { ...focus.dock, groups: [...focus.dock.groups, second], tree: { axis: index === 1 ? 'row' : 'col', ratio: .5, first: { id: editor.id }, second: { id: second.id } } } })
    }
    result.push({ id: `initial-${index}`, number: index, layout })
  }
  return result
}
export function changeLayoutPreset(presets: LayoutPreset[], layout: LayoutSnapshot, id?: string): { presets: LayoutPreset[]; duplicate: boolean } {
  const normalized = normalizeLayoutSnapshot(layout), fingerprint = layoutFingerprint(normalized)
  if (presets.some(preset => preset.id !== id && layoutFingerprint(preset.layout) === fingerprint)) return { presets, duplicate: true }
  if (id) return { presets: presets.map(preset => preset.id === id ? { ...preset, layout: normalized } : preset), duplicate: false }
  const nextNumber = Math.max(0, ...presets.map(preset => preset.number)) + 1
  return { presets: [...presets, { id: `preset-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`, number: nextNumber, layout: normalized }], duplicate: false }
}
export const layoutPresetsKey = (account: string) => `mew:layout-presets:${encodeURIComponent(account)}`
export const legacyLayoutPresetsKey = (account: string, workspace: string) => `${layoutPresetsKey(account)}:${encodeURIComponent(workspace)}`
function parseLayoutPresets(raw: unknown): LayoutPreset[] | null {
  if (!Array.isArray(raw)) return null
  const result: LayoutPreset[] = []
  for (const item of raw) {
    if (!item || typeof item.id !== 'string' || item.id.length > 100 || !Number.isSafeInteger(item.number) || item.number < 0 || item.layout?.version !== 1 || result.some(preset => preset.id === item.id)) continue
    const layout = normalizeLayoutSnapshot(item.layout)
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 60) : undefined
    if (!result.some(preset => layoutFingerprint(preset.layout) === layoutFingerprint(layout))) result.push({ id: item.id, number: item.number, ...(name ? { name } : {}), layout })
  }
  return result
}
export function readLayoutPresets(key: string, factory: LayoutSnapshot, legacyKey?: string): LayoutPreset[] {
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null) return parseLayoutPresets(JSON.parse(stored)) ?? initialLayoutPresets(factory)
    if (!legacyKey) return initialLayoutPresets(factory)
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((candidate): candidate is string => !!candidate && candidate.startsWith(key + ':'))
      .sort((a, b) => a === legacyKey ? -1 : b === legacyKey ? 1 : a.localeCompare(b))
    const merged: LayoutPreset[] = []
    let found = false
    for (const oldKey of keys) {
      let old: LayoutPreset[] | null
      try { old = parseLayoutPresets(JSON.parse(localStorage.getItem(oldKey) ?? 'null')) } catch { continue }
      if (!old) continue
      found = true
      for (const preset of old) {
        if (merged.some(saved => layoutFingerprint(saved.layout) === layoutFingerprint(preset.layout))) continue
        const number = merged.some(saved => saved.number === preset.number) ? Math.max(0, ...merged.map(saved => saved.number)) + 1 : preset.number
        const id = merged.some(saved => saved.id === preset.id) ? `migrated-${globalThis.crypto.randomUUID()}` : preset.id
        merged.push({ ...preset, id, number })
      }
    }
    if (!found) return initialLayoutPresets(factory)
    try { localStorage.setItem(key, JSON.stringify(merged)) } catch { /* Original project presets remain available for a later retry. */ }
    return merged
  } catch { return initialLayoutPresets(factory) }
}

/** A deterministic miniature: header, dock, sidebar, nested splits and floating tools. */
export function layoutIconRects(value: LayoutSnapshot): (PopupRect & { role: 'chrome' | 'editor' | 'panel' | 'popup' })[] {
  const layout = normalizeLayoutSnapshot(value)
  const rects: ReturnType<typeof layoutIconRects> = [{ x: 1, y: 1, width: 62, height: 4, role: 'chrome' }, { x: 1, y: 7, width: 3, height: 40, role: 'chrome' }]
  let x = 6, width = 57
  if (layout.open.sidebar) { const w = Math.min(18, layout.sidebarWidth / 1200 * 57); rects.push({ x, y: 7, width: w, height: 40, role: 'panel' }); x += w + 2; width -= w + 2 }
  for (const id of ['android', 'chat'] as const) if (layout.open[id]) {
    const w = Math.min(width * .4, id === 'android' ? layout.androidWidth / 1200 * 57 : 12)
    rects.push({ x: x + width - w, y: 7, width: w, height: 40, role: 'panel' }); width -= w + 2
  }
  const visible = new Set(layout.dock.groups.filter(group => layout.open[group.kind] && !(group.kind in layout.tools && layout.tools[group.kind as 'memo' | 'tasks'] === 'popup')).map(group => group.id))
  const walk = (node: DockNode | null, rect: PopupRect) => {
    if (!node) return
    if ('id' in node) { rects.push({ ...rect, role: layout.dock.groups.find(group => group.id === node.id)?.kind === 'editor' ? 'editor' : 'panel' }); return }
    const horizontal = node.axis === 'row', length = (horizontal ? rect.width : rect.height) - 2, first = length * node.ratio
    walk(node.first, { ...rect, [horizontal ? 'width' : 'height']: first })
    walk(node.second, { ...rect, [horizontal ? 'x' : 'y']: (horizontal ? rect.x : rect.y) + first + 2, [horizontal ? 'width' : 'height']: length - first })
  }
  walk(pruneDock(layout.dock.tree, visible), { x, y: 7, width, height: 40 })
  for (const tool of ['memo', 'tasks'] as const) if (layout.open[tool] && layout.tools[tool] === 'popup') {
    const popup = layout.popups[tool] ?? { x: 24, y: 24, width: 420, height: 480 }
    const w = Math.min(width, popup.width / 1200 * width), h = Math.min(40, popup.height / 800 * 40)
    rects.push({ x: x + Math.min(width - w, popup.x / 1200 * width), y: 7 + Math.min(40 - h, popup.y / 800 * 40), width: w, height: h, role: 'popup' })
  }
  return rects.filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({ ...rect, x: +rect.x.toFixed(3), y: +rect.y.toFixed(3), width: +rect.width.toFixed(3), height: +rect.height.toFixed(3) }))
}
export function layoutIconSvg(layout: LayoutSnapshot): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48" fill="none" stroke="currentColor" stroke-width="1.5">${layoutIconRects(layout).map(rect => `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="1" fill="${rect.role === 'popup' ? 'var(--color-surface-raised, white)' : 'currentColor'}" fill-opacity="${rect.role === 'popup' ? 1 : rect.role === 'editor' ? .16 : .06}"/>`).join('')}</svg>`
}
export function editorIds(layout: LayoutSnapshot): string[] {
  return layout.dock.groups.filter(group => group.kind === 'editor' && dockIds(layout.dock.tree).includes(group.id)).map(group => group.id.slice('editor:'.length))
}
