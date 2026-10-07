import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { uiText } from '@mew/ui/i18n-core'
/** 브라우저별 화면 취향이라 글꼴·액센트와 같이 localStorage에만 저장한다. */
export const MEWCAT_SKIN_KEY = 'mew:mewcat-skin'

export const MEWCAT_SKINS = [
  { id: 'mew', get name() { return uiText("기본") } },
] as const

export type MewcatSkin = (typeof MEWCAT_SKINS)[number]['id']
export type MewcatSkinSelection = MewcatSkin | null

export function normalizeMewcatSkin(value: unknown): MewcatSkinSelection {
  return MEWCAT_SKINS.some((skin) => skin.id === value) ? value as MewcatSkin : null
}

/** 저장값이 없으면 기본 스킨을 쓴다. 재배포 불가했던 oreo 값은 자체 기본 스킨으로 이관한다. */
export function loadMewcatSkin(storage: Pick<Storage, 'getItem'> = localStorage): MewcatSkinSelection {
  try {
    const value = storage.getItem(MEWCAT_SKIN_KEY)
    return value === null || value === 'oreo' ? 'mew' : normalizeMewcatSkin(value)
  } catch {
    return 'mew'
  }
}

export function saveMewcatSkin(
  value: MewcatSkinSelection,
  storage: Pick<Storage, 'setItem'> = localStorage,
): MewcatSkinSelection {
  const skin = normalizeMewcatSkin(value)
  storage.setItem(MEWCAT_SKIN_KEY, skin ?? 'none')
  return skin
}

export const MEWCAT_HIDE_DESKTOP_KEY = 'mew:mewcat-hide-desktop'

export function loadMewcatHideDesktop(): boolean {
  try { return scopedBrowserStorage().getItem(MEWCAT_HIDE_DESKTOP_KEY) === '1' } catch { return false }
}
