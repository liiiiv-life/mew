import { useEffect, useState, useSyncExternalStore } from 'react'
import { loadKittenSkin, loadSpriteSkins, spriteStore } from '../utils/mewcat-sprite-storage'
import type { SpriteSkin } from '../utils/mewcat-sprites'
import type { MewcatSkinSelection } from '../utils/mewcatSkin'

export function useCustomSpriteSkins() {
  const store = spriteStore()
  const snapshot = useSyncExternalStore(listener => {
    store.listeners.add(listener)
    return () => { store.listeners.delete(listener) }
  }, () => store.snapshot)
  useEffect(() => { void loadSpriteSkins() }, [store])
  return snapshot
}

export function useMewcatSpriteSkin(id: MewcatSkinSelection): SpriteSkin | undefined {
  const custom = useCustomSpriteSkins()
  const [kitten, setKitten] = useState<SpriteSkin>()
  useEffect(() => {
    if (id !== 'kitten') return
    let active = true
    void loadKittenSkin().then(skin => { if (active) setKitten(skin) }).catch(() => {})
    return () => { active = false }
  }, [id])
  return id === 'kitten' ? kitten : custom.skins.find(skin => skin.id === id)
}
