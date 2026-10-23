import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import type { AgentCommandScope } from '../shared/agent-command.ts'
import { authOf, requireFeature } from './reqAuth.ts'
import { AgentCommandError, AgentCommandStore, publicCommand } from './agent-commands.ts'
import { AgentCwdError, resolveAgentCwd } from './agentCwd.ts'
import { isAcpRuntime } from './agentAcp.ts'
import { queueCommandInHost } from './agentHost.ts'

export function createAgentCommandRouter(store: AgentCommandStore) {
  const router = express.Router()
  router.use(requireFeature('agent'), requireFeature('terminal'))
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/', async (req, res, next) => {
    try {
      const scope = { runtime: req.query.runtime, cwd: req.query.cwd, sessionId: req.query.sessionId } as AgentCommandScope
      res.json({ commands: await store.list(authOf(req).email!, scope) })
    } catch (error) { next(error) }
  })
  router.post('/', async (req, res, next) => {
    try {
      const { id, tab, command, afterUserCount, runtime, sessionId, cwd: inputCwd } = req.body ?? {}
      if (!isAcpRuntime(runtime)) throw new AgentCommandError('채팅형 에이전트 대화가 아닙니다')
      const cwd = resolveAgentCwd(inputCwd, store.manager.cwd)
      res.json({ command: await queueCommandInHost(authOf(req).email!, { id, tab, command, afterUserCount, runtime, sessionId, cwd }) })
    } catch (error) { next(error) }
  })
  router.post('/stop-tab/:tab', async (req, res, next) => {
    try { await store.stopTab(authOf(req).email!, String(req.params.tab)); res.json({ ok: true }) } catch (error) { next(error) }
  })
  router.post('/:id/stop', (req, res, next) => {
    try { store.stop(authOf(req).email!, String(req.params.id)); res.json({ ok: true }) } catch (error) { next(error) }
  })
  router.get('/:id/output', (req, res, next) => {
    try {
      const owner = authOf(req).email!, id = String(req.params.id)
      const record = store.read(owner, id)
      if (record.state === 'running' || record.state === 'queued') { res.status(409).json({ error: '아직 실행이 끝나지 않았습니다' }); return }
      const file = path.join(store.directory(owner, id), 'preview.txt')
      res.json({ command: publicCommand(record), text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' })
    } catch (error) { next(error) }
  })
  router.get('/:id/archive', (req, res, next) => {
    try {
      const owner = authOf(req).email!, id = String(req.params.id)
      const record = store.read(owner, id)
      if (!record.archived) { res.status(404).json({ error: '저장된 출력이 없습니다' }); return }
      res.download(path.join(store.directory(owner, id), 'output.gz'), `command-${id}.log.gz`)
    } catch (error) { next(error) }
  })
  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof AgentCommandError || error instanceof AgentCwdError) res.status(400).json({ error: error.message })
    else next(error)
  })
  return router
}
