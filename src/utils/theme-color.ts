import { DEFAULT_THEME_PALETTE, THEME_PRESETS, normalizePalette, normalizeThemeSettings, sameThemePalette, uniqueCustomThemes, type ThemePalette, type ThemeSettings } from '../../shared/theme.ts'
export { DEFAULT_THEME_PALETTE, THEME_PRESETS, normalizeThemeSettings, sameThemePalette, type ThemeGradient, type ThemePalette, type ThemeSettings } from '../../shared/theme.ts'
import { globalBrowserStorage } from '@mew/ui/browser-storage-scope'

export type ThemeMode = 'dark' | 'light'
export const THEME_COLOR_KEY = 'mew:theme-color'
const LEGACY_ACCENT_COLOR_KEY = 'mew:accent-color'
export const DEFAULT_THEME_COLOR = '#4432a8'

export function normalizeThemeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_THEME_COLOR
}

export function loadThemeColor(storage: Pick<Storage, 'getItem'> = globalBrowserStorage()): string {
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

function hexLuminance(hex: string): number {
  return luminance([1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)))
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

export function saveThemeColor(value: string, storage: Pick<Storage, 'setItem'> = globalBrowserStorage()): string {
  const color = normalizeThemeColor(value)
  try { storage.setItem(THEME_COLOR_KEY, color) } catch { /* Keep the current session usable when storage is unavailable. */ }
  return color
}

export const THEME_SETTINGS_KEY = 'mew:themes'

export function loadThemeSettings(storage: Pick<Storage, 'getItem'> = globalBrowserStorage()): ThemeSettings {
  try {
    const saved = JSON.parse(storage.getItem(THEME_SETTINGS_KEY) ?? 'null')
    const palette = normalizePalette(saved?.palette)
    if (palette) {
      const custom = uniqueCustomThemes(saved.custom)
      let active = palette
      if (!palette.gradient && saved.palette.gradient === undefined && !custom.some(theme => sameThemePalette(theme, palette))) {
        const preset = THEME_PRESETS.find(preset => preset.palette.gradient && sameThemePalette(palette, { background: preset.palette.background, text: preset.palette.text, primary: preset.palette.primary }))
        if (preset) active = preset.palette
      }
      return normalizeThemeSettings({ palette: active, custom })
    }
  } catch { /* Invalid saved palettes fall back to the previous appearance. */ }
  let mode: ThemeMode = 'dark'
  try {
    const previousMode = storage.getItem('mew:theme')
    if (previousMode === null && storage.getItem(THEME_COLOR_KEY) === null && storage.getItem(LEGACY_ACCENT_COLOR_KEY) === null) {
      return { palette: DEFAULT_THEME_PALETTE, custom: [] }
    }
    if (previousMode === 'light') mode = 'light'
  } catch { return { palette: DEFAULT_THEME_PALETTE, custom: [] } }
  const palette = { ...THEME_PRESETS[mode === 'dark' ? 0 : 1].palette, primary: deriveThemeColors(loadThemeColor(storage), mode).accent }
  return { palette, custom: uniqueCustomThemes([palette]) }
}

export function colorContrast(a: string, b: string): number {
  return (Math.max(hexLuminance(a), hexLuminance(b)) + .05) / (Math.min(hexLuminance(a), hexLuminance(b)) + .05)
}

export function themePaletteMode(palette: ThemePalette): ThemeMode {
  return colorContrast(palette.background, '#ffffff') > colorContrast(palette.background, '#000000') ? 'dark' : 'light'
}

function mix(a: string, b: string, amount: number): string {
  return '#' + [1, 3, 5].map(index => Math.round(parseInt(a.slice(index, index + 2), 16) * (1 - amount) + parseInt(b.slice(index, index + 2), 16) * amount).toString(16).padStart(2, '0')).join('')
}

function backgroundSamples(palette: ThemePalette): string[] {
  if (!palette.gradient) return [palette.background]
  const [first, second] = palette.gradient.colors
  const samples: string[] = []
  // Both radial layers blend with each other and the solid fallback in sRGB.
  for (let firstStep = 0; firstStep <= 16; firstStep++) for (let secondStep = 0; secondStep <= 16 - firstStep; secondStep++) {
    const firstWeight = firstStep / 16, secondWeight = secondStep / 16
    samples.push('#' + [1, 3, 5].map(index => Math.round(
      parseInt(palette.background.slice(index, index + 2), 16) * (1 - firstWeight - secondWeight)
      + parseInt(first.slice(index, index + 2), 16) * firstWeight
      + parseInt(second.slice(index, index + 2), 16) * secondWeight,
    ).toString(16).padStart(2, '0')).join(''))
  }
  return samples
}

export function themePaletteContrast(value: ThemePalette): number {
  const palette = normalizePalette(value) ?? DEFAULT_THEME_PALETTE
  const levels = backgroundSamples(palette).map(hexLuminance), text = hexLuminance(palette.text)
  const low = Math.min(...levels), high = Math.max(...levels)
  if (text >= low && text <= high) return 1
  return text < low ? (low + .05) / (text + .05) : (text + .05) / (high + .05)
}

export function themeBackgroundImage(value: ThemePalette): string {
  const palette = normalizePalette(value) ?? DEFAULT_THEME_PALETTE
  if (!palette.gradient) return 'none'
  const { colors, angle } = palette.gradient
  const radians = angle * Math.PI / 180
  const point = (direction: number) => `${+(50 + Math.sin(radians) * direction * 38).toFixed(2)}% ${+(50 - Math.cos(radians) * direction * 38).toFixed(2)}%`
  return colors.map((color, index) => `radial-gradient(ellipse 80% 100% at ${point(index ? -1 : 1)}, ${color} 0%, ${color}00 72%)`).join(', ')
}

function readableLink(color: string, surfaces: string[]): string {
  if (surfaces.every(surface => colorContrast(color, surface) >= 4.5)) return color
  const low = (Math.min(...surfaces.map(hexLuminance)) + .05) / 4.5 - .05
  const high = (Math.max(...surfaces.map(hexLuminance)) + .05) * 4.5 - .05
  const target = high <= 1 ? Math.min(1, high + .002) : low >= 0 ? Math.max(0, low - .002)
    : Math.min(...surfaces.map(surface => colorContrast('#ffffff', surface))) > Math.min(...surfaces.map(surface => colorContrast('#000000', surface))) ? 1 : 0
  return atLuminance(color, target)
}

export function deriveThemePalette(value: ThemePalette) {
  const palette = normalizePalette(value) ?? DEFAULT_THEME_PALETTE
  const { background, text, primary } = palette, dark = themePaletteMode(palette) === 'dark'
  const workspace = mix(background, text, dark ? .059 : .046)
  // Gradient components use a stronger tint through which the shared backdrop stays visible.
  const surface = mix(background, text, palette.gradient ? dark ? .10 : .08 : dark ? .059 : .030)
  const raised = mix(background, text, palette.gradient ? dark ? .21 : .14 : dark ? .128 : .075)
  const hover = mix(background, text, palette.gradient ? dark ? .31 : .22 : dark ? .247 : .140)
  const preferredInk = dark ? '#171717' : '#ffffff'
  const inkOnAccent = colorContrast(primary, preferredInk) >= 4.5 ? preferredInk
    : colorContrast(primary, '#000000') >= colorContrast(primary, '#ffffff') ? '#000000' : '#ffffff'
  const strongTarget = hexLuminance(primary) + (dark ? .08 : -.045)
  const strongLimit = inkOnAccent === '#ffffff' ? 1.05 / 4.5 - .05 : (hexLuminance(inkOnAccent) + .05) * 4.5 - .05
  const strong = atLuminance(primary, inkOnAccent === '#ffffff' ? Math.max(.001, Math.min(strongTarget, strongLimit - .002)) : Math.min(.999, Math.max(strongTarget, strongLimit + .002)))
  return {
    workspace,
    'surface-deep': background,
    surface: surface + (palette.gradient ? '7a' : ''),
    'surface-raised': raised + (palette.gradient ? '94' : ''),
    'surface-hover': hover + (palette.gradient ? 'b8' : ''),
    'surface-solid': surface,
    'surface-raised-solid': raised,
    'surface-hover-solid': hover,
    edge: mix(background, text, dark ? .128 : .120),
    'edge-strong': mix(background, text, dark ? .247 : .198),
    'edge-bright': mix(background, text, dark ? .329 : .424),
    'ink-bright': mix(text, dark ? '#ffffff' : '#000000', dark ? .8 : .395),
    ink: text,
    'ink-soft': mix(text, background, dark ? .078 : .120),
    'ink-secondary': mix(text, background, dark ? .301 : .203),
    'ink-muted': mix(text, background, dark ? .521 : .355),
    'ink-faint': mix(text, background, dark ? .671 : .576),
    accent: primary,
    'accent-strong': strong,
    link: readableLink(primary, [...backgroundSamples(palette), surface, raised, ...(palette.gradient ? [hover] : [])]),
    'ink-on-accent': inkOnAccent,
  }
}

export function applyThemePalette(palette: ThemePalette, root: Pick<HTMLElement, 'classList' | 'style'> = document.documentElement) {
  const normalized = normalizePalette(palette) ?? DEFAULT_THEME_PALETTE
  const colors = deriveThemePalette(normalized)
  root.classList.toggle('dark', themePaletteMode(normalized) === 'dark')
  root.classList.toggle('theme-gradient', !!normalized.gradient)
  for (const [token, color] of Object.entries(colors)) root.style.setProperty(`--color-${token}`, color)
  root.style.setProperty('--theme-background-image', themeBackgroundImage(normalized))
  root.style.setProperty('--theme-background-animation', normalized.gradient?.animated ? 'theme-background-drift 18s ease-in-out infinite alternate' : 'none')
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mew:accent-color-changed'))
  return colors
}

export function saveThemeSettings(value: ThemeSettings, storage: Pick<Storage, 'setItem'> = globalBrowserStorage()): ThemeSettings {
  const settings = normalizeThemeSettings(value)
  try {
    storage.setItem(THEME_SETTINGS_KEY, JSON.stringify(settings))
    storage.setItem('mew:theme', themePaletteMode(settings.palette))
  } catch { /* Keep the current session usable when storage is unavailable. */ }
  return settings
}
