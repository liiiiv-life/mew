import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'
import { MEWPET_ACTIONS, type MewpetSkinCatalog } from '../shared/mewpet-skins.ts'
import { MewpetSkinStore, MEWPET_SKINS_DIR, readMewpetImage } from './mewpet-skins.ts'
import { createMewpetSkinsRouter } from './mewpet-skin-routes.ts'
import { DATA_DIR } from './dataDir.ts'

const bundled = path.resolve(import.meta.dirname, '../public/mewcat')
const png = fs.readFileSync(path.join(bundled, 'kitten/idle.png'))
const sources = Object.fromEntries(MEWPET_ACTIONS.map(action => [action, { bytes: png, frames: 8 }]))
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mewpet-files-'))
  return { root, store: new MewpetSkinStore(path.join(root, 'skins'), bundled), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}
function manualPack(directory: string, id = 'file-pet') {
  fs.mkdirSync(directory, { recursive: true })
  const manifest = { id, name: 'File pet', sprites: Object.fromEntries(MEWPET_ACTIONS.map(action => [action, { file: `${action}.png`, frames: 8 }])) }
  for (const action of MEWPET_ACTIONS) fs.writeFileSync(path.join(directory, `${action}.png`), png)
  fs.writeFileSync(path.join(directory, 'skin.json'), JSON.stringify(manifest))
  return manifest
}

test('global registry reads bundled Mewpet manifests and hot-added files without a build', () => {
  const { store, cleanup } = fixture()
  try {
    assert.equal(MEWPET_SKINS_DIR, path.join(DATA_DIR, 'mewpet', 'skins'))
    const initial = store.list()
    assert.equal(initial.failed, false)
    assert.deepEqual(initial.skins.map(skin => skin.id), ['mew', 'kitten', 'russian-blue', 'korean-shorthair', 'capybara'])
    assert.equal(initial.skins[0].name, '뮤펫')
    const directory = path.join(store.directory, 'file-pet'), manifest = manualPack(directory)
    const first = store.list().skins.find(skin => skin.id === 'file-pet')!
    assert.equal(first.managed, true)
    assert.equal(first.sprites.walk.frames, 8)
    manifest.name = 'Renamed pet'; manifest.sprites.walk.frames = 1
    fs.writeFileSync(path.join(directory, 'skin.json'), JSON.stringify(manifest))
    const renamed = store.list().skins.find(skin => skin.id === 'file-pet')!
    assert.equal(renamed.name, 'Renamed pet')
    assert.equal(renamed.sprites.walk.frames, 1)
    assert.notEqual(renamed.revision, first.revision)
    fs.copyFileSync(path.join(bundled, 'capybara/idle.png'), path.join(directory, 'idle.png'))
    const replaced = store.list().skins.find(skin => skin.id === 'file-pet')!
    assert.notEqual(replaced.revision, renamed.revision)
    fs.writeFileSync(path.join(directory, 'skin.json'), '{invalid')
    assert.equal(store.list().failed, true)
    assert.deepEqual(store.list().skins.find(skin => skin.id === 'file-pet'), replaced, 'a broken manual update keeps the last valid in-memory version')
    store.save('file-pet', 'Repaired pet', sources)
    assert.equal(store.list().failed, false)
    fs.rmSync(directory, { recursive: true })
    assert.equal(store.list().skins.some(skin => skin.id === 'file-pet'), false)
  } finally { cleanup() }
})

test('uploads are atomic global overrides; invalid updates preserve the last valid files', () => {
  const { store, cleanup } = fixture()
  try {
    const defaultRevision = store.list().skins[0].revision
    const added = store.save('mew', 'My Mewpet', sources)
    assert.equal(added.managed, true)
    assert.equal(new MewpetSkinStore(store.directory, bundled).list().skins[0].name, 'My Mewpet')
    const directory = fs.readdirSync(store.directory).map(name => path.join(store.directory, name))[0]
    const before = fs.readFileSync(path.join(directory, 'skin.json'))
    assert.throws(() => store.save('mew', 'Broken', { ...sources, jump: { bytes: png.subarray(0, 40), frames: 8 } }))
    assert.throws(() => store.save('mew', 'Broken', { ...sources, fall: { bytes: png, frames: 11 } }))
    assert.throws(() => store.save('mew', 'Broken', {}))
    assert.deepEqual(fs.readFileSync(path.join(directory, 'skin.json')), before)
    assert.equal(store.list().skins[0].revision, added.revision)
    store.save('mew', 'Second', { ...sources, takeoff: { bytes: png, frames: 8 } })
    store.save('mew', 'Third', sources)
    assert.equal(fs.readdirSync(directory).filter(name => name.startsWith('version-')).length, 3)
    assert.equal(store.list().skins[0].sprites.takeoff, undefined, 'removed optional animations stay absent')
    store.delete('mew')
    assert.equal(store.list().skins[0].name, '뮤펫')
    assert.equal(store.list().skins[0].revision, defaultRevision)
    assert.throws(() => store.delete('mew'), /SKIN_NOT_FOUND/)
  } finally { cleanup() }
})

