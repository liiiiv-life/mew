export type FontPreferences = {
  ui: string
  markdown: string
  mono: string
}

export const FONT_PREFERENCES_KEY = 'mew:fonts'

export const DEFAULT_FONT_PREFERENCES: FontPreferences = {
  ui: 'IBM Plex Sans KR',
  markdown: 'IBM Plex Sans KR',
  mono: 'IBM Plex Mono',
}

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
])

function normalizedName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const clean = [...value]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 80)
  return clean || fallback
}

export function normalizeFontPreferences(value: unknown): FontPreferences {
  const candidate = value && typeof value === 'object' ? (value as Partial<FontPreferences>) : {}
  return {
    ui: normalizedName(candidate.ui, DEFAULT_FONT_PREFERENCES.ui),
    markdown: normalizedName(candidate.markdown, DEFAULT_FONT_PREFERENCES.markdown),
    mono: normalizedName(candidate.mono, DEFAULT_FONT_PREFERENCES.mono),
  }
}

export function loadFontPreferences(storage: Pick<Storage, 'getItem'> = localStorage): FontPreferences {
  try {
    const raw = storage.getItem(FONT_PREFERENCES_KEY)
    return raw ? normalizeFontPreferences(JSON.parse(raw)) : { ...DEFAULT_FONT_PREFERENCES }
  } catch {
    return { ...DEFAULT_FONT_PREFERENCES }
  }
}

function fontStack(name: string, fallback: string): string {
  const family = GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return `${family}, ${fallback}`
}

export function applyFontPreferences(
  value: FontPreferences,
  root: Pick<CSSStyleDeclaration, 'setProperty'> = document.documentElement.style,
): FontPreferences {
  const fonts = normalizeFontPreferences(value)
  root.setProperty('--mew-font-ui', fontStack(fonts.ui, 'ui-sans-serif, system-ui, sans-serif'))
  root.setProperty('--mew-font-markdown', fontStack(fonts.markdown, 'ui-sans-serif, system-ui, sans-serif'))
  root.setProperty('--mew-font-mono', fontStack(fonts.mono, '"IBM Plex Sans KR", ui-monospace, monospace'))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mew:fonts-changed'))
  return fonts
}

export function saveFontPreferences(value: FontPreferences, storage: Pick<Storage, 'setItem'> = localStorage): FontPreferences {
  const fonts = normalizeFontPreferences(value)
  storage.setItem(FONT_PREFERENCES_KEY, JSON.stringify(fonts))
  return fonts
}
