import fs from 'node:fs'
import { taskDirectory } from './task-markdown.ts'
import { taskListFile } from './task-list.ts'
import { readJsonFile } from './dataDir.ts'
import express from 'express'
import { authOf, requireAuthenticated } from './reqAuth.ts'
import { unrestrictedFiles } from './access-policy.ts'
import { WORKSPACE_PROJECT, WORKSPACE_ROOT } from './paths.ts'
import { changeTaskList, readTaskList, readTaskTags, TaskInputError } from './task-list.ts'
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
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()
    let watcher: fs.FSWatcher | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const send = () => {
      if (req.query.workspace !== WORKSPACE_ROOT || !unrestrictedFiles(authOf(req), WORKSPACE_PROJECT, false)) { res.end(); return }
      res.write('data: changed\n\n')
    }
    const notify = () => { clearTimeout(timer); timer = setTimeout(send, 75) }
    const attach = () => {
      watcher?.close(); watcher = undefined
      try { watcher = fs.watch(taskDirectory(WORKSPACE_ROOT), notify); watcher.on('error', () => { watcher?.close(); watcher = undefined; notify() }) } catch { /* The task directory is created on the first save. */ }
    }
    const root = WORKSPACE_ROOT
    let rootWatcher: fs.FSWatcher | undefined
    try { rootWatcher = fs.watch(root, (_event, name) => { if (name?.toString() === 'tasks') { attach(); notify() } }); rootWatcher.on('error', () => res.end()) } catch { res.end(); return }
    attach(); send()
    const heartbeat = setInterval(() => { if (root !== WORKSPACE_ROOT) res.end(); else res.write(': keepalive\n\n') }, 15_000)
    res.on('close', () => { clearTimeout(timer); clearInterval(heartbeat); watcher?.close(); rootWatcher?.close() })
  })
  router.get('/', (req, res) => {
    try {
      const legacy = readJsonFile<{ version: number }>(taskListFile(WORKSPACE_ROOT))
      if (legacy && legacy.version < 3 && unrestrictedFiles(authOf(req), WORKSPACE_PROJECT, true)) changeTaskList(WORKSPACE_ROOT, [])
      res.json({ tasks: readTaskList(WORKSPACE_ROOT), tags: readTaskTags(WORKSPACE_ROOT), canEdit: unrestrictedFiles(authOf(req), WORKSPACE_PROJECT, true) }) }
    catch { res.status(500).json({ error: '태스크를 불러오지 못했습니다' }) }
  })
  router.patch('/', (req, res) => {
    try { res.json({ tasks: changeTaskList(WORKSPACE_ROOT, req.body?.changes), tags: readTaskTags(WORKSPACE_ROOT), canEdit: true }) }
    catch (error) {
      const status = error instanceof TaskConflict ? 409 : error instanceof TaskInputError ? 400 : 500
      res.status(status).json({ error: status === 500 ? '태스크를 저장하지 못했습니다' : (error as Error).message })
    }
  })
  return router
}
