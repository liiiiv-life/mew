import express from 'express'
import { FeatureError } from './features.ts'
import { FeatureService } from './feature-service.ts'
import { authOf, requireFeature } from './reqAuth.ts'
import { canUse, unrestrictedWorkspaceFiles } from './access-policy.ts'
import { BranchFeatureError, readBranchFeatures, updateBranchFeature } from './branch-features.ts'
import { workspacePaths } from './paths.ts'
import { readSets } from './agentSets.ts'
import { captureAgentContext } from './agent-context.ts'
import type { FeatureRequest } from '../shared/features.ts'

let sharedService: FeatureService | undefined
function service() { if (!sharedService) { sharedService = new FeatureService(); sharedService.start() }; return sharedService }

export async function readFeatureSnapshot(auth: import('./reqAuth.ts').RequestAuth, executor = service()) {
  const workspace = workspacePaths.root, canEdit = unrestrictedWorkspaceFiles(auth, workspace, true)
  if (canEdit) await executor.store.prepare(workspace)
  return { ...executor.store.read(workspace), canEdit }
}

export function createFeatureRouter(executor = service()) {
  const router = express.Router()
  router.use(requireFeature('agent'))
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    const workspace = req.method === 'GET' ? req.query.workspace : req.body?.workspace
    if (workspace !== workspacePaths.root) { res.status(409).json({ error: '프로젝트가 변경되었습니다. 현재 프로젝트에서 다시 열어 주세요.' }); return }
    if (!unrestrictedWorkspaceFiles(authOf(req), workspacePaths.root, req.method !== 'GET')) { res.status(403).json({ error: '이 프로젝트 전체에 대한 파일 권한이 필요합니다.' }); return }
    next()
  })
  router.get('/', async (req, res, next) => {
    try {
      res.json(await readFeatureSnapshot(authOf(req), executor))
    } catch (error) { next(error) }
  })
  router.get('/branches', requireFeature('git'), async (req, res, next) => {
    try {
      const auth = authOf(req)
      res.json(await readBranchFeatures(workspacePaths.root, { canEdit: unrestrictedWorkspaceFiles(auth, workspacePaths.root, true), canPreview: canUse(auth, 'portPreview') }))
    } catch (error) { next(error) }
  })
  router.patch('/branches', requireFeature('git'), async (req, res, next) => {
    try {
      const auth = authOf(req)
      await updateBranchFeature(workspacePaths.root, req.body)
      res.json(await readBranchFeatures(workspacePaths.root, { canEdit: true, canPreview: canUse(auth, 'portPreview') }))
    } catch (error) { next(error) }
  })
  router.post('/requests', async (req, res, next) => {
    try {
      const input = req.body as FeatureRequest, set = readSets().find(item => item.id === input.agentSetId)
      if (!set) throw new FeatureError('에이전트셋을 선택하세요')
      const workspace = workspacePaths.root
      const run = await executor.store.request(workspace, authOf(req).email!, input, set, captureAgentContext(workspace))
      void executor.pump(workspace).catch(error => console.error('[mew:features]', error.message))
      res.status(202).json({ run })
    } catch (error) { next(error) }
  })
  router.patch('/:id', async (req, res, next) => {
    try { res.json({ feature: await executor.store.edit(workspacePaths.root, String(req.params.id), req.body) }) } catch (error) { next(error) }
  })
  router.post('/:id/status', async (req, res, next) => {
    try { res.json({ feature: await executor.store.judge(workspacePaths.root, String(req.params.id), req.body.version, req.body.status) }) } catch (error) { next(error) }
  })
  router.post('/runs/:id/cancel', async (req, res, next) => {
    try { await executor.cancel(workspacePaths.root, String(req.params.id)); res.json({ ok: true }) } catch (error) { next(error) }
  })
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const known = error instanceof FeatureError || error instanceof BranchFeatureError
    res.status(known ? error.status : 500).json({ error: known ? error.message : '기능 정보를 저장하지 못했습니다. 다시 시도해 주세요.' })
  })
  return router
}
