import express from 'express'
import { authOf, requireFeature, requireRole } from './reqAuth.ts'
import { unrestrictedFiles } from './access-policy.ts'
import { installJsDebug, jsDebugInstalled, JS_DEBUG_VERSION } from './debugger-install.ts'
import { WORKSPACE_PROJECT, workspacePaths } from './paths.ts'
import { debugConfig, debugSession, idleDebugSnapshot, newDebugSession, saveDebugConfig } from './debugger.ts'

export function createDebuggerRouter() {
  const router = express.Router()
  router.use(requireRole('owner', 'manager'), requireFeature('terminal'))
  router.use((req, res, next) => {
    if (!authOf(req).email || !unrestrictedFiles(authOf(req), WORKSPACE_PROJECT, true)) { res.status(403).json({ error: '디버거는 전체 파일 접근 권한이 필요합니다' }); return }
    if (req.headers['x-mew-debug-workspace'] !== encodeURIComponent(workspacePaths.root)) { res.status(409).json({ error: '프로젝트가 변경되었습니다. 디버거를 다시 여세요.' }); return }
    next()
  })
  router.get('/', async (req, res) => {
    try { res.json({ adapter: { installed: await jsDebugInstalled(), version: JS_DEBUG_VERSION }, config: debugConfig(authOf(req).email!, workspacePaths.root), session: debugSession(authOf(req).email!, workspacePaths.root)?.snapshot ?? idleDebugSnapshot() }) }
    catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : '디버거 상태 조회 실패' }) }
  })
  router.put('/config', async (req, res) => {
    try { res.json(await saveDebugConfig(authOf(req).email!, workspacePaths.root, req.body)) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '설정 저장 실패' }) }
  })
  router.post('/install', async (req, res) => {
    try {
      const email = authOf(req).email!, root = workspacePaths.root
      const previous = debugSession(email, root)
      if (previous && ['starting', 'running', 'stopped'].includes(previous.snapshot.state)) throw new Error('디버그 세션을 종료한 뒤 설치하세요')
      const entry = await installJsDebug()
      const config = debugConfig(email, root)
      res.json(await saveDebugConfig(email, root, { ...config, kind: 'js-debug', transport: 'tcp', command: process.execPath, args: [entry, '0', '127.0.0.1'], port: 0 }))
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '디버거 설치 실패' }) }
  })
  router.post('/start', async (req, res) => {
    try { const session = newDebugSession(authOf(req).email!, workspacePaths.root); await session.start(); res.json(session.snapshot) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '디버거 시작 실패' }) }
  })
  router.post('/test', async (req, res) => {
    try { const session = newDebugSession(authOf(req).email!, workspacePaths.root); await session.start(true); res.json({ ok: true }) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '연결 테스트 실패' }) }
  })
  router.post('/stop', async (req, res) => {
    const session = debugSession(authOf(req).email!, workspacePaths.root)
    if (session && req.body?.sessionId !== session.snapshot.id) { res.status(409).json({ error: '디버그 세션이 변경되었습니다' }); return }
    await session?.stop(); res.json({ ok: true })
  })
  router.post('/command', async (req, res) => {
    try {
      const session = debugSession(authOf(req).email!, workspacePaths.root)
      if (!session || req.body?.sessionId !== session.snapshot.id) { res.status(409).json({ error: '디버그 세션이 변경되었습니다' }); return }
      const args = req.body.arguments ?? {}
      if (typeof args !== 'object' || Array.isArray(args)) throw new Error('잘못된 명령 인수')
      res.json(await session.command(req.body.command, args))
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '디버거 명령 실패' }) }
  })
  return router
}
