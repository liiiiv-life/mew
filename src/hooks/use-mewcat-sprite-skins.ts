import { useEffect, useSyncExternalStore } from 'react'
import { spriteStore, watchSpriteSkins } from '../utils/mewcat-sprite-storage'
import type { SpriteSkin } from '../utils/mewcat-sprites'
import type { MewcatSkinSelection } from '../utils/mewcatSkin'

export function useCustomSpriteSkins() {
  const store = spriteStore()
  const snapshot = useSyncExternalStore(listener => {
    store.listeners.add(listener)
    return () => { store.listeners.delete(listener) }
  }, () => store.snapshot)
  useEffect(() => watchSpriteSkins(store), [store])
  return snapshot
}

export function useMewcatSpriteSkin(id: MewcatSkinSelection): SpriteSkin | undefined {
  const catalog = useCustomSpriteSkins()
  return catalog.skins.find(skin => skin.id === (id ?? 'mew')) ?? catalog.skins.find(skin => skin.id === 'mew')
}
