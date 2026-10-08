import { remoteStorageName } from '@mew/ui/browser-storage-scope'
import { uiText } from '@mew/ui/i18n-core'
import { MAX_SPRITE_BYTES, validSpriteDimensions, type SavedSpriteSkin, type SpriteImage, type SpriteSkin, type SpriteStrip } from './mewcat-sprites'
import { MEWPET_ACTIONS, MEWPET_ANIMATIONS, MEWPET_MAX_PACK_BYTES, validMewpetSkinId, type MewpetFileSkin, type MewpetSkinCatalog, type MewpetSprites } from '../../shared/mewpet-skins.ts'
import { activeRemoteTransport, isRemoteMode, mewFetch } from './remote-transport'

export async function readSpriteImage(blob: Blob, frames = 8): Promise<SpriteImage> {
  if (!['image/png', 'image/webp'].includes(blob.type) || blob.size > MAX_SPRITE_BYTES) throw new Error(uiText('PNG·WebP 이미지를 선택하세요. 파일당 최대 4MB입니다.'))
  const image = await createImageBitmap(blob).catch(() => { throw new Error(uiText('이미지를 읽을 수 없습니다.')) })
  try {
    if (!validSpriteDimensions(image.width, image.height, 1)) throw new Error(uiText('이미지가 너무 큽니다. 최대 16메가픽셀입니다.'))
    return { blob, width: image.width, height: image.height, frames }
  } finally { image.close() }
}

export async function prepareSpriteStrip(source: SpriteImage): Promise<SpriteStrip> {
  if (!(source.blob instanceof Blob) || !['image/png', 'image/webp'].includes(source.blob.type) || source.blob.size > MAX_SPRITE_BYTES) throw new Error(uiText('PNG·WebP 이미지를 선택하세요. 파일당 최대 4MB입니다.'))
  if (!validSpriteDimensions(source.width, source.height, source.frames)) throw new Error(uiText('프레임 수는 1~256이며 이미지 너비를 균등하게 나눌 수 있어야 합니다.'))
  const image = await createImageBitmap(source.blob)
  try {
    if (image.width !== source.width || image.height !== source.height) throw new Error(uiText('이미지를 읽을 수 없습니다.'))
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 48
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const frameWidth = source.width / source.frames
    let lastPaintedRow = -1
    const hitPaths = Array.from({ length: source.frames }, (_, frame) => {
      context.clearRect(0, 0, 48, 48)
      context.drawImage(image, frame * frameWidth, 0, frameWidth, source.height, 0, 0, 48, 48)
      const pixels = context.getImageData(0, 0, 48, 48).data
      let path = ''
      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 48;) {
          if (pixels[(y * 48 + x) * 4 + 3] < 16) { x++; continue }
          const start = x
          while (x < 48 && pixels[(y * 48 + x) * 4 + 3] >= 16) x++
          path += `M${start} ${y}h${x - start}v1h${start - x}z`
          lastPaintedRow = Math.max(lastPaintedRow, y)
        }
      }
      return path
    })
    if (lastPaintedRow < 0) throw new Error(uiText('이미지에 보이는 그림이 없습니다.'))
    return { ...source, src: URL.createObjectURL(source.blob), hitPaths, bottomPadding: (47 - lastPaintedRow) / 48 * source.height }
  } finally { image.close() }
}

export function releaseSpriteSkin(skin: SpriteSkin): void {
  for (const sprite of Object.values(skin.sprites)) URL.revokeObjectURL(sprite.src)
}

async function prepareSkin(saved: SavedSpriteSkin): Promise<SpriteSkin> {
  const prepared: SpriteStrip[] = []
  try {
    const sources = { ...saved.sprites } as MewpetSprites<SpriteImage>
    for (const action of ['jump', 'fall'] as const) {
      if (!sources[action]) sources[action] = await legacyAirborneImage(sources.struggle, action)
    }
    const entries = []
    for (const action of MEWPET_ANIMATIONS) {
      const source = sources[action]
      if (!source) continue
      const strip = await prepareSpriteStrip(source)
      prepared.push(strip)
      entries.push([action, strip])
    }
    if (MEWPET_ACTIONS.some(action => !sources[action])) throw new Error('missing required sprite')
    return { id: saved.id, name: saved.name, sprites: Object.fromEntries(entries) as SpriteSkin['sprites'] }
  } catch (error) {
    for (const sprite of prepared) URL.revokeObjectURL(sprite.src)
    throw error
  }
}

