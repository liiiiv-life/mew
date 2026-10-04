import express from 'express'
import { authOf, requireAuthenticated } from './reqAuth.ts'
import { unrestrictedFiles } from './access-policy.ts'
import { WORKSPACE_PROJECT, WORKSPACE_ROOT } from './paths.ts'
import { changeTaskList, readTaskList, TaskInputError } from './task-list.ts'
import { TaskConflict } from '../shared/task-list.ts'

export function createTaskListRouter() {
  const router = express.Router()
  router.use(requireAuthenticated)
  router.use((req, res, next) => {
    const workspace = req.method === 'GET' ? req.query.workspace : req.body?.workspace
    if (req.headers['x-mew-task-owner'] !== encodeURIComponent(authOf(req).email ?? '')) { res.status(409).json({ error: '계정이 변경되었습니다. 태스크 패널을 다시 여세요.' }); return }
    if (workspace !== WORKSPACE_ROOT) { res.status(409).json({ error: '프로젝트가 변경되었습니다. 태스크 패널을 다시 여세요.' }); return }
    if (!unrestrictedFiles(authOf(req), WORKSPACE_PROJECT, req.method !== 'GET')) { res.status(403).json({ error: '권한이 없습니다' }); return }
    next()
  })
  router.get('/', (req, res) => {
    try { res.json({ tasks: readTaskList(WORKSPACE_ROOT), canEdit: unrestrictedFiles(authOf(req), WORKSPACE_PROJECT, true) }) }
    catch { res.status(500).json({ error: '태스크를 불러오지 못했습니다' }) }
  })
  router.patch('/', (req, res) => {
    try { res.json({ tasks: changeTaskList(WORKSPACE_ROOT, req.body?.changes), canEdit: true }) }
    catch (error) {
      const status = error instanceof TaskConflict ? 409 : error instanceof TaskInputError ? 400 : 500
      res.status(status).json({ error: status === 500 ? '태스크를 저장하지 못했습니다' : (error as Error).message })
    }
  })
  return router
}
