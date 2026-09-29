import './test-isolated-data.ts'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DATA_DIR } from './dataDir.ts'
import { readProjectIcon, readProjectIcons, readRootProjectIcons, setProjectIcon, writeProjectIcon } from './projectIcons.ts'
import { WORKSPACE_ROOT, setWorkspaceRoot } from './paths.ts'
import { buildTree } from './tree.ts'
import { listCatalogChildren, readyFileCatalog, resetFileCatalogs } from './fileCatalog.ts'
import { renameProject } from './projects.ts'

const original = WORKSPACE_ROOT
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-icons-'))
setWorkspaceRoot(root)
after(() => { setWorkspaceRoot(original); fs.rmSync(root, { recursive: true, force: true }) })
const dir = (name: string) => {
  const value = path.join(root, name)
  fs.mkdirSync(path.join(value, '.mew'), { recursive: true })
  return value
}

test('sidebar, root tabs and nested tree read one project-owned SVG; reset survives legacy values', async () => {
  const alpha = dir('alpha')
  const nested = dir('plain/nested')
  const svg = 'svg:<svg viewBox="0 0 24 24"><path d="M1 1h10v10"/></svg>'
  fs.writeFileSync(path.join(DATA_DIR, 'project-icons.json'), JSON.stringify({ alpha: svg }))
  assert.equal(readProjectIcons().alpha, svg)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(alpha, '.mew/project-icon.json'), 'utf8')), { icon: svg })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'project-icons.json'), 'utf8')), {})
  assert.equal(readRootProjectIcons([alpha], { [alpha]: 'i:star' })[alpha], svg)
  writeProjectIcon(nested, '🌱')
  const tree = buildTree('.workspace', { showAll: true })
  assert.equal(tree.find(node => node.name === 'alpha')?.icon, svg)
  assert.equal(tree.find(node => node.name === 'plain')?.children?.find(node => node.name === 'nested')?.icon, '🌱')
  await readyFileCatalog('.workspace')
  assert.equal((await listCatalogChildren('.workspace', '', { showAll: true })).entries.find(node => node.name === 'alpha')?.icon, svg)
  writeProjectIcon(alpha, 'i:star')
  assert.equal((await listCatalogChildren('.workspace', '', { showAll: true })).entries.find(node => node.name === 'alpha')?.icon, 'i:star', 'cached tree resolves the current project file')
  assert.equal((await listCatalogChildren('.workspace', 'plain', { showAll: true })).entries.find(node => node.name === 'nested')?.icon, '🌱')
  resetFileCatalogs()
  setProjectIcon('alpha', null)
  assert.equal(readProjectIcon(alpha, 'i:star'), null)
  assert.equal(readProjectIcons().alpha, undefined)
  assert.equal(readProjectIcon(nested), '🌱')
})

test('project rename carries the canonical icon and legacy tab fallback is only used once', () => {
  const before = dir('before')
  assert.equal(readProjectIcon(before, 'i:book'), 'i:book')
  assert.equal(readProjectIcon(before, 'i:star'), 'i:book')
  renameProject('before', 'after')
  assert.equal(readProjectIcon(path.join(root, 'after')), 'i:book')
  assert.equal(fs.existsSync(before), false)
})

test('corrupt files and symlinks are not overwritten, and unsafe SVG is rejected', () => {
  const broken = dir('broken')
  const file = path.join(broken, '.mew/project-icon.json')
  fs.writeFileSync(file, '{"icon":')
  assert.throws(() => writeProjectIcon(broken, 'i:star'), /깨졌습니다/)
  assert.equal(fs.readFileSync(file, 'utf8'), '{"icon":')
  assert.equal(readProjectIcon(broken, 'i:book'), null)
  const linked = dir('linked')
  fs.symlinkSync(file, path.join(linked, '.mew/project-icon.json'))
  assert.throws(() => writeProjectIcon(linked, 'i:star'), /실제 파일/)
  const target = dir('target')
  fs.mkdirSync(path.join(root, 'marker-link'))
  fs.symlinkSync(path.join(target, '.mew'), path.join(root, 'marker-link/.mew'))
  assert.throws(() => writeProjectIcon(path.join(root, 'marker-link'), 'i:star'), /실제 폴더/)
  assert.throws(() => writeProjectIcon(target, 'svg:<svg><script>alert(1)</script></svg>'), /안전하지/)
  assert.equal(fs.existsSync(path.join(target, '.mew/project-icon.json')), false)
  assert.throws(() => readRootProjectIcons(['relative']), /경로 목록/)
})
