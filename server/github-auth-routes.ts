import express from 'express'
import { authOf, requireAuthenticated, requireAnyFeature, requireFeature } from './reqAuth.ts'
import { closeDomBrowserJob, createDomBrowserAuthSession } from './browser-dom.ts'
import { GITHUB_DEVICE_URL, GitHubAuth, GitHubAuthError } from './github-auth.ts'

const auth = new GitHubAuth(closeDomBrowserJob)

export function createGitHubAuthRouter(store = auth) {
  const router = express.Router()
  router.use(requireAuthenticated, requireAnyFeature('git', 'filesWrite'))
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })
  router.get('/', async (req, res, next) => {
    try { res.json(await store.status(authOf(req).email!)) } catch (error) { next(error) }
  })
  router.post('/', (req, res, next) => {
    try { res.status(202).json({ job: store.start(authOf(req).email!) }) } catch (error) { next(error) }
  })
  router.delete('/', (req, res, next) => {
    try { store.disconnect(authOf(req).email!); res.json({ ok: true }) } catch (error) { next(error) }
  })
  router.post('/:id/stop', (req, res, next) => {
    try { store.stop(authOf(req).email!, String(req.params.id)); res.json({ ok: true }) } catch (error) { next(error) }
  })
  router.post('/:id/browser', requireFeature('browser'), async (req, res, next) => {
    const owner = authOf(req).email!, id = String(req.params.id)
    try {
      const job = store.browserJob(owner, id)
      const streamUrl = await createDomBrowserAuthSession(owner, job, GITHUB_DEVICE_URL)
      // Approval or cancellation can finish while the browser is being prepared.
      try { store.browserJob(owner, id) } catch (error) { await closeDomBrowserJob(owner, job); throw error }
      res.json({ streamUrl })
    } catch (error) { next(error) }
  })
  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof GitHubAuthError ? error.status : 500).json({ error: error instanceof GitHubAuthError ? error.message : 'GitHub 연결을 확인하지 못했습니다. 다시 시도하세요.' })
  })
  return router
}
