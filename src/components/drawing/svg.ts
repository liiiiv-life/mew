import { normalizeDocument } from './model.ts'
import type { Bounds, DrawingDocument, DrawingObject } from './model.ts'
import { objectBounds, pathData } from './geometry.ts'

export interface SvgOptions { padding?: number; background?: string; fontCss?: string }

export function escapeXml(value: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
  return value.replace(/[&<>"'\p{Cc}]/gu, character => entities[character] ?? (character.charCodeAt(0) < 32 && !'\t\n\r'.includes(character) ? '' : character))
}

function unescapeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? match
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

function n(value: number): string { return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0' }

export function drawingExportBounds(document: DrawingDocument, padding = 32): Bounds {
  if (!document.objects.length) return { x: -256, y: -192, width: 512, height: 384 }
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
  for (const object of document.objects) {
    const bounds = objectBounds(object)
    const textStrokeScale = object.type === 'text' ? Math.max(object.textScaleX ?? 1, object.textScaleY ?? 1) : 1
    const stroke = object.stroke !== 'none' && object.stroke !== 'transparent' ? object.strokeWidth / 2 * textStrokeScale : 0
    x = Math.min(x, bounds.x - stroke); y = Math.min(y, bounds.y - stroke)
    right = Math.max(right, bounds.x + bounds.width + stroke); bottom = Math.max(bottom, bounds.y + bounds.height + stroke)
  }
  const gap = Number.isFinite(padding) ? Math.max(0, padding) : 32
  return { x: x - gap, y: y - gap, width: Math.max(1, right - x + gap * 2), height: Math.max(1, bottom - y + gap * 2) }
}

function objectSvg(object: DrawingObject): string {
  const width = n(object.width), height = n(object.height)
  const fill = escapeXml(object.fill), stroke = escapeXml(object.stroke)
  const style = `fill="${fill}" stroke="${stroke}" stroke-width="${n(object.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"`
  let shape = ''
  switch (object.type) {
    case 'rect': shape = `<rect x="0" y="0" width="${width}" height="${height}" ${style}/>`; break
    case 'ellipse': shape = `<ellipse cx="${n(object.width / 2)}" cy="${n(object.height / 2)}" rx="${n(object.width / 2)}" ry="${n(object.height / 2)}" ${style}/>`; break
    case 'line':
    case 'path': {
      const points = object.points?.length ? object.points : [{ x: 0, y: 0 }, { x: object.width, y: object.height }]
      shape = `<path d="${pathData(points, object.closed)}" ${style}/>`
      break
    }
    case 'text': {
      const fontSize = object.fontSize ?? 24
      const lines = (object.text ?? '').split('\n').map((line, index) => `<tspan x="0" y="${n(fontSize * (1 + index * 1.2))}">${escapeXml(line || ' ')}</tspan>`).join('')
      shape = `<g transform="scale(${n(object.textScaleX ?? 1)} ${n(object.textScaleY ?? 1)})"><text font-family="${escapeXml(object.fontFamily ?? 'Inter')}" font-size="${n(fontSize)}" font-weight="${n(object.fontWeight ?? 400)}" xml:space="preserve" ${style}>${lines}</text></g>`
      break
    }
    case 'image': shape = `<image href="${escapeXml(object.src ?? '')}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>`; break
  }
  return `<g transform="translate(${n(object.x)} ${n(object.y)}) rotate(${n(object.rotation)} ${n(object.width / 2)} ${n(object.height / 2)})">${shape}</g>`
}

/** Saved SVG contains editable source alongside a standalone visual representation. */
export function serializeSvg(source: DrawingDocument, options: SvgOptions = {}): string {
  const document = normalizeDocument(source)
  if (!document) throw new Error('Invalid drawing document')
  const bounds = drawingExportBounds(document, options.padding)
  const viewBox = `${n(bounds.x)} ${n(bounds.y)} ${n(bounds.width)} ${n(bounds.height)}`
  const metadata = `<metadata id="mew-drawing">${escapeXml(JSON.stringify(document))}</metadata>`
  const fonts = options.fontCss ? `<defs><style>${escapeXml(options.fontCss)}</style></defs>` : ''
  const background = options.background ? `<rect x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.width)}" height="${n(bounds.height)}" fill="${escapeXml(options.background)}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(bounds.width)}" height="${n(bounds.height)}" viewBox="${viewBox}" role="img">${metadata}${fonts}${background}${document.objects.map(objectSvg).join('')}</svg>`
}

/** Only Mew's own editable metadata is imported; arbitrary SVG markup is never executed. */
export function parseSvgDocument(svg: string): DrawingDocument | null {
  if (typeof svg !== 'string' || svg.length > 64 * 1024 * 1024) return null
  const metadata = svg.match(/<metadata\b[^>]*\bid\s*=\s*(["'])mew-drawing\1[^>]*>([\s\S]*?)<\/metadata\s*>/i)
  if (!metadata) return null
  try { return normalizeDocument(JSON.parse(unescapeXml(metadata[2]))) } catch { return null }
}

export async function rasterizeSvg(svg: string, options: { scale?: number } = {}): Promise<Blob> {
  const source = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(source)
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Drawing image could not be rendered')); image.src = url })
    const requestedScale = options.scale ?? Math.min(2, globalThis.devicePixelRatio || 1)
    const naturalWidth = image.naturalWidth || image.width || 512, naturalHeight = image.naturalHeight || image.height || 384
    const scale = Math.min(Math.max(0.1, requestedScale), 8192 / naturalWidth, 8192 / naturalHeight, Math.sqrt(16_777_216 / (naturalWidth * naturalHeight)))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(naturalWidth * scale)); canvas.height = Math.max(1, Math.ceil(naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Drawing canvas is unavailable')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Drawing image could not be exported')), 'image/png'))
  } finally { URL.revokeObjectURL(url) }
}
