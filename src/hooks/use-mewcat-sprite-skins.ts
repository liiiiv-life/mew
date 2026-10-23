import { useEffect, useSyncExternalStore } from 'react'
import { spriteStore, watchSpriteSkins } from '../utils/mewcat-sprite-storage'
import type { SpriteSkin } from '../utils/mewcat-sprites'
import type { MewcatSkinSelection } from '../utils/mewcatSkin'
import { MEWPET_DEFAULT_SKIN_ID } from '../../shared/mewpet-skins'

export function useCustomSpriteSkins(preferredId?: string) {
  const store = spriteStore()
  const snapshot = useSyncExternalStore(listener => {
    store.listeners.add(listener)
    return () => { store.listeners.delete(listener) }
  }, () => store.snapshot)
  useEffect(() => watchSpriteSkins(store, preferredId), [store, preferredId])
  return snapshot
}

export function useMewcatSpriteSkin(id: MewcatSkinSelection): SpriteSkin | undefined {
  const catalog = useCustomSpriteSkins(id ?? MEWPET_DEFAULT_SKIN_ID)
  return catalog.skins.find(skin => skin.id === (id ?? MEWPET_DEFAULT_SKIN_ID)) ?? (catalog.loading ? undefined : catalog.skins.find(skin => skin.id === MEWPET_DEFAULT_SKIN_ID))
}
