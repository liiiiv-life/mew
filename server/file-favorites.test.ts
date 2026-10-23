import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-favorites-state-'))
process.env.MEW_DATA_DIR = data
const { discoverFileFavorites, mergeFileFavorites, changeFileFavorite, listFileFavorites } = await import('./file-favorites.ts')
const { readFileFavorites, readRootProjects, writeRootProjects } = await import('./userUiState.ts')
test.after(() => fs.rm(data, { recursive: true, force: true }))

test('macOS defaults include accessible standard and cloud folders, deduplicating aliases', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-favorites-mac-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  for (const folder of ['Desktop', 'Downloads', 'Documents', 'Library/Mobile Documents/com~apple~CloudDocs', 'Library/CloudStorage/OneDrive-Personal', 'Library/CloudStorage/GoogleDrive-test']) await fs.mkdir(path.join(home, folder), { recursive: true })
  await fs.symlink(path.join(home, 'Library/CloudStorage/OneDrive-Personal'), path.join(home, 'OneDrive'))
  await fs.writeFile(path.join(home, 'Pictures'), 'not a folder')
  const before = await fs.readdir(home, { recursive: true })
  const result = await discoverFileFavorites({ home, platform: 'darwin', env: {}, volumes: path.join(home, 'Volumes') })
  assert.deepEqual(result.slice(0, 4).map(folder => folder.kind), ['home', 'desktop', 'downloads', 'documents'])
  assert.deepEqual(result.filter(folder => folder.kind === 'cloud').map(folder => folder.provider).sort(), ['google-drive', 'icloud', 'onedrive'])
  assert.equal(result.length, new Set(result.map(folder => folder.path)).size)
  assert.equal(result.some(folder => folder.kind === 'pictures'), false)
  assert.deepEqual(await fs.readdir(home, { recursive: true }), before)
})

test('WSL adds C drive, WSL home, Windows profiles and OneDrive redirected Desktop', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-favorites-wsl-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const windowsDrive = path.join(root, 'mnt/c')
  const windowsUsers = path.join(windowsDrive, 'Users')
  for (const folder of ['home', 'mnt/c/Users/Alice/Downloads', 'mnt/c/Users/Alice/OneDrive/Desktop', 'mnt/c/Users/Bob/Desktop', 'mnt/c/Users/Public/Desktop']) await fs.mkdir(path.join(root, folder), { recursive: true })
  const options = { home, windowsDrive, windowsUsers, platform: 'linux' as const, env: { WSL_DISTRO_NAME: 'Ubuntu' } }
  const result = await discoverFileFavorites(options)
  assert.equal(result[0].kind, 'wsl-home')
  assert.ok(result.some(folder => folder.kind === 'drive' && folder.path === windowsDrive))
  assert.ok(result.some(folder => folder.kind === 'downloads' && folder.account === 'Alice'))
  assert.ok(result.some(folder => folder.kind === 'desktop' && folder.path.endsWith('/OneDrive/Desktop')))
  assert.ok(result.some(folder => folder.kind === 'desktop' && folder.account === 'Bob'))
  assert.equal(result.some(folder => folder.path.includes('/Public/')), false)
  const service = await discoverFileFavorites({ ...options, env: {}, release: '6.6.87.2-microsoft-standard-WSL2' })
  assert.ok(service.some(folder => folder.kind === 'wsl-home'))
  assert.ok(service.some(folder => folder.provider === 'onedrive'))
  const linux = await discoverFileFavorites({ ...options, env: {}, release: '6.6.0-generic' })
  assert.deepEqual(linux.map(folder => folder.kind), ['home'])
})

test('favorites persist per account, canonicalize additions and remember removed defaults', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-favorites-custom-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const folder = path.join(root, 'chosen')
  await fs.mkdir(folder)
  await fs.symlink(folder, path.join(root, 'alias'))
  writeRootProjects('User@example.test', { paths: [root], icons: {} })
  await changeFileFavorite('User@example.test', { path: folder, favorite: true })
  await changeFileFavorite('user@example.test', { path: path.join(root, 'alias'), favorite: true })
  assert.deepEqual(readFileFavorites('USER@example.test').added, [folder])
  assert.deepEqual(readFileFavorites('other@example.test'), { added: [], hidden: [] })
  assert.deepEqual(readRootProjects('user@example.test')?.paths, [root])
  assert.ok((await listFileFavorites('user@example.test')).some(item => item.path === folder))
  await fs.rm(folder, { recursive: true })
  await changeFileFavorite('user@example.test', { path: folder, favorite: false })
  const defaults = [{ path: folder, kind: 'desktop' as const, name: 'Desktop' }]
  assert.deepEqual(mergeFileFavorites(defaults, readFileFavorites('user@example.test')), [])
  await fs.mkdir(folder)
  await changeFileFavorite('user@example.test', { path: folder, favorite: true })
  assert.deepEqual(mergeFileFavorites(defaults, readFileFavorites('user@example.test')), defaults)
  await assert.rejects(changeFileFavorite('user@example.test', { path: 'relative', favorite: true }))
  await assert.rejects(changeFileFavorite('user@example.test', { path: folder, favorite: 'true' }))
  await fs.writeFile(path.join(root, 'file'), '')
  await assert.rejects(changeFileFavorite('user@example.test', { path: path.join(root, 'file'), favorite: true }))
  const stored = JSON.parse(await fs.readFile(path.join(data, 'user-ui-state.json'), 'utf8'))
  assert.deepEqual(stored['user@example.test'].fileFavorites.added, [folder])
})
