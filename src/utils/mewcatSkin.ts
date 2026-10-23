import { scopedBrowserStorage, globalBrowserStorage } from '@mew/ui/browser-storage-scope'
import { MEWPET_DEFAULT_SKIN_ID, validMewpetSkinId } from '../../shared/mewpet-skins.ts'
/** 브라우저별 화면 취향이라 글꼴·액센트와 같이 localStorage에만 저장한다. */
export const MEWCAT_SKIN_KEY = 'mew:mewcat-skin'

export type MewcatSkin = string
export type MewcatSkinSelection = MewcatSkin | null
const removedBuiltinSkins = new Set(['mew', 'oreo', 'kitten', 'russian-blue', 'black-cat', 'korean-shorthair', 'siamese', 'penguin'])

export function normalizeMewcatSkin(value: unknown): MewcatSkinSelection {
  if (typeof value === 'string' && removedBuiltinSkins.has(value)) return MEWPET_DEFAULT_SKIN_ID
  return validMewpetSkinId(value) ? value : null
}

/** 저장값이 없거나 제거된 내장 스킨을 선택했으면 카피바라를 사용한다. */
export function loadMewcatSkin(storage?: Pick<Storage, 'getItem'>): MewcatSkinSelection {
  try {
    let value = (storage ?? scopedBrowserStorage()).getItem(MEWCAT_SKIN_KEY)
    if (value === null && !storage) {
      const legacy = globalBrowserStorage().getItem(MEWCAT_SKIN_KEY)
      if (legacy === 'none' || legacy === MEWPET_DEFAULT_SKIN_ID || (legacy !== null && removedBuiltinSkins.has(legacy))) value = legacy
    }
    return value === null ? MEWPET_DEFAULT_SKIN_ID : normalizeMewcatSkin(value)
  } catch {
    return MEWPET_DEFAULT_SKIN_ID
  }
}

export function saveMewcatSkin(
  value: MewcatSkinSelection,
  storage: Pick<Storage, 'setItem'> = scopedBrowserStorage(),
): MewcatSkinSelection {
  const skin = normalizeMewcatSkin(value)
  storage.setItem(MEWCAT_SKIN_KEY, skin ?? 'none')
  return skin
}

export const MEWCAT_HIDE_DESKTOP_KEY = 'mew:mewcat-hide-desktop'

export function loadMewcatHideDesktop(): boolean {
  try { return scopedBrowserStorage().getItem(MEWCAT_HIDE_DESKTOP_KEY) === '1' } catch { return false }
}
