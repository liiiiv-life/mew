import express from 'express'
import { TmuxError, type TmuxManager } from './tmux.ts'

function handleError(res: express.Response, err: unknown) {
  if (err instanceof TmuxError) {
    res.status(400).json({ error: err.message })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal error' })
}

/** tmux 세션 CRUD 라우터 — 호스트 앱이 (인증 뒤에) /tmux 아래로 마운트한다 */
export function createTmuxRouter(manager: TmuxManager): express.Router {
  const router = express.Router()

  router.get('/sessions', async (_req, res) => {
    try {
      res.json(await manager.list())
    } catch (err) {
      handleError(res, err)
    }
  })

  router.post('/sessions', async (req, res) => {
    const { name } = req.body as { name: string }
    try {
      await manager.create(name)
      res.json({ ok: true, name })
    } catch (err) {
      handleError(res, err)
    }
  })

  router.delete('/sessions/:name', async (req, res) => {
    try {
      await manager.kill(req.params.name)
      res.json({ ok: true })
    } catch (err) {
      handleError(res, err)
    }
  })

  router.post('/sessions/:name/rename', async (req, res) => {
    const { newName } = req.body as { newName: string }
    try {
      await manager.rename(req.params.name, newName)
      res.json({ ok: true, name: newName })
    } catch (err) {
      handleError(res, err)
    }
  })

  return router
}
