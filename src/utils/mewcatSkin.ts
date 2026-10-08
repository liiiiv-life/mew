import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { validMewpetSkinId } from '../../shared/mewpet-skins.ts'
/** 브라우저별 화면 취향이라 글꼴·액센트와 같이 localStorage에만 저장한다. */
export const MEWCAT_SKIN_KEY = 'mew:mewcat-skin'

export type MewcatSkin = string
export type MewcatSkinSelection = MewcatSkin | null

export function normalizeMewcatSkin(value: unknown): MewcatSkinSelection {
  return validMewpetSkinId(value) ? value : null
}

/** mew ID는 기본 뮤펫 스킨으로 이어받는다. 저장값이 없거나 옛 oreo 값이면 같은 기본값을 쓴다. */
export function loadMewcatSkin(storage?: Pick<Storage, 'getItem'>): MewcatSkinSelection {
  try {
    let value = (storage ?? scopedBrowserStorage()).getItem(MEWCAT_SKIN_KEY)
    if (value === null && !storage) {
      const legacy = localStorage.getItem(MEWCAT_SKIN_KEY)
      if (legacy === 'none' || legacy === 'mew' || legacy === 'oreo') value = legacy
    }
    return value === null || value === 'oreo' ? 'mew' : normalizeMewcatSkin(value)
  } catch {
    return 'mew'
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
