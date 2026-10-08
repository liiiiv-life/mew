import express from 'express'
import multer from 'multer'
import { authOf, requireRole } from './reqAuth.ts'
import { MewpetSkinError, MewpetSkinStore } from './mewpet-skins.ts'
import { MEWPET_ANIMATIONS, MEWPET_MAX_FILE_BYTES, type MewpetAnimation } from '../shared/mewpet-skins.ts'

export function createMewpetSkinsRouter(store = new MewpetSkinStore()) {
  const router = express.Router()
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: MEWPET_ANIMATIONS.length, fileSize: MEWPET_MAX_FILE_BYTES, fields: 1, fieldSize: 64 * 1024, parts: MEWPET_ANIMATIONS.length + 1 } }).fields(MEWPET_ANIMATIONS.map(name => ({ name, maxCount: 1 })))
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); next() })
  router.get('/', (req, res) => { res.json({ ...store.list(), canManage: authOf(req).role === 'owner' }) })
  router.get('/:id/:action', (req, res) => {
    const action = MEWPET_ANIMATIONS.find(action => action === req.params.action)
    if (!action) throw new MewpetSkinError('SKIN_NOT_FOUND', 404)
    const image = store.image(req.params.id, action)
    res.type(image.mime).send(image.bytes)
  })
  router.put('/:id', requireRole('owner'), upload, (req, res) => {
    let manifest: { name: string; frames: Partial<Record<MewpetAnimation, number>> }
    try { manifest = JSON.parse(req.body.manifest) } catch { throw new MewpetSkinError('SKIN_MANIFEST_INVALID') }
    if (!manifest?.frames || typeof manifest.frames !== 'object') throw new MewpetSkinError('SKIN_MANIFEST_INVALID')
    const files = req.files as Record<string, Express.Multer.File[]> | undefined
    const sources = Object.fromEntries(MEWPET_ANIMATIONS.flatMap(action => files?.[action]?.[0] ? [[action, { bytes: files[action][0].buffer, frames: manifest.frames[action] }]] : []))
    if (typeof req.params.id !== 'string') throw new MewpetSkinError('SKIN_MANIFEST_INVALID')
    res.json(store.save(req.params.id, manifest.name, sources as Parameters<MewpetSkinStore['save']>[2]))
  })
  router.delete('/:id', requireRole('owner'), (req, res) => {
    if (typeof req.params.id !== 'string') throw new MewpetSkinError('SKIN_NOT_FOUND', 404)
    store.delete(req.params.id); res.sendStatus(204)
  })
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof MewpetSkinError ? error.status : error instanceof multer.MulterError ? 400 : 500
    res.status(status).json({ error: error instanceof MewpetSkinError ? error.message : error instanceof multer.MulterError ? 'SKIN_FILE_LIMIT' : 'SKIN_STORAGE_FAILED' })
  })
  return router
}
