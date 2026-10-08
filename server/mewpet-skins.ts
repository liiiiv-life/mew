import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DATA_DIR } from './dataDir.ts'
import { MEWPET_ACTIONS, MEWPET_ANIMATIONS, MEWPET_MAX_FILE_BYTES, MEWPET_MAX_PACK_BYTES, validMewpetSkinId, validMewpetSprite, type MewpetAnimation, type MewpetFileSkin, type MewpetSprites } from '../shared/mewpet-skins.ts'

export const MEWPET_SKINS_DIR = path.join(DATA_DIR, 'mewpet', 'skins')
const bundledDirectory = path.resolve(import.meta.dirname, '../public/mewcat')
type ImageFile = { bytes: Buffer; mime: 'image/png' | 'image/webp'; width: number; height: number; frames: number }
type Pack = { descriptor: MewpetFileSkin; directory: string; files: MewpetSprites<ImageFile>; order: number }
type Manifest = { id: string; name: string; translated?: boolean; order?: number; sprites: MewpetSprites<{ file: string; frames: number }> }
export class MewpetSkinError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

export function readMewpetImage(bytes: Buffer, frames: number): ImageFile {
  if (bytes.length > MEWPET_MAX_FILE_BYTES) throw new MewpetSkinError('SKIN_FILE_LIMIT')
  let width = 0, height = 0, mime: ImageFile['mime'] = 'image/png'
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(8) === 13) {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
    let data = false, complete = false
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(offset), chunk = bytes.toString('ascii', offset + 4, offset + 8)
      if (offset + size + 12 > bytes.length) throw new MewpetSkinError('SKIN_IMAGE_INVALID')
      if (chunk === 'IDAT' && size > 0) data = true
      offset += size + 12
      if (chunk === 'IEND') { complete = size === 0 && offset === bytes.length; break }
    }
    if (!data || !complete) throw new MewpetSkinError('SKIN_IMAGE_INVALID')
  } else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) {
    mime = 'image/webp'
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(offset + 4), data = offset + 8
      if (data + size > bytes.length) throw new MewpetSkinError('SKIN_IMAGE_INVALID')
      const chunk = bytes.toString('ascii', offset, offset + 4)
      if (chunk === 'VP8X' && size === 10) { width = bytes.readUIntLE(data + 4, 3) + 1; height = bytes.readUIntLE(data + 7, 3) + 1; break }
      if (chunk === 'VP8 ' && size >= 10 && bytes.subarray(data + 3, data + 6).equals(Buffer.from([157, 1, 42]))) { width = bytes.readUInt16LE(data + 6) & 16383; height = bytes.readUInt16LE(data + 8) & 16383; break }
      if (chunk === 'VP8L' && size >= 5 && bytes[data] === 47) { const bits = bytes.readUInt32LE(data + 1); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; break }
      offset = data + size + (size % 2)
    }
  }
  if (!validMewpetSprite(width, height, frames)) throw new MewpetSkinError('SKIN_IMAGE_INVALID')
  return { bytes, mime, width, height, frames }
}

function regularFile(directory: string, relative: string, limit: number): Buffer {
  const segments = relative.split('/')
  if (segments.length > 3 || segments.some(segment => !/^[\w-][\w.-]*$/.test(segment) || segment === '..')) throw new MewpetSkinError('SKIN_PATH_INVALID')
  let current = directory
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink() || (index < segments.length - 1 ? !stat.isDirectory() : !stat.isFile())) throw new MewpetSkinError('SKIN_PATH_INVALID')
    if (index === segments.length - 1 && stat.size > limit) throw new MewpetSkinError('SKIN_FILE_LIMIT')
  }
  return fs.readFileSync(current)
}

export class MewpetSkinStore {
  directory: string
  bundled: string
  private cache = new Map<string, { fingerprint: string; pack: Pack }>()
  constructor(directory = MEWPET_SKINS_DIR, bundled = bundledDirectory) { this.directory = directory; this.bundled = bundled }