async function legacyAirborneImage(source: SpriteImage, action: 'jump' | 'fall'): Promise<SpriteImage> {
  if (!source || !(source.blob instanceof Blob) || source.blob.size > MAX_SPRITE_BYTES
    || !['image/png', 'image/webp'].includes(source.blob.type)
    || !validSpriteDimensions(source.width, source.height, source.frames)) throw new Error(uiText('이미지를 읽을 수 없습니다.'))
  const image = await createImageBitmap(source.blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d')!
    const frameWidth = source.width / source.frames
    const scale = 96 / Math.max(frameWidth, source.height)
    context.translate(64, 64)
    context.rotate((action === 'jump' ? -15 : 15) * Math.PI / 180)
    context.drawImage(image, 0, 0, frameWidth, source.height, -frameWidth * scale / 2, -source.height * scale / 2, frameWidth * scale, source.height * scale)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(uiText('이미지를 읽을 수 없습니다.'))), 'image/png'))
    return { blob, width: 128, height: 128, frames: 1 }
  } finally { image.close() }
}

export type RegisteredSpriteSkin = SpriteSkin & Pick<MewpetFileSkin, 'revision' | 'managed' | 'translated'> & { sprites: MewpetSprites<SpriteStrip>; sampleUrls: Partial<Record<typeof MEWPET_ANIMATIONS[number], string>>; legacy?: boolean }
type Snapshot = { skins: RegisteredSpriteSkin[]; loading: boolean; failed: boolean; canManage: boolean; migrationFailed: boolean }
type Store = { name: string; snapshot: Snapshot; listeners: Set<() => void>; pending?: Promise<void>; watchers: number; generation: number; stop?: () => void }
const stores = new Map<string, Store>()
export function spriteStore(): Store {
  const name = remoteStorageName('mewcat-sprite-skins')
  let store = stores.get(name)
  if (!store) { store = { name, snapshot: { skins: [], loading: true, failed: false, canManage: false, migrationFailed: false }, listeners: new Set(), watchers: 0, generation: 0 }; stores.set(name, store) }
  return store
}
function emit(store: Store, snapshot: Snapshot) {
  store.snapshot = snapshot
  for (const listener of store.listeners) listener()
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('skins', { keyPath: 'id' }) }
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(uiText('스킨 저장소를 열 수 없습니다.')))
  })
}

function captureFetch(): typeof mewFetch {
  const transport = activeRemoteTransport()
  if (transport) return (input, init) => transport.fetch(input, init)
  if (isRemoteMode()) return mewFetch
  return (input, init) => globalThis.fetch(input, init)
}

async function requireResponse(response: Response): Promise<Response> {
  if (response.ok) return response
  const code = await response.json().then(body => body.error).catch(() => '') as string
  if (code === 'SKIN_PACK_LIMIT') throw new Error(uiText('스킨 이미지의 합계는 최대 24MB입니다.'))
  if (code === 'SKIN_FILE_LIMIT') throw new Error(uiText('PNG·WebP 이미지를 선택하세요. 파일당 최대 4MB입니다.'))
  if (code === 'SKIN_IMAGE_INVALID') throw new Error(uiText('이미지를 읽을 수 없습니다.'))
  if (code === 'SKIN_MANIFEST_INVALID') throw new Error(uiText('스킨 이름과 일곱 동작의 이미지를 입력하세요.'))
  throw new Error(uiText('스킨을 저장하지 못했습니다. 서버 연결과 권한을 확인하세요.'))
}

