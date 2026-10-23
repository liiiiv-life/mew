export interface ThemePalette {
  background: string
  text: string
  primary: string
  gradient?: ThemeGradient
}

export interface ThemeGradient {
  colors: [string, string]
  angle: number
  animated: boolean
}

export interface ThemeSettings {
  palette: ThemePalette
  custom: ThemePalette[]
}

export const THEME_PRESETS = [
  { id: 'dark', palette: { background: '#0a0a0a', text: '#e5e5e5', primary: '#9082da' } },
  { id: 'light', palette: { background: '#ffffff', text: '#262626', primary: '#5642c7' } },
  { id: 'midnight', palette: { background: '#101827', text: '#dbe7f5', primary: '#7cb7ed', gradient: { colors: ['#30264c', '#123841'], angle: 135, animated: true } } },
  { id: 'forest', palette: { background: '#11201b', text: '#e1eee6', primary: '#80bf93' } },
  { id: 'paper', palette: { background: '#f6f0e3', text: '#433d31', primary: '#8c633a' } },
  { id: 'rose', palette: { background: '#f9eff1', text: '#4b313b', primary: '#aa456b', gradient: { colors: ['#f2d9e7', '#fae6d8'], angle: 135, animated: true } } },
  { id: 'ocean', palette: { background: '#edf5fa', text: '#203e51', primary: '#236a9b', gradient: { colors: ['#d4e6fb', '#d2efeb'], angle: 135, animated: true } } },
] satisfies { id: 'dark' | 'light' | 'midnight' | 'forest' | 'paper' | 'rose' | 'ocean', palette: ThemePalette }[]
export const DEFAULT_THEME_PALETTE: ThemePalette = THEME_PRESETS[2].palette

export function sameThemePalette(a: ThemePalette, b: ThemePalette): boolean {
  return a.background === b.background && a.text === b.text && a.primary === b.primary
    && (!a.gradient && !b.gradient || !!a.gradient && !!b.gradient
      && a.gradient.colors[0] === b.gradient.colors[0] && a.gradient.colors[1] === b.gradient.colors[1]
      && a.gradient.angle === b.gradient.angle && a.gradient.animated === b.gradient.animated)
}

const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

export function normalizePalette(value: unknown): ThemePalette | null {
  if (!value || typeof value !== 'object') return null
  const palette = value as ThemePalette
  if (![palette.background, palette.text, palette.primary].every(isHexColor)) return null
  const normalized: ThemePalette = { background: palette.background.toLowerCase(), text: palette.text.toLowerCase(), primary: palette.primary.toLowerCase() }
  const gradient = palette.gradient
  if (gradient && Array.isArray(gradient.colors) && gradient.colors.length === 2 && gradient.colors.every(isHexColor)
    && typeof gradient.angle === 'number' && Number.isFinite(gradient.angle) && typeof gradient.animated === 'boolean') {
    normalized.gradient = { colors: [gradient.colors[0].toLowerCase(), gradient.colors[1].toLowerCase()], angle: (gradient.angle % 360 + 360) % 360, animated: gradient.animated }
  }
  return normalized
}

export function uniqueCustomThemes(value: unknown): ThemePalette[] {
  const themes: ThemePalette[] = []
  if (Array.isArray(value)) for (const entry of value) {
    const palette = normalizePalette(entry)
    if (palette && !THEME_PRESETS.some(preset => sameThemePalette(preset.palette, palette)) && !themes.some(theme => sameThemePalette(theme, palette))) themes.push(palette)
  }
  return themes
}

export function normalizeThemeSettings(value: ThemeSettings): ThemeSettings {
  const palette = normalizePalette(value.palette) ?? DEFAULT_THEME_PALETTE
  return { palette, custom: uniqueCustomThemes([...value.custom, palette]) }
}

export class ThemeSettingsError extends Error {}

export function parseThemeSettings(input: unknown): ThemeSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ThemeSettingsError('Invalid theme settings')
  const value = input as ThemeSettings
  if (!normalizePalette(value.palette) || !Array.isArray(value.custom)) throw new ThemeSettingsError('Invalid theme settings')
  return normalizeThemeSettings(value)
}
