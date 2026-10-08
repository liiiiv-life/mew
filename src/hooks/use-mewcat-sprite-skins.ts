import { useEffect, useState, useSyncExternalStore } from 'react'
import { loadBuiltinSpriteSkin, loadSpriteSkins, spriteStore } from '../utils/mewcat-sprite-storage'
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
  const builtinId = id === 'kitten' ? 'kitten' : 'mew'
  const [builtin, setBuiltin] = useState<SpriteSkin>()
  useEffect(() => {
    let active = true
    void loadBuiltinSpriteSkin(builtinId).then(skin => { if (active) setBuiltin(skin) }).catch(() => {})
    return () => { active = false }
  }, [builtinId])
  const fallback = builtin?.id === builtinId ? builtin : undefined
  return id?.startsWith('custom:') ? custom.skins.find(skin => skin.id === id) ?? (custom.loading ? undefined : fallback) : fallback
}