  private readPack(directory: string, managed: boolean): Pack {
    const json = regularFile(directory, 'skin.json', 64 * 1024)
    const manifest = JSON.parse(json.toString('utf8')) as Manifest
    if (!validMewpetSkinId(manifest.id) || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 40 || !manifest.sprites || MEWPET_ACTIONS.some(action => !manifest.sprites[action])) throw new MewpetSkinError('SKIN_MANIFEST_INVALID')
    const stats = MEWPET_ANIMATIONS.flatMap(action => {
      const source = manifest.sprites[action]
      if (!source) return []
      if (typeof source.file !== 'string' || !Number.isInteger(source.frames)) throw new MewpetSkinError('SKIN_MANIFEST_INVALID')
      if (source.file.split('/').some(segment => !/^[\w-][\w.-]*$/.test(segment) || segment === '..')) throw new MewpetSkinError('SKIN_PATH_INVALID')
      const file = path.resolve(directory, source.file)
      if (!fs.existsSync(file) && !MEWPET_ACTIONS.some(required => required === action)) return [source.file, 'missing']
      const stat = fs.lstatSync(file)
      return [source.file, stat.size, stat.mtimeMs, stat.ctimeMs]
    })
    const fingerprint = createHash('sha256').update(json).update(JSON.stringify(stats)).digest('hex')
    const cached = this.cache.get(directory)
    if (cached?.fingerprint === fingerprint) return cached.pack
    const hash = createHash('sha256').update(json), files = {} as Pack['files']
    let total = 0
    for (const action of MEWPET_ANIMATIONS) {
      const source = manifest.sprites[action]
      if (!source) continue
      if (!fs.existsSync(path.join(directory, source.file)) && !MEWPET_ACTIONS.some(required => required === action)) continue
      const image = readMewpetImage(regularFile(directory, source.file, MEWPET_MAX_FILE_BYTES), source.frames)
      files[action] = image
      hash.update(action).update(image.bytes)
      total += image.bytes.length
    }
    if (total > MEWPET_MAX_PACK_BYTES) throw new MewpetSkinError('SKIN_PACK_LIMIT')
    const revision = hash.digest('hex').slice(0, 20)
    const sprites = Object.fromEntries(Object.entries(files).map(([action, image]) => [action, { url: `/api/mewpet/skins/${encodeURIComponent(manifest.id)}/${action}?v=${revision}`, width: image.width, height: image.height, frames: image.frames }])) as MewpetFileSkin['sprites']
    const pack = { directory, files, order: Number.isFinite(manifest.order) ? manifest.order! : 100, descriptor: { id: manifest.id, name: manifest.name.trim(), revision, managed, translated: !managed && manifest.translated === true, sprites } }
    this.cache.set(directory, { fingerprint, pack })
    return pack
  }

