import express from 'express'
import { authOf, requireRole } from './reqAuth.ts'
import { unrestrictedWorkspaceFiles } from './access-policy.ts'
import { WORKSPACE_ROOT } from './paths.ts'
import { ProjectTaskStore, TaskBoardError } from './project-tasks.ts'

export function createProjectTaskRouter(store = new ProjectTaskStore()) {
  const router = express.Router()
  router.use(requireRole('owner', 'manager', 'member'))
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    const workspace = req.method === 'GET' ? req.query.workspace : req.body?.workspace
    if (workspace !== WORKSPACE_ROOT) { res.status(409).json({ error: '프로젝트가 변경되었습니다. 패널을 다시 열어 주세요.' }); return }
    if (!unrestrictedWorkspaceFiles(authOf(req), WORKSPACE_ROOT, req.method !== 'GET')) { res.status(403).json({ error: '프로젝트 전체에 대한 파일 권한이 필요합니다.' }); return }
    next()
  })
  router.get('/', (_req, res, next) => {
    try { res.json({ ...store.read(WORKSPACE_ROOT), canEdit: unrestrictedWorkspaceFiles(authOf(_req), WORKSPACE_ROOT, true) }) } catch (error) { next(error) }
  })
  router.put('/', (req, res, next) => {
    try { res.json({ ...store.save(WORKSPACE_ROOT, req.body.board), canEdit: true }) } catch (error) { next(error) }
  })
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof TaskBoardError ? error.status : 500).json({ error: error instanceof TaskBoardError ? error.message : '태스크 정보를 읽거나 저장하지 못했습니다. 다시 시도하세요.' })
  })
  return router
}
