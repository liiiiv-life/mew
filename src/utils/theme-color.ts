export type ThemeMode = 'dark' | 'light'
export const THEME_COLOR_KEY = 'mew:theme-color'
const LEGACY_ACCENT_COLOR_KEY = 'mew:accent-color'
export const DEFAULT_THEME_COLOR = '#4432a8'

export function normalizeThemeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_THEME_COLOR
}

export function loadThemeColor(storage: Pick<Storage, 'getItem'> = localStorage): string {
  try {
    const saved = storage.getItem(THEME_COLOR_KEY)
    if (saved !== null) return normalizeThemeColor(saved)
    const legacy = JSON.parse(storage.getItem(LEGACY_ACCENT_COLOR_KEY) ?? 'null')
    return normalizeThemeColor(legacy?.accent)
  } catch { return DEFAULT_THEME_COLOR }
}

function luminance(rgb: number[]): number {
  return rgb.map(value => {
    const channel = value / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
}

// Mix toward white/black to reach a readable brightness without changing the hue family.
// Fixed luminance levels also keep very bright, dark and neutral choices usable.
function atLuminance(hex: string, target: number): string {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))
  const lighter = luminance(rgb) < target, end = lighter ? 255 : 0
  let low = 0, high = 1
  const mix = (amount: number) => rgb.map(channel => channel + (end - channel) * amount)
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2
    if ((luminance(mix(middle)) < target) === lighter) low = middle
    else high = middle
  }
  return '#' + mix((low + high) / 2).map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')
}

export function deriveThemeColors(value: string, theme: ThemeMode) {
  const color = normalizeThemeColor(value), dark = theme === 'dark'
  const accent = atLuminance(color, dark ? .35 : .10)
  return {
    accent,
    accentStrong: atLuminance(color, dark ? .50 : .055),
    link: accent,
    inkOnAccent: dark ? '#171717' : '#ffffff',
  }
}

export function applyThemeColor(value: string, theme: ThemeMode, root: Pick<CSSStyleDeclaration, 'setProperty'> = document.documentElement.style) {
  const colors = deriveThemeColors(value, theme)
  root.setProperty('--color-accent', colors.accent)
  root.setProperty('--color-accent-strong', colors.accentStrong)
  root.setProperty('--color-link', colors.link)
  root.setProperty('--color-ink-on-accent', colors.inkOnAccent)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mew:accent-color-changed'))
  return colors
}

export function saveThemeColor(value: string, storage: Pick<Storage, 'setItem'> = localStorage): string {
  const color = normalizeThemeColor(value)
  try { storage.setItem(THEME_COLOR_KEY, color) } catch { /* Keep the current session usable when storage is unavailable. */ }
  return color
}