  private scan(root: string, managed: boolean): { packs: Pack[]; failed: boolean } {
    if (!fs.existsSync(root)) return { packs: [], failed: false }
    if (fs.lstatSync(root).isSymbolicLink()) throw new MewpetSkinError('SKIN_PATH_INVALID', 500)
    const packs: Pack[] = [], ids = new Set<string>()
    let failed = false
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink()) { failed = true; continue }
      if (!entry.isDirectory() || !fs.existsSync(path.join(root, entry.name, 'skin.json'))) continue
      try {
        const pack = this.readPack(path.join(root, entry.name), managed)
        if (ids.has(pack.descriptor.id)) { failed = true; continue }
        ids.add(pack.descriptor.id); packs.push(pack)
      } catch {
        failed = true
        const previous = this.cache.get(path.join(root, entry.name))?.pack
        if (previous && !ids.has(previous.descriptor.id)) { ids.add(previous.descriptor.id); packs.push(previous) }
      }
    }
    return { packs, failed }
  }

  private inventory(): { packs: Pack[]; failed: boolean } {
    const bundled = this.scan(this.bundled, false), global = this.scan(this.directory, true)
    const directories = new Set([...bundled.packs, ...global.packs].map(pack => pack.directory))
    for (const directory of this.cache.keys()) if (!directories.has(directory)) this.cache.delete(directory)
    const packs = new Map(bundled.packs.map(pack => [pack.descriptor.id, pack]))
    for (const pack of global.packs) packs.set(pack.descriptor.id, pack)
    return { packs: [...packs.values()].sort((a, b) => Number(b.descriptor.id === 'mew') - Number(a.descriptor.id === 'mew') || a.order - b.order || a.descriptor.name.localeCompare(b.descriptor.name)), failed: bundled.failed || global.failed }
  }

  list(): { skins: MewpetFileSkin[]; failed: boolean } {
    const inventory = this.inventory()
    return { skins: inventory.packs.map(pack => pack.descriptor), failed: inventory.failed }
  }

  image(id: string, action: MewpetAnimation): ImageFile {
    const image = this.inventory().packs.find(pack => pack.descriptor.id === id)?.files[action]
    if (!image) throw new MewpetSkinError('SKIN_NOT_FOUND', 404)
    return image
  }

  save(id: string, name: string, sources: Partial<Record<MewpetAnimation, { bytes: Buffer; frames: number }>>): MewpetFileSkin {
    if (!validMewpetSkinId(id) || typeof name !== 'string' || !name.trim() || name.length > 40 || MEWPET_ACTIONS.some(action => !sources[action])) throw new MewpetSkinError('SKIN_MANIFEST_INVALID')
    const images = MEWPET_ANIMATIONS.flatMap(action => {
      const source = sources[action]
      return source ? [[action, readMewpetImage(source.bytes, source.frames)] as const] : []
    })
    if (images.reduce((total, [, image]) => total + image.bytes.length, 0) > MEWPET_MAX_PACK_BYTES) throw new MewpetSkinError('SKIN_PACK_LIMIT')
    const existing = this.scan(this.directory, true).packs.find(pack => pack.descriptor.id === id)
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const directory = existing?.directory ?? path.join(this.directory, `skin-${Buffer.from(id).toString('hex')}`)
    if (fs.existsSync(directory) && (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())) throw new MewpetSkinError('SKIN_PATH_INVALID')
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const version = `version-${randomUUID()}`, versionDirectory = path.join(directory, version)
    const temporary = path.join(directory, `.skin-${randomUUID()}.tmp`)
    fs.mkdirSync(versionDirectory, { mode: 0o700 })
    let committed = false
    try {
      const sprites = Object.fromEntries(images.map(([action, image]) => {
        const file = `${version}/${action}.${image.mime === 'image/png' ? 'png' : 'webp'}`
        fs.writeFileSync(path.join(directory, file), image.bytes, { mode: 0o600, flag: 'wx' })
        return [action, { file, frames: image.frames }]
      })) as Manifest['sprites']
      fs.writeFileSync(temporary, JSON.stringify({ id, name: name.trim(), order: existing?.order, sprites }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, path.join(directory, 'skin.json'))
      committed = true
      this.cache.delete(directory)
      const result = this.readPack(directory, true).descriptor
      return result
    } catch (error) {
      fs.rmSync(temporary, { force: true })
      if (!committed) fs.rmSync(versionDirectory, { recursive: true, force: true })
      throw error
    }
  }

  delete(id: string): void {
    if (!validMewpetSkinId(id)) throw new MewpetSkinError('SKIN_NOT_FOUND', 404)
    const pack = this.scan(this.directory, true).packs.find(pack => pack.descriptor.id === id)
    if (!pack) throw new MewpetSkinError('SKIN_NOT_FOUND', 404)
    fs.rmSync(pack.directory, { recursive: true })
    this.cache.delete(pack.directory)
  }
}
