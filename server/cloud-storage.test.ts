import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { discoverCloudStorage } from './cloud-storage.ts'

test('macOS discovers accounts and iCloud, skips files and deduplicates aliases without changing disk', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-cloud-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const roots = ['Library/CloudStorage/OneDrive-Personal', 'Library/CloudStorage/OneDrive-Team', 'Library/CloudStorage/GoogleDrive-user@example.test', 'Library/CloudStorage/Dropbox', 'Library/Mobile Documents/com~apple~CloudDocs']
  for (const root of roots) await fs.mkdir(path.join(home, root), { recursive: true })
  await fs.symlink(path.join(home, roots[0]), path.join(home, 'OneDrive'))
  await fs.symlink(path.join(home, 'missing'), path.join(home, 'Dropbox-broken'))
  await fs.writeFile(path.join(home, 'Google Drive'), 'not a folder')
  await fs.mkdir(path.join(home, 'OneDriveNotes'))
  const before = await fs.readdir(home, { recursive: true })
  const found = await discoverCloudStorage({ home, platform: 'darwin', env: {}, volumes: path.join(home, 'Volumes') })
  assert.deepEqual(found.map(folder => folder.path).sort(), roots.map(root => path.join(home, root)).sort())
  assert.equal(found.find(folder => folder.provider === 'icloud')?.name, 'iCloud Drive')
  assert.deepEqual(await fs.readdir(home, { recursive: true }), before)
})

test('Linux uses shallow home discovery and existing OneDrive environment paths', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-cloud-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  for (const root of ['onedrive', 'Google Drive', 'Dropbox (Personal)', 'custom-sync', 'nested/OneDrive', 'Library/Mobile Documents/com~apple~CloudDocs']) await fs.mkdir(path.join(home, root), { recursive: true })
  const env = { OneDrive: path.join(home, 'custom-sync'), OneDriveConsumer: path.join(home, 'onedrive'), OneDriveCommercial: path.join(home, 'missing') }
  const found = await discoverCloudStorage({ home, platform: 'linux', env, release: '6.6.0-generic' })
  assert.deepEqual(found.map(folder => folder.path).sort(), ['onedrive', 'Google Drive', 'Dropbox (Personal)', 'custom-sync'].map(root => path.join(home, root)).sort())
  assert.deepEqual(await discoverCloudStorage({ home: path.join(home, 'missing'), platform: 'linux', env: {}, release: '6.6.0-generic' }), [])
})

test('Windows profile folders are offered only inside WSL, with canonical paths', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-cloud-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const windowsUsers = path.join(home, 'Users')
  const folder = path.join(windowsUsers, 'Alice', 'OneDrive - Work')
  await fs.mkdir(folder, { recursive: true })
  await fs.mkdir(path.join(windowsUsers, 'Default', 'OneDrive'), { recursive: true })
  assert.deepEqual(await discoverCloudStorage({ home, platform: 'linux', env: {}, release: '6.6.0-generic', windowsUsers }), [])
  assert.deepEqual(await discoverCloudStorage({ home, platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, windowsUsers }), [{ provider: 'onedrive', name: 'OneDrive - Work', path: folder }])
})