test('unsafe manifests, symlinks and duplicate IDs cannot replace another pack', () => {
  const { root, store, cleanup } = fixture()
  try {
    const good = path.join(store.directory, 'good'), manifest = manualPack(good)
    manualPack(path.join(store.directory, 'duplicate'))
    assert.equal(store.list().failed, true)
    const outside = path.join(root, 'outside'); manualPack(outside, 'outside')
    fs.symlinkSync(outside, path.join(store.directory, 'linked'))
    const unsafe = path.join(store.directory, 'unsafe'); manualPack(unsafe, 'unsafe')
    fs.rmSync(path.join(unsafe, 'idle.png')); fs.symlinkSync(path.join(outside, 'idle.png'), path.join(unsafe, 'idle.png'))
    manifest.id = 'traversal'; manifest.sprites.walk.file = '../../outside/idle.png'
    fs.writeFileSync(path.join(good, 'skin.json'), JSON.stringify(manifest))
    const catalog = store.list()
    assert.equal(catalog.failed, true)
    for (const id of ['outside', 'unsafe', 'traversal']) assert.equal(catalog.skins.some(skin => skin.id === id), false)
    assert.throws(() => store.save('../bad', 'Unsafe', sources))
    assert.throws(() => store.image('outside', 'idle'), /SKIN_NOT_FOUND/)
  } finally { cleanup() }
})

test('failed manifest replacement leaves the previous complete skin available', t => {
  const { root, store, cleanup } = fixture()
  try {
    const first = store.save('safe-pet', 'Saved pet', sources)
    const rename = fs.renameSync
    t.mock.method(fs, 'renameSync', (from: fs.PathLike, to: fs.PathLike) => {
      if (to.toString().startsWith(root)) throw new Error('fixture disk failure')
      return rename(from, to)
    })
    assert.throws(() => store.save('safe-pet', 'Unsaved pet', sources), /fixture disk failure/)
    assert.deepEqual(store.list().skins.find(skin => skin.id === 'safe-pet'), first)
    assert.deepEqual(store.image('safe-pet', 'idle').bytes, png)
    const directory = fs.readdirSync(store.directory).map(name => path.join(store.directory, name))[0]
    assert.equal(fs.readdirSync(directory).filter(name => name.startsWith('version-')).length, 1)
    assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.tmp')).length, 0)
  } finally { cleanup() }
})

test('the API shares packs across projects and devices and restricts writes to owners', async () => {
  const { store, cleanup } = fixture()
  let role: 'guest' | 'member' | 'manager' | 'owner' = 'owner'
  const app = express()
  app.use((req, _res, next) => { req.auth = { role, email: role === 'guest' ? null : 'pet@example.test', mustChangePassword: false }; next() })
  app.use('/api/mewpet/skins', createMewpetSkinsRouter(store))
  const server = http.createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/mewpet/skins`
  const upload = async (id: string, corrupt = false) => {
    const body = new FormData()
    body.append('manifest', JSON.stringify({ name: 'Global pet', frames: Object.fromEntries(MEWPET_ACTIONS.map(action => [action, 8])) }))
    for (const action of MEWPET_ACTIONS) body.append(action, new Blob([corrupt && action === 'jump' ? Buffer.from('bad') : png], { type: 'image/png' }), `${action}.png`)
    return fetch(`${url}/${encodeURIComponent(id)}`, { method: 'PUT', body })
  }
  try {
    for (const denied of ['guest', 'member', 'manager'] as const) {
      role = denied
      const catalog = await fetch(url).then(response => response.json()) as MewpetSkinCatalog
      assert.equal(catalog.canManage, false)
      assert.equal(catalog.skins[0].name, '뮤펫')
      assert.equal((await upload('custom:global')).status, 403)
      assert.equal((await fetch(`${url}/mew`, { method: 'DELETE' })).status, 403)
    }
    role = 'owner'
    const response = await upload('custom:global')
    assert.equal(response.status, 200, await response.text())
    assert.equal((await upload('custom:global', true)).status, 400)
    const first = await fetch(`${url}?projectRoot=one`).then(response => response.json()) as MewpetSkinCatalog
    const second = await fetch(`${url}?projectRoot=two`).then(response => response.json()) as MewpetSkinCatalog
    assert.deepEqual(first, second)
    const sprite = first.skins.find(skin => skin.id === 'custom:global')!.sprites.jump
    role = 'guest'
    const image = await fetch(new URL(sprite.url, url))
    assert.equal(image.headers.get('Content-Type'), 'image/png')
    assert.equal(image.headers.get('Cache-Control'), 'private, no-store')
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png)
    assert.equal((await fetch(`${url}/mew/no-such-action`)).status, 404)
    role = 'owner'
    assert.equal((await fetch(`${url}/custom%3Aglobal`, { method: 'DELETE' })).status, 204)
    assert.equal((await fetch(new URL(sprite.url, url))).status, 404)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    cleanup()
  }
})

test('image validation rejects HTML, partial PNGs, unreasonable dimensions and frames', () => {
  assert.equal(readMewpetImage(png, 8).width, 1024)
  for (const bytes of [Buffer.from('<svg/>'), png.subarray(0, 32), png.subarray(0, png.length - 2)]) assert.throws(() => readMewpetImage(bytes, 8))
  for (const frames of [0, 257, 2.5, 11]) assert.throws(() => readMewpetImage(png, frames))
  const huge = Buffer.from(png); huge.writeUInt32BE(65536, 16)
  assert.throws(() => readMewpetImage(huge, 8))
})