async function uploadSkin(saved: SavedSpriteSkin, request: typeof mewFetch): Promise<MewpetFileSkin> {
  const body = new FormData(), frames: Record<string, number> = {}
  let total = 0
  for (const action of MEWPET_ANIMATIONS) {
    const image = (saved.sprites as MewpetSprites<SpriteImage>)[action]
    if (!image) continue
    total += image.blob.size
    frames[action] = image.frames
    body.append(action, image.blob, `${action}.${image.blob.type === 'image/webp' ? 'webp' : 'png'}`)
  }
  if (total > MEWPET_MAX_PACK_BYTES) throw new Error(uiText('스킨 이미지의 합계는 최대 24MB입니다.'))
  body.append('manifest', JSON.stringify({ name: saved.name, frames }))
  const response = await requireResponse(await request(`/api/mewpet/skins/${encodeURIComponent(saved.id)}`, { method: 'PUT', body }))
  return response.json() as Promise<MewpetFileSkin>
}

function registeredSkin(skin: SpriteSkin, descriptor: MewpetFileSkin): RegisteredSpriteSkin {
  return { ...skin, sprites: skin.sprites as MewpetSprites<SpriteStrip>, revision: descriptor.revision, managed: descriptor.managed, translated: descriptor.translated, sampleUrls: Object.fromEntries(Object.entries(descriptor.sprites).map(([action, image]) => [action, image.url])) }
}

async function downloadSkin(descriptor: MewpetFileSkin, request: typeof mewFetch): Promise<RegisteredSpriteSkin> {
  if (!validMewpetSkinId(descriptor.id) || !descriptor.name?.trim()) throw new Error('invalid skin')
  const sprites = {} as MewpetSprites<SpriteImage>
  for (const action of MEWPET_ANIMATIONS) {
    const source = descriptor.sprites[action]
    if (!source) continue
    if (!source.url.startsWith(`/api/mewpet/skins/${encodeURIComponent(descriptor.id)}/${action}?`)) throw new Error('invalid sprite URL')
    const response = await request(source.url, { cache: 'no-store' })
    if (!response.ok) throw new Error('sprite unavailable')
    const image = await readSpriteImage(await response.blob(), source.frames)
    if (image.width !== source.width || image.height !== source.height) throw new Error('invalid sprite dimensions')
    sprites[action] = image
  }
  return registeredSkin(await prepareSkin({ id: descriptor.id, name: descriptor.name, sprites }), descriptor)
}

