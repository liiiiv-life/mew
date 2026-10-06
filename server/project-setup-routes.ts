import express from 'express'
import { requireRole } from './reqAuth.ts'
import { workspacePaths } from './paths.ts'
import { switchDocsRoot } from './workspace.ts'
import { broadcast } from './presence.ts'
import { resetTreeWatchers } from './watcher.ts'
import { applyProjectSetup, defaultAgentSettings, planProjectSetup, readProjectAgentSettings } from './project-setup.ts'

export function createProjectSetupRouter() {
  const router = express.Router()
  router.use(requireRole('owner'))
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/', (_req, res) => {
    try { res.json({ projectRoot: workspacePaths.root, settings: readProjectAgentSettings(workspacePaths.root) ?? defaultAgentSettings(workspacePaths.docsDir) }) }
    catch (error) { res.status(400).json({ error: (error as Error).message }) }
  })
  router.post('/', (req, res) => {
    if (req.body?.projectRoot !== workspacePaths.root) {
      res.status(409).json({ error: '프로젝트가 변경되었습니다. 설정 창을 다시 여세요.' }); return
    }
    if (!['preview', 'apply'].includes(req.body?.action)) {
      res.status(400).json({ error: '미리보기 또는 적용을 선택하세요' }); return
    }
    try {
      const input = { projectRoot: workspacePaths.root, settings: req.body.settings, initDocs: req.body.initDocs === true, exportAgents: req.body.exportAgents === true }
      const plan = req.body.action === 'apply' ? applyProjectSetup(input, req.body.revision) : planProjectSetup(input)
      if (req.body.action === 'apply') {
        switchDocsRoot(`${plan.projectRoot}/${plan.settings.docsDir}`)
        resetTreeWatchers()
        broadcast({ type: 'tree' })
      }
      res.json(plan)
    } catch (error) { res.status(400).json({ error: (error as Error).message }) }
  })
  return router
}
