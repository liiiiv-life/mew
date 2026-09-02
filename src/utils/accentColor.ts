export type AccentColor = {
  accent: string
  accentStrong: string
  link: string
}

export const ACCENT_COLOR_KEY = 'mew:accent-color'

export const DEFAULT_ACCENT_COLOR: AccentColor = {
  accent: '#4432a8',
  accentStrong: '#37268a',
  link: '#7c5ce6',
}

function isValidHexColor(value: string | undefined): boolean {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

function normalizeAccentColor(value: unknown): AccentColor {
  if (!value || typeof value !== 'object') return { ...DEFAULT_ACCENT_COLOR }
  const candidate = value as Partial<AccentColor>
  return {
    accent: isValidHexColor(candidate.accent) ? candidate.accent! : DEFAULT_ACCENT_COLOR.accent,
    accentStrong: isValidHexColor(candidate.accentStrong) ? candidate.accentStrong! : DEFAULT_ACCENT_COLOR.accentStrong,
    link: isValidHexColor(candidate.link) ? candidate.link! : DEFAULT_ACCENT_COLOR.link,
  }
}

export function loadAccentColor(storage: Pick<Storage, 'getItem'> = localStorage): AccentColor {
  try {
    const raw = storage.getItem(ACCENT_COLOR_KEY)
    return raw ? normalizeAccentColor(JSON.parse(raw)) : { ...DEFAULT_ACCENT_COLOR }
  } catch {
    return { ...DEFAULT_ACCENT_COLOR }
  }
}

export function applyAccentColor(
  value: AccentColor,
  root: Pick<CSSStyleDeclaration, 'setProperty'> = document.documentElement.style,
): AccentColor {
  const colors = normalizeAccentColor(value)
  root.setProperty('--color-accent', colors.accent)
  root.setProperty('--color-accent-strong', colors.accentStrong)
  root.setProperty('--color-link', colors.link)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mew:accent-color-changed'))
  return colors
}

export function saveAccentColor(value: AccentColor, storage: Pick<Storage, 'setItem'> = localStorage): AccentColor {
  const colors = normalizeAccentColor(value)
  storage.setItem(ACCENT_COLOR_KEY, JSON.stringify(colors))
  return colors
}