import { remoteStorageName } from '@mew/ui/browser-storage-scope'
import { uiText } from '@mew/ui/i18n-core'
import { MEWCAT_SPRITE_ACTIONS, MAX_SPRITE_BYTES, validSpriteDimensions, type SavedSpriteSkin, type SpriteImage, type SpriteSkin, type SpriteStrip } from './mewcat-sprites'

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
    for (const action of MEWCAT_SPRITE_ACTIONS) prepared.push(await prepareSpriteStrip(saved.sprites[action]))
    return { id: saved.id, name: saved.name, sprites: Object.fromEntries(MEWCAT_SPRITE_ACTIONS.map((action, index) => [action, prepared[index]])) as SpriteSkin['sprites'] }
  } catch (error) {
    for (const sprite of prepared) URL.revokeObjectURL(sprite.src)
    throw error
  }
}

type Snapshot = { skins: SpriteSkin[]; loading: boolean; failed: boolean }
type Store = { snapshot: Snapshot; listeners: Set<() => void>; pending?: Promise<void> }
const stores = new Map<string, Store>()
export function spriteStore(): Store {
  const name = remoteStorageName('mewcat-sprite-skins')
  let store = stores.get(name)
  if (!store) { store = { snapshot: { skins: [], loading: true, failed: false }, listeners: new Set() }; stores.set(name, store) }
  return store
}
function emit(store: Store, snapshot: Snapshot) {
  store.snapshot = snapshot
  for (const listener of store.listeners) listener()
}

function openDatabase(): Promise<IDBDatabase> {
  const name = remoteStorageName('mewcat-sprite-skins')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('skins', { keyPath: 'id' }) }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(uiText('스킨 저장소를 열 수 없습니다.')))
  })
}

export function loadSpriteSkins(): Promise<void> {
  const store = spriteStore()
  if (store.pending) return store.pending
  if (!store.snapshot.loading && !store.snapshot.failed) return Promise.resolve()
  store.pending = (async () => {
    let db: IDBDatabase | undefined
    try {
      db = await openDatabase()
      const saved = await new Promise<SavedSpriteSkin[]>((resolve, reject) => {
        const tx = db!.transaction('skins', 'readonly')
        const request = tx.objectStore('skins').getAll()
        tx.oncomplete = () => resolve(request.result)
        tx.onerror = tx.onabort = () => reject(tx.error)
      })
      const skins: SpriteSkin[] = []
      let failed = false
      for (const item of saved) {
        try {
          if (!/^custom:[\w-]{1,80}$/.test(item.id) || !item.name?.trim()) throw new Error('invalid skin')
          skins.push(await prepareSkin(item))
        } catch { failed = true }
      }
      const previous = store.snapshot.skins
      emit(store, { skins, loading: false, failed })
      for (const skin of previous) releaseSpriteSkin(skin)
    } catch { emit(store, { skins: [], loading: false, failed: true }) }
    finally { db?.close(); store.pending = undefined }
  })()
  return store.pending
}

export async function saveSpriteSkin(saved: SavedSpriteSkin): Promise<SpriteSkin> {
  await loadSpriteSkins()
  const store = spriteStore()
  const skin = await prepareSkin(saved)
  let db: IDBDatabase | undefined
  try {
    db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction('skins', 'readwrite')
      tx.objectStore('skins').put(saved)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
    const old = store.snapshot.skins.find(item => item.id === saved.id)
    emit(store, { ...store.snapshot, skins: [...store.snapshot.skins.filter(item => item.id !== saved.id), skin] })
    if (old) releaseSpriteSkin(old)
    return skin
  } catch {
    releaseSpriteSkin(skin)
    throw new Error(uiText('스킨을 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.'))
  } finally { db?.close() }
}

export async function deleteSpriteSkin(id: string): Promise<void> {
  const store = spriteStore()
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('skins', 'readwrite')
      tx.objectStore('skins').delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
    const old = store.snapshot.skins.find(item => item.id === id)
    emit(store, { ...store.snapshot, skins: store.snapshot.skins.filter(item => item.id !== id) })
    if (old) releaseSpriteSkin(old)
  } catch { throw new Error(uiText('스킨을 삭제하지 못했습니다.')) }
  finally { db.close() }
}

let kitten: Promise<SpriteSkin> | undefined
export function loadKittenSkin(): Promise<SpriteSkin> {
  if (!kitten) kitten = (async () => {
    const sprites = {} as SavedSpriteSkin['sprites']
    for (const action of MEWCAT_SPRITE_ACTIONS) {
      const response = await fetch(`/mewcat/kitten/${action}.png`)
      if (!response.ok) throw new Error('sprite unavailable')
      sprites[action] = await readSpriteImage(await response.blob(), 8)
    }
    return prepareSkin({ id: 'kitten', name: uiText('아기 고양이'), sprites })
  })().catch(error => { kitten = undefined; throw error })
  return kitten
}
