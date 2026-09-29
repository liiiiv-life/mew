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

// Preserve HSL hue and saturation while adjusting lightness for readable contrast.
// White/black mixing washes out saturated source colors when brightening them.
function atLuminance(hex: string, target: number): string {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  const max = Math.max(...rgb), min = Math.min(...rgb), chroma = max - min
  const lightness = (max + min) / 2
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1))
  const hue = chroma === 0 ? 0 : max === rgb[0]
    ? ((rgb[1] - rgb[2]) / chroma + 6) % 6
    : max === rgb[1] ? (rgb[2] - rgb[0]) / chroma + 2 : (rgb[0] - rgb[1]) / chroma + 4
  const atLightness = (value: number) => {
    const c = (1 - Math.abs(2 * value - 1)) * saturation
    const x = c * (1 - Math.abs(hue % 2 - 1))
    const channels = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x]
      : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
    return channels.map(channel => (channel + value - c / 2) * 255)
  }
  let low = 0, high = 1
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2
    if (luminance(atLightness(middle)) < target) low = middle
    else high = middle
  }
  return '#' + atLightness((low + high) / 2).map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')
}

export function deriveThemeColors(value: string, theme: ThemeMode) {
  const color = normalizeThemeColor(value), dark = theme === 'dark'
  const accent = atLuminance(color, dark ? .27 : .10)
  return {
    accent,
    accentStrong: atLuminance(color, dark ? .35 : .055),
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
