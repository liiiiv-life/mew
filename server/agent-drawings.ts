import express from 'express'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import { fileAccess } from './access-policy.ts'
import { authOf, requireAuthenticated, requireFeature } from './reqAuth.ts'
import { WORKSPACE_PROJECT, workspacePaths } from './paths.ts'

export const MAX_DRAWING_BYTES = 32 * 1024 * 1024
const DIRECTORY = '.mew/temp/drawings'
const LEGACY_DIRECTORY = '.mew/drawings'
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const TAGS = new Set(['svg', 'g', 'rect', 'ellipse', 'circle', 'line', 'path', 'polyline', 'polygon', 'text', 'tspan', 'image', 'metadata', 'title', 'desc', 'defs', 'style'])
const ATTRIBUTES = new Set(['id', 'width', 'height', 'viewBox', 'role', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'rx', 'ry', 'r', 'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linejoin', 'stroke-linecap', 'stroke-dasharray', 'stroke-dashoffset', 'fill-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'preserveAspectRatio'])

export interface AgentDrawing {
  id: string
  name: string
  createdAt: string
  path: string
  bytes: number
}

export class AgentDrawingError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

function invalidSvg(): never { throw new AgentDrawingError('지원하는 그림 SVG 형식이 아닙니다') }

function dataResource(value: string, kind: 'image' | 'font'): boolean {
  const allowed = kind === 'image' ? 'image/(?:png|jpeg|webp|gif|avif|bmp)' : '(?:font/(?:woff2?|ttf|otf)|application/(?:font-woff|x-font-ttf|x-font-opentype|octet-stream))'
  return new RegExp(`^data:${allowed};base64,[A-Za-z0-9+/]+={0,2}$`, 'i').test(value)
}

function validateFontCss(css: string): void {
  let normalized = css.replace(/\/\*[\s\S]*?\*\//g, '')
  normalized = normalized.replace(/url\(\s*(["']?)([^\s"'()]+)\1\s*\)/gi, (_match, _quote: string, url: string) => {
    if (!dataResource(url, 'font')) invalidSvg()
    return 'url(MEW_FONT)'
  })
  const face = /\s*@font-face\s*\{([^{}]*)\}/gy
  let offset = 0
  while (offset < normalized.length && normalized.slice(offset).trim()) {
    face.lastIndex = offset
    const match = face.exec(normalized)
    if (!match) invalidSvg()
    let source = false
    for (const declaration of match[1].split(';').filter(value => value.trim())) {
      const colon = declaration.indexOf(':')
      if (colon < 0) invalidSvg()
      const property = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim()
      if (property === 'src') {
        if (!/^url\(MEW_FONT\)(?:\s+format\(["'](?:woff2?|truetype|opentype)["']\))?$/i.test(value)) invalidSvg()
        source = true
      } else if (property === 'font-family') {
        if (!/^(?:"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'|[\w -]+)$/.test(value)) invalidSvg()
      } else if (property === 'font-style') {
        if (!/^(?:normal|italic|oblique(?:\s+-?\d+(?:\.\d+)?deg){0,2})$/.test(value)) invalidSvg()
      } else if (property === 'font-weight') {
        if (!/^(?:normal|bold|[1-9]\d{0,2}|1000)(?:\s+(?:[1-9]\d{0,2}|1000))?$/.test(value)) invalidSvg()
      } else if (property === 'font-stretch') {
        if (!/^(?:normal|\d+(?:\.\d+)?%(?:\s+\d+(?:\.\d+)?%)?)$/.test(value)) invalidSvg()
      } else if (property === 'font-display') {
        if (!/^(?:auto|block|swap|fallback|optional)$/.test(value)) invalidSvg()
      } else if (property === 'unicode-range') {
        if (!/^U\+[a-f0-9?]{1,6}(?:-[a-f0-9]{1,6})?(?:\s*,\s*U\+[a-f0-9?]{1,6}(?:-[a-f0-9]{1,6})?)*$/i.test(value)) invalidSvg()
      } else invalidSvg()
    }
    if (!source) invalidSvg()
    offset = face.lastIndex
  }
}

/** Accept the editor's inert SVG subset, including raster images and embedded fonts. */
export function validateDrawingSvg(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) invalidSvg()
  if (Buffer.byteLength(value) > MAX_DRAWING_BYTES) throw new AgentDrawingError('그림은 32 MiB 이하로 저장하세요', 413)
  const source = value.replace(/^\uFEFF?\s*<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>/i, '')
  if (/<[!?]/.test(source) || /(?![\t\n\r])\p{Cc}/u.test(source) || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[a-f0-9]+);)/i.test(source)) invalidSvg()
  let tags = 0
  for (let position = source.indexOf('<'); position >= 0; position = source.indexOf('<', position + 1)) if (++tags > 100_000) invalidSvg()
  let malformed = false
  const fragment = parseFragment(source, { sourceCodeLocationInfo: true, onParseError: () => { malformed = true } })
  const roots = fragment.childNodes.filter(node => node.nodeName !== '#text' || (node as DefaultTreeAdapterTypes.TextNode).value.trim())
  if (malformed || roots.length !== 1 || roots[0].nodeName !== 'svg') invalidSvg()
  const pending: DefaultTreeAdapterTypes.ChildNode[] = [roots[0]]
  let count = 0
  while (pending.length) {
    const node = pending.pop()!
    if (++count > 100_000) invalidSvg()
    if (node.nodeName === '#text') continue
    if (!('tagName' in node) || node.namespaceURI !== SVG_NAMESPACE || !TAGS.has(node.tagName)) invalidSvg()
    const location = node.sourceCodeLocation
    if (!location?.startTag || (!location.endTag && !source.slice(location.startTag.startOffset, location.startTag.endOffset).endsWith('/>'))) invalidSvg()
    for (const attr of node.attrs) {
      if (attr.name === 'xmlns' && !attr.prefix && node.tagName === 'svg' && attr.value === SVG_NAMESPACE) continue
      if (attr.prefix === 'xmlns' && attr.name === 'xlink' && attr.value === 'http://www.w3.org/1999/xlink') continue
      if (attr.prefix === 'xml' && attr.name === 'space' && attr.namespace === 'http://www.w3.org/XML/1998/namespace' && ['preserve', 'default'].includes(attr.value)) continue
      if (attr.name === 'href' && (!attr.namespace || attr.namespace === 'http://www.w3.org/1999/xlink') && node.tagName === 'image' && dataResource(attr.value, 'image')) continue
      if (attr.namespace || attr.prefix || !ATTRIBUTES.has(attr.name) || /(?:url\s*\(|javascript\s*:|expression\s*\(|[\\{};])/i.test(attr.value)) invalidSvg()
    }
    if (node.tagName === 'style') {
      if (node.childNodes.some(child => child.nodeName !== '#text')) invalidSvg()
      validateFontCss(node.childNodes.map(child => (child as DefaultTreeAdapterTypes.TextNode).value).join(''))
    }
    if (['metadata', 'title', 'desc'].includes(node.tagName) && node.childNodes.some(child => child.nodeName !== '#text')) invalidSvg()
    for (const child of node.childNodes) pending.push(child)
  }
}

function checkedId(value: string): string {
  if (!ID.test(value)) throw new AgentDrawingError('올바른 그림 ID가 아닙니다')
  return value
}

function filesystemError(error: unknown): never {
  if (error instanceof AgentDrawingError) throw error
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AgentDrawingError('저장된 그림을 찾을 수 없습니다', 404)
  throw new AgentDrawingError('그림 저장 경로에 접근할 수 없습니다')
}

async function drawingDirectory(root: string, create = false, relativeDirectory = DIRECTORY): Promise<string | null> {
  try {
    const realRoot = await fs.realpath(root)
    let directory = realRoot
    for (const segment of relativeDirectory.split('/')) {
      directory = path.join(directory, segment)
      if (create) {
        try { await fs.mkdir(directory, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      }
      let stat
      try { stat = await fs.lstat(directory) } catch (error) { if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
      if (stat.isSymbolicLink() || !stat.isDirectory() || await fs.realpath(directory) !== directory) throw new AgentDrawingError('그림 저장 폴더는 심볼릭 링크를 사용할 수 없습니다')
    }
    return directory
  } catch (error) { return filesystemError(error) }
}

async function readRegularFile(file: string, maximum: number): Promise<string> {
  let handle
  try {
    const entry = await fs.lstat(file)
    if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1 || entry.size > maximum) throw new AgentDrawingError('지원하는 그림 파일이 아닙니다')
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maximum || stat.ino !== entry.ino || stat.dev !== entry.dev) throw new AgentDrawingError('지원하는 그림 파일이 아닙니다')
    const text = await handle.readFile('utf8')
    if (Buffer.byteLength(text) > maximum) throw new AgentDrawingError('지원하는 그림 파일이 아닙니다')
    return text
  } catch (error) { return filesystemError(error) } finally { await handle?.close() }
}

function drawingRecord(value: unknown, id: string, relativeDirectory = DIRECTORY): AgentDrawing {
  const record = value as AgentDrawing
  if (!record || record.id !== id || typeof record.name !== 'string' || record.name.length > 120 || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isSafeInteger(record.bytes) || record.bytes <= 0 || record.bytes > MAX_DRAWING_BYTES) throw new AgentDrawingError('그림 기록을 읽을 수 없습니다')
  return { id, name: record.name, createdAt: record.createdAt, path: `${relativeDirectory}/${id}.svg`, bytes: record.bytes }
}

async function writeNewFile(file: string, content: string): Promise<void> {
  const handle = await fs.open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  try { await handle.writeFile(content) } catch (error) { await fs.unlink(file).catch(() => {}); throw error } finally { await handle.close() }
}

export async function saveAgentDrawing(root: string, svg: unknown, name?: unknown): Promise<AgentDrawing> {
  validateDrawingSvg(svg)
  if (name !== undefined && (typeof name !== 'string' || name.length > 120 || /\p{Cc}/u.test(name))) throw new AgentDrawingError('그림 이름은 120자 이하로 입력하세요')
  const directory = (await drawingDirectory(root, true))!
  const id = randomUUID(), createdAt = new Date().toISOString()
  const record: AgentDrawing = { id, name: (name as string | undefined)?.trim() || '그림', createdAt, path: `${DIRECTORY}/${id}.svg`, bytes: Buffer.byteLength(svg) }
  const svgPath = path.join(directory, `${id}.svg`), metadataPath = path.join(directory, `${id}.json`)
  let svgCreated = false
  try {
    await writeNewFile(svgPath, svg)
    svgCreated = true
    await writeNewFile(metadataPath, JSON.stringify(record))
    return record
  } catch (error) {
    if (svgCreated) await fs.unlink(svgPath).catch(() => {})
    return filesystemError(error)
  }
}

export async function listAgentDrawings(root: string, canRead: (relativePath: string) => boolean = () => true): Promise<AgentDrawing[]> {
  const drawings = (await Promise.all([DIRECTORY, LEGACY_DIRECTORY].map(relativeDirectory => listDrawingsInDirectory(root, relativeDirectory, canRead)))).flat()
  return drawings.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

async function listDrawingsInDirectory(root: string, relativeDirectory: string, canRead: (relativePath: string) => boolean): Promise<AgentDrawing[]> {
  const directory = await drawingDirectory(root, false, relativeDirectory)
  if (!directory) return []
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const drawings: AgentDrawing[] = []
  // Read small metadata files only; pasted screenshots never need parsing for a history list.
  for (const entry of entries) {
    const id = entry.name.replace(/\.json$/, '')
    if (!entry.isFile() || !entry.name.endsWith('.json') || !ID.test(id) || !canRead(`${relativeDirectory}/${id}.svg`)) continue
    try {
      const record = drawingRecord(JSON.parse(await readRegularFile(path.join(directory, entry.name), 4096)), id, relativeDirectory)
      const stat = await fs.lstat(path.join(directory, `${id}.svg`))
      if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size === record.bytes) drawings.push(record)
    } catch { /* Incomplete or manually changed history entries do not hide other drawings. */ }
  }
  return drawings.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export async function readAgentDrawing(root: string, inputId: string, canRead: (relativePath: string) => boolean = () => true): Promise<AgentDrawing & { svg: string }> {
  const id = checkedId(inputId)
  for (const relativeDirectory of [DIRECTORY, LEGACY_DIRECTORY]) {
    try { return await readDrawingInDirectory(root, id, relativeDirectory, canRead) } catch (error) {
      if (!(error instanceof AgentDrawingError) || error.status !== 404) throw error
    }
  }
  throw new AgentDrawingError('저장된 그림을 찾을 수 없습니다', 404)
}

async function readDrawingInDirectory(root: string, id: string, relativeDirectory: string, canRead: (relativePath: string) => boolean): Promise<AgentDrawing & { svg: string }> {
  const directory = await drawingDirectory(root, false, relativeDirectory)
  if (!directory) throw new AgentDrawingError('저장된 그림을 찾을 수 없습니다', 404)
  if (!canRead(`${relativeDirectory}/${id}.svg`)) throw new AgentDrawingError('그림에 접근할 권한이 없습니다', 403)
  const record = drawingRecord(JSON.parse(await readRegularFile(path.join(directory, `${id}.json`), 4096)), id, relativeDirectory)
  const svg = await readRegularFile(path.join(directory, `${id}.svg`), MAX_DRAWING_BYTES)
  validateDrawingSvg(svg)
  return { ...record, bytes: Buffer.byteLength(svg), svg }
}

export function createAgentDrawingsRouter() {
  const router = express.Router()
  router.use(requireAuthenticated, requireFeature('agent'))
  router.use(express.json({ limit: MAX_DRAWING_BYTES + 1024 * 1024 }))
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store')
    const expected = req.method === 'POST' ? req.body?.projectRoot : req.query.projectRoot
    if (expected !== undefined && expected !== workspacePaths.root) { res.status(409).json({ error: '프로젝트가 변경되었습니다. 그림판을 다시 여세요.' }); return }
    const permission = req.method === 'POST' ? 'edit' : 'view'
    if (!fileAccess(authOf(req), WORKSPACE_PROJECT, DIRECTORY)[permission]) { res.status(403).json({ error: '그림 저장 폴더에 접근할 권한이 없습니다' }); return }
    next()
  })
  router.get('/', async (req, res, next) => {
    try {
      const projectRoot = workspacePaths.root
      const drawings = await listAgentDrawings(projectRoot, relativePath => fileAccess(authOf(req), WORKSPACE_PROJECT, relativePath).view)
      res.json({ drawings, projectRoot })
    } catch (error) { next(error) }
  })
  router.post('/', async (req, res, next) => {
    try { const projectRoot = workspacePaths.root; res.status(201).json({ ...await saveAgentDrawing(projectRoot, req.body?.svg, req.body?.name), projectRoot }) } catch (error) { next(error) }
  })
  router.get('/:id', async (req, res, next) => {
    try {
      const id = checkedId(String(req.params.id))
      const projectRoot = workspacePaths.root
      const drawing = await readAgentDrawing(projectRoot, id, relativePath => fileAccess(authOf(req), WORKSPACE_PROJECT, relativePath).view)
      res.json({ ...drawing, projectRoot })
    } catch (error) { next(error) }
  })
  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof AgentDrawingError) res.status(error.status).json({ error: error.message })
    else if ((error as { type?: string }).type === 'entity.too.large') res.status(413).json({ error: '그림은 32 MiB 이하로 저장하세요' })
    else if (error instanceof SyntaxError) res.status(400).json({ error: '그림 데이터를 읽을 수 없습니다' })
    else next(error)
  })
  return router
}
