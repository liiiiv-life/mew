import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { changeLayoutPreset, factoryLayout, initialLayoutPresets, layoutFingerprint, layoutIconRects, layoutIconSvg, normalizeLayoutSnapshot, readLayoutPresets, layoutPresetsKey, legacyLayoutPresetsKey } from './layout-presets.ts'

const current = () => factoryLayout(normalizeLayoutSnapshot({ version: 1, dock: { version: 1, groups: [{ id: 'editor:main', kind: 'editor' }], tree: { id: 'editor:main' } } }))
test('layout equality ignores sessions and IDs but respects visible topology, ratios and sidebar geometry', () => {
  const base = current(), renamed = structuredClone(base)
  renamed.dock.groups[0].id = 'editor:new'
  const rename = (node: typeof renamed.dock.tree): void => { if (!node) return; if ('id' in node) { if (node.id === 'editor:main') node.id = 'editor:new' } else { rename(node.first); rename(node.second) } }
  rename(renamed.dock.tree)
  renamed.dock.active = { 'editor:new': 'secret-file.md' }
  renamed.dock.tabs = { 'editor:secret-file.md': 'editor:new' }
  assert.equal(layoutFingerprint(base), layoutFingerprint(renamed))
  renamed.sidebarWidth += 1
  assert.notEqual(layoutFingerprint(base), layoutFingerprint(renamed))
  renamed.sidebarWidth = base.sidebarWidth
  if (renamed.dock.tree && !('id' in renamed.dock.tree)) renamed.dock.tree.ratio = .6
  assert.notEqual(layoutFingerprint(base), layoutFingerprint(renamed))
  base.open.sidebar = renamed.open.sidebar = false
  renamed.dock.tree = structuredClone(base.dock.tree)
  rename(renamed.dock.tree)
  renamed.sidebarWidth = 400
  assert.equal(layoutFingerprint(base), layoutFingerprint(renamed), 'hidden dimensions do not create distinct layouts')
})
test('add and both replacement paths reject duplicates and deleting leaves unique numbered entries', () => {
  const factory = current(), presets = initialLayoutPresets(factory)
  assert.equal(new Set(presets.map(preset => layoutFingerprint(preset.layout))).size, 3)
  assert.equal(changeLayoutPreset(presets, factory).duplicate, true)
  assert.equal(changeLayoutPreset(presets, factory, presets[1].id).duplicate, true)
  const custom = structuredClone(factory); custom.sidebarWidth = 320
  const added = changeLayoutPreset(presets, custom)
  assert.equal(added.presets.length, 4)
  assert.equal(added.presets[3].number, 3)
  assert.equal(changeLayoutPreset(added.presets, custom, presets[2].id).duplicate, true)
  assert.equal(changeLayoutPreset(added.presets, custom, added.presets[3].id).duplicate, false)
  const withoutDefault = presets.filter(preset => preset.number !== 0)
  assert.equal(changeLayoutPreset(withoutDefault, factory, presets[1].id).duplicate, false)
})
test('equivalent rectangular grids and restricted initial layouts cannot create duplicate presets', () => {
  const base = current()
  base.dock.groups = ['editor', 'agent', 'terminal', 'git'].map(kind => ({ id: kind === 'editor' ? 'editor:main' : kind, kind: kind as 'editor' | 'agent' | 'terminal' | 'git' }))
  const leaf = (id: string) => ({ id })
  const split = (axis: 'row' | 'col', first: ReturnType<typeof leaf>, second: ReturnType<typeof leaf>) => ({ axis, ratio: .5, first, second })
  base.dock.tree = { axis: 'row', ratio: .5, first: split('col', leaf('editor:main'), leaf('terminal')), second: split('col', leaf('agent'), leaf('git')) }
  const equivalent = structuredClone(base)
  equivalent.dock.tree = { axis: 'col', ratio: .5, first: split('row', leaf('editor:main'), leaf('agent')), second: split('row', leaf('terminal'), leaf('git')) }
  assert.equal(layoutFingerprint(base), layoutFingerprint(equivalent), 'geometry matters more than split nesting')
  for (const panel of Object.keys(base.open) as (keyof typeof base.open)[]) base.open[panel] = panel === 'editor'
  const initial = initialLayoutPresets(base)
  assert.equal(new Set(initial.map(preset => layoutFingerprint(preset.layout))).size, 3)
})
test('SVG geometry recursively respects splits, hidden panels and floating tools, CLI shares exact output', () => {
  const layout = current(), rects = layoutIconRects(layout)
  assert.equal(rects.filter(rect => rect.role === 'editor').length, 1)
  for (const rect of rects) assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 64.001 && rect.y + rect.height <= 48.001)
  const original = layoutIconSvg(layout)
  layout.open.memo = true; layout.tools.memo = 'popup'; layout.popups.memo = { x: 100, y: 80, width: 300, height: 250 }
  assert.equal(layoutIconRects(layout).filter(rect => rect.role === 'popup').length, 1)
  assert.notEqual(layoutIconSvg(layout), original)
  const run = spawnSync(process.execPath, ['server/layout-icon-cli.ts'], { input: JSON.stringify(layout), encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.trim(), layoutIconSvg(layout))
  const invalid = spawnSync(process.execPath, ['server/layout-icon-cli.ts'], { input: '{}', encoding: 'utf8' })
  assert.equal(invalid.status, 1)
  assert.equal(invalid.stdout, '')
})

test('account presets merge old projects once, preserve names and isolate other accounts', t => {
  const values = new Map<string, string>()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value),
  } })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage') })
  const base = current(), a = initialLayoutPresets(base), b = initialLayoutPresets(base)
  a[1].name = '開発 화면'
  b[1].layout.sidebarWidth = 350
  values.set(legacyLayoutPresetsKey('first', '/alpha'), JSON.stringify(a))
  values.set(legacyLayoutPresetsKey('first', '/beta'), JSON.stringify(b))
  values.set(legacyLayoutPresetsKey('second', '/alpha'), JSON.stringify([{ ...b[1], name: '다른 계정' }]))
  const key = layoutPresetsKey('first')
  const merged = readLayoutPresets(key, base, legacyLayoutPresetsKey('first', '/alpha'))
  assert.equal(merged.length, 4)
  assert.equal(merged[1].name, '開発 화면')
  assert.equal(new Set(merged.map(preset => preset.id)).size, 4)
  assert.equal(new Set(merged.map(preset => preset.number)).size, 4)
  assert.deepEqual(readLayoutPresets(key, base, legacyLayoutPresetsKey('first', '/beta')), merged)
  assert.equal(values.has(legacyLayoutPresetsKey('first', '/beta')), true, 'migration retains old records')
  values.set(key, '[]')
  assert.deepEqual(readLayoutPresets(key, base, legacyLayoutPresetsKey('first', '/beta')), [], 'deleted presets do not return from legacy keys')
  assert.equal(readLayoutPresets(layoutPresetsKey('second'), base, legacyLayoutPresetsKey('second', '/alpha'))[0].name, '다른 계정')
})
