import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import express from 'express'

const MAX_PDF_BYTES = 100 * 1024 * 1024
const writes = new Map<string, Promise<unknown>>()

export class PdfError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

/** Includes inode and nanosecond change time, so equal-size replacements are different revisions. */
export function pdfRevision(file: string): string {
  const stat = fs.statSync(file, { bigint: true })
  if (!stat.isFile() || path.extname(file).toLowerCase() !== '.pdf') throw new PdfError(400, 'PDF file required')
  return `"${stat.dev.toString(16)}-${stat.ino.toString(16)}-${stat.size.toString(16)}-${stat.mtimeNs.toString(16)}-${stat.ctimeNs.toString(16)}"`
}

export async function replacePdf(file: string, expected: string, bytes: Buffer): Promise<string> {
  if (!expected) throw new PdfError(428, 'PDF revision required')
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_PDF_BYTES || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) {
    throw new PdfError(400, 'Invalid PDF or PDF exceeds 100 MiB')
  }
  // Resolve aliases before locking; a symlink remains a symlink after saving.
  file = fs.realpathSync(file)
  const previous = writes.get(file) ?? Promise.resolve()
  const operation = previous.catch(() => {}).then(async () => {
    if (pdfRevision(file) !== expected) throw new PdfError(409, 'PDF changed on disk')
    const stat = fs.statSync(file)
    const temp = path.join(path.dirname(file), `.mew-pdf-${randomUUID()}.tmp`)
    try {
      const handle = await fs.promises.open(temp, 'wx', stat.mode & 0o777)
      try { await handle.chmod(stat.mode & 0o777); await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      // Recheck after the asynchronous write; never replace a newer application save.
      if (pdfRevision(file) !== expected) throw new PdfError(409, 'PDF changed on disk')
      fs.renameSync(temp, file)
      return pdfRevision(file)
    } finally { await fs.promises.rm(temp, { force: true }) }
  })
  writes.set(file, operation)
  try { return await operation } finally { if (writes.get(file) === operation) writes.delete(file) }
}

type Target = { file: string; editable: boolean; saved?: () => void }

export function registerPdfRoutes(app: express.Express, resolve: (req: express.Request, res: express.Response, write: boolean) => Target | null) {
  function failure(res: express.Response, error: unknown) {
    if (res.headersSent) return
    const status = error instanceof PdfError ? error.status : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500
    res.status(status).json({ error: error instanceof PdfError ? error.message : 'PDF operation failed' })
  }
  app.get(['/pdf', '/fs/pdf'], (req, res) => {
    try {
      const target = resolve(req, res, false)
      if (!target) return
      const revision = pdfRevision(target.file)
      if (req.query.revision && req.query.revision !== revision) throw new PdfError(409, 'PDF changed on disk')
      res.set({ ETag: revision, 'X-Mew-Pdf-Revision': revision, 'X-Mew-Pdf-Editable': String(target.editable), 'Cache-Control': 'private, no-cache' })
      res.sendFile(target.file, { dotfiles: 'allow', etag: false, lastModified: false }, error => { if (error) failure(res, error) })
    } catch (error) { failure(res, error) }
  })
  // Authorize BEFORE buffering an upload. The JSON parser does not consume application/pdf.
  app.put(['/pdf', '/fs/pdf'], (req, res, next) => {
    try {
      const target = resolve(req, res, true)
      if (!target) return
      if (!target.editable) throw new PdfError(403, 'PDF is read-only')
      next()
    } catch (error) { failure(res, error) }
  }, express.raw({ type: 'application/pdf', limit: MAX_PDF_BYTES }), async (req, res) => {
    try {
      // Reauthorize after upload: permissions may have changed while the body was arriving.
      const target = resolve(req, res, true)
      if (!target) return
      if (!target.editable) throw new PdfError(403, 'PDF is read-only')
      const revision = await replacePdf(target.file, req.get('If-Match') ?? '', req.body)
      target.saved?.()
      res.json({ revision })
    } catch (error) { failure(res, error) }
  })
}
