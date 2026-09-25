import express from 'express'
import fs from 'node:fs'
import { authOf, requireFeature } from './reqAuth.ts'
import { readSets } from './agentSets.ts'
import { projectRoot, WORKSPACE_ROOT } from './paths.ts'
import { GitAiCommitError, GitAiCommitStore } from './git-ai-commit.ts'

export function createGitAiCommitRouter(store: GitAiCommitStore) {
  const router = express.Router()
  router.use(requireFeature('git'), requireFeature('agent'))
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  const scope = (req: express.Request) => {
    if (req.query.workspace !== WORKSPACE_ROOT) throw new GitAiCommitError('프로젝트가 변경되었습니다. 현재 프로젝트에서 다시 시도하세요.')
    if (typeof req.query.project !== 'string') throw new GitAiCommitError('프로젝트를 지정하세요')
    return { owner: authOf(req).email!, cwd: fs.realpathSync(projectRoot(req.query.project)) }
  }
  router.get('/', async (req, res, next) => {
    try { const { owner, cwd } = scope(req); res.json({ job: await store.latest(owner, cwd) }) } catch (error) { next(error) }
  })
  router.post('/', async (req, res, next) => {
    try {
      const { owner, cwd } = scope(req)
      if (!Array.isArray(req.body?.files) || !req.body.files.length) throw new GitAiCommitError('커밋할 파일을 선택하세요')
      const set = readSets().find(item => item.id === req.body?.agentSetId)
      if (!set) throw new GitAiCommitError('에이전트셋을 선택하세요')
      res.status(202).json({ job: await store.start(owner, cwd, req.body?.id, set, req.body?.files) })
    } catch (error) { next(error) }
  })
  router.post('/:id/stop', (req, res, next) => {
    try { const { owner, cwd } = scope(req); store.stop(owner, cwd, String(req.params.id)); res.json({ ok: true }) } catch (error) { next(error) }
  })
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof GitAiCommitError ? 400 : 500).json({ error: error instanceof Error ? error.message : '자동 커밋에 실패했습니다' })
  })
  return router
}