type LegacySkin = SavedSpriteSkin & { mewpetImported?: boolean }
async function migrateLegacySkins(store: Store, catalog: MewpetSkinCatalog, request: typeof mewFetch): Promise<{ skins: RegisteredSpriteSkin[]; failed: boolean }> {
  let db: IDBDatabase | undefined
  const skins: RegisteredSpriteSkin[] = []
  let failed = false
  try {
    if (typeof indexedDB.databases === 'function' && !(await indexedDB.databases()).some(item => item.name === store.name)) return { skins, failed }
    db = await openDatabase(store.name)
    const saved = await new Promise<LegacySkin[]>((resolve, reject) => {
      const tx = db!.transaction('skins', 'readonly'), read = tx.objectStore('skins').getAll()
      tx.oncomplete = () => resolve(read.result)
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
    for (const item of saved) {
      if (item.mewpetImported) continue
      let skin: SpriteSkin | undefined
      try {
        if (!validMewpetSkinId(item.id) || !item.id.startsWith('custom:')) throw new Error('invalid legacy skin')
        if (!catalog.skins.some(candidate => candidate.id === item.id)) {
          skin = await prepareSkin(item)
          if (!catalog.canManage) { skins.push({ ...skin, revision: 'legacy', managed: false, sampleUrls: {}, legacy: true }); failed = true; continue }
          const descriptor = await uploadSkin({ id: item.id, name: item.name, sprites: skin.sprites }, request)
          skins.push(registeredSkin(skin, descriptor)); catalog.skins.push(descriptor)
        }
        await new Promise<void>((resolve, reject) => {
          const tx = db!.transaction('skins', 'readwrite')
          tx.objectStore('skins').put({ ...item, mewpetImported: true })
          tx.oncomplete = () => resolve()
          tx.onerror = tx.onabort = () => reject(tx.error)
        })
      } catch {
        failed = true
        if (skin && !skins.some(candidate => candidate.id === item.id)) skins.push({ ...skin, revision: 'legacy', managed: false, sampleUrls: {}, legacy: true })
      }
    }
  } catch { failed = true }
  finally { db?.close() }
  return { skins, failed }
}

function releaseReplaced(previous: RegisteredSpriteSkin[], next: RegisteredSpriteSkin[]) {
  const replaced = previous.filter(skin => !next.includes(skin))
  if (replaced.length) setTimeout(() => { for (const skin of replaced) releaseSpriteSkin(skin) }, 1000)
}

export function loadSpriteSkins(force = false, store = spriteStore()): Promise<void> {
  if (store.pending) return store.pending
  if (!force && !store.snapshot.loading && !store.snapshot.failed) return Promise.resolve()
  const request = captureFetch()
  const generation = store.generation
  store.pending = (async () => {
    const previous = store.snapshot.skins
    try {
      const response = await request('/api/mewpet/skins', { cache: 'no-store' })
      if (!response.ok) throw new Error('catalog unavailable')
      const catalog = await response.json() as MewpetSkinCatalog
      if (!Array.isArray(catalog.skins)) throw new Error('invalid catalog')
      const legacy = await migrateLegacySkins(store, catalog, request)
      const skins: RegisteredSpriteSkin[] = []
      let failed = catalog.failed
      for (const descriptor of catalog.skins) {
        const old = previous.find(skin => skin.id === descriptor.id && skin.revision === descriptor.revision && !skin.legacy)
        const imported = legacy.skins.find(skin => skin.id === descriptor.id)
        try { skins.push(old && old.managed === descriptor.managed && old.translated === descriptor.translated ? old : imported ?? await downloadSkin(descriptor, request)) }
        catch { failed = true; const fallback = previous.find(skin => skin.id === descriptor.id); if (fallback) skins.push(fallback) }
      }
      for (const skin of legacy.skins) if (!skins.some(item => item.id === skin.id)) skins.push(skin)
      if (generation !== store.generation) { releaseReplaced(skins.filter(skin => !previous.some(old => old.sprites === skin.sprites)), []); return }
      emit(store, { skins, loading: false, failed, canManage: catalog.canManage, migrationFailed: legacy.failed })
      releaseReplaced(previous.filter(old => !skins.some(skin => skin.sprites === old.sprites)), skins)
    } catch { if (generation === store.generation) emit(store, { ...store.snapshot, loading: false, failed: true }) }
    finally { store.pending = undefined }
  })()
  return store.pending
}

export function watchSpriteSkins(store: Store): () => void {
  if (store.watchers++ === 0) {
    const refresh = () => { if (document.visibilityState === 'visible') void loadSpriteSkins(true, store) }
    const timer = setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    store.stop = () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }
  void loadSpriteSkins(true, store)
  return () => { if (--store.watchers === 0) { store.stop?.(); store.stop = undefined } }
}

export async function saveSpriteSkin(saved: SavedSpriteSkin): Promise<RegisteredSpriteSkin> {
  const store = spriteStore(), request = captureFetch()
  await store.pending
  store.generation++
  const skin = await prepareSkin(saved)
  try {
    const descriptor = await uploadSkin(saved, request), registered = registeredSkin(skin, descriptor)
    store.generation++
    const previous = store.snapshot.skins
    const next = [...previous.filter(item => item.id !== saved.id), registered]
    emit(store, { ...store.snapshot, skins: next, failed: false })
    releaseReplaced(previous, next)
    return registered
  } catch (error) { releaseSpriteSkin(skin); throw error }
}

export async function deleteSpriteSkin(id: string): Promise<void> {
  const store = spriteStore(), request = captureFetch()
  store.generation++
  const response = await request(`/api/mewpet/skins/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(uiText('스킨을 삭제하지 못했습니다.'))
  store.generation++
  await store.pending
  await loadSpriteSkins(true, store)
}
