import express from 'express'
import { AgentHarnessStore, HarnessError } from './agent-harness.ts'
import { requireFeature } from './reqAuth.ts'
import type { HarnessKind } from '../shared/agent-harness.ts'

function scope(value: unknown, kind: unknown): { cwd: string; kind: HarnessKind } {
  if (typeof value !== 'string' || !value.trim() || !['skills', 'mcp'].includes(String(kind))) throw new HarnessError('작업 폴더와 종류를 확인하세요')
  return { cwd: value, kind: kind as HarnessKind }
}
export function createAgentHarnessRouter(store = new AgentHarnessStore()) {
  const router = express.Router()
  router.use(requireFeature('agent'))
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/', async (req, res, next) => {
    try { const input = scope(req.query.cwd, req.query.kind); res.json(await store.list(input.cwd, input.kind)) } catch (error) { next(error) }
  })
  router.get('/detail', async (req, res, next) => {
    try {
      const input = scope(req.query.cwd, req.query.kind)
      if (typeof req.query.id !== 'string') throw new HarnessError('항목을 선택하세요')
      res.json(await store.detail(input.cwd, input.kind, req.query.id))
    } catch (error) { next(error) }
  })
  router.post('/', async (req, res, next) => {
    try { const input = scope(req.body?.cwd, req.body?.kind); await store.mutate({ ...req.body, ...input }); res.json({ ok: true }) } catch (error) { next(error) }
  })
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HarnessError) res.status(error.status).json({ error: error.message })
    else res.status(400).json({ error: '파일 권한 또는 설정 형식을 확인한 뒤 다시 시도하세요' })
  })
  return router
}
