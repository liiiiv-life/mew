import { uiText } from '@mew/ui/i18n-core'

interface DrawingFontText {
  fontFamily?: string
  fontWeight?: number
  text?: string
}

const SYSTEM_FONTS = new Set(['arial', 'helvetica', 'sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'times new roman', 'georgia', 'courier new'])
const requests = new Map<string, Promise<string>>()
const installed = new Set<string>()
const MAX_CACHE_ENTRIES = 64

function fontFamily(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '').slice(0, 100)
}

function fontError(family: string): Error {
  return new Error(uiText('글꼴을 불러오지 못했습니다: {name}', { name: family }))
}

function uniqueCharacters(text: string): string {
  return [...new Set(Array.from(text || 'Aa가나다0123456789'))].sort().join('')
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}

async function downloadFontCss(family: string, text: string, weight: number): Promise<string> {
  const url = new URL('https://fonts.googleapis.com/css2')
  url.searchParams.set('family', `${family}:wght@${weight}`)
  url.searchParams.set('display', 'swap')
  url.searchParams.set('text', text)
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw fontError(family)
  const stylesheet = await response.text()
  const faces = stylesheet.match(/@font-face\s*\{[^}]+\}/g)
  if (!faces?.length) throw fontError(family)
  return (await Promise.all(faces.map(async face => {
    const sources = [...face.matchAll(/url\(\s*(['"]?)(https:[^)'"\s]+)\1\s*\)/g)]
    if (!sources.length) throw fontError(family)
    let embedded = face
    for (const source of sources) {
      const sourceUrl = new URL(source[2])
      if (sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'fonts.gstatic.com') throw fontError(family)
      const font = await fetch(sourceUrl, { signal: AbortSignal.timeout(15_000) })
      if (!font.ok) throw fontError(family)
      const data = new Uint8Array(await font.arrayBuffer())
      if (data.length > 8 * 1024 * 1024) throw fontError(family)
      const signature = String.fromCharCode(...data.subarray(0, 4))
      const mime = signature === 'wOF2' ? 'font/woff2' : signature === 'wOFF' ? 'font/woff' : signature === 'OTTO' ? 'font/otf' : 'font/ttf'
      embedded = embedded.replace(source[0], `url("data:${mime};base64,${base64(data)}")`)
    }
    return embedded
  }))).join('\n')
}

function fontCss(family: string, text: string, weight: number): Promise<string> {
  const key = JSON.stringify([family, weight, text])
  const cached = requests.get(key)
  if (cached) return cached
  const request = downloadFontCss(family, text, weight).catch(error => {
    requests.delete(key)
    throw error
  })
  requests.set(key, request)
  if (requests.size > MAX_CACHE_ENTRIES) requests.delete(requests.keys().next().value!)
  return request
}

/** Download only the used glyphs, and embed them so exported SVGs do not depend on a network. */
export async function embeddedDrawingFontCss(objects: readonly DrawingFontText[]): Promise<string> {
  const fonts = new Map<string, { family: string; weight: number; text: string }>()
  for (const object of objects) {
    const family = fontFamily(object.fontFamily || 'Arial')
    if (!family || SYSTEM_FONTS.has(family.toLowerCase()) || !object.text) continue
    const weight = Math.min(900, Math.max(100, Math.round((object.fontWeight || 400) / 100) * 100))
    const key = JSON.stringify([family, weight])
    const current = fonts.get(key)
    fonts.set(key, { family, weight, text: (current?.text || '') + object.text })
  }
  const jobs: Promise<string>[] = []
  for (const { family, weight, text } of fonts.values()) {
    const characters = Array.from(uniqueCharacters(text))
    // Bound request URLs, including Korean and emoji UTF-8 escaping.
    for (let offset = 0; offset < characters.length; offset += 250) jobs.push(fontCss(family, characters.slice(offset, offset + 250).join(''), weight))
  }
  return (await Promise.all(jobs)).join('\n')
}

/** Reuse the same portable font data in the live SVG preview. */
export async function loadDrawingFont(family: string, text = 'Aa가나다0123456789'): Promise<void> {
  const normalized = fontFamily(family)
  if (!normalized || SYSTEM_FONTS.has(normalized.toLowerCase())) return
  const css = await embeddedDrawingFontCss([{ fontFamily: normalized, fontWeight: 400, text }, { fontFamily: normalized, fontWeight: 700, text }])
  if (!installed.has(css)) {
    const style = document.createElement('style')
    style.dataset.mewDrawingFont = normalized
    style.textContent = css
    document.head.append(style)
    installed.add(css)
  }
  await document.fonts.load(`16px ${JSON.stringify(normalized)}`, text)
}
