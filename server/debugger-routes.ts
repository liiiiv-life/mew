import express from 'express'
import { authOf, requireFeature, requireRole } from './reqAuth.ts'
import { unrestrictedFiles } from './access-policy.ts'
import { installJsDebug, jsDebugInstalled, JS_DEBUG_VERSION } from './debugger-install.ts'
import { WORKSPACE_PROJECT, workspacePaths } from './paths.ts'
import { debugConfig, debugSession, debugSessions, idleDebugSnapshot, newDebugSession, saveDebugConfig, selectDebugSession, startDebugCompound } from './debugger.ts'
import { importDebugProfiles, testDebugProfile } from './debugger-profiles.ts'
import { debuggableDomPage, debuggableDomTabs } from './browser-dom.ts'
import { browserInspection, connectBrowserInspection } from './debugger-browser.ts'

export function createDebuggerRouter() {
  const router = express.Router()
  router.use(requireRole('owner', 'manager'), requireFeature('terminal'))
  router.use((req, res, next) => {
    if (!authOf(req).email || !unrestrictedFiles(authOf(req), WORKSPACE_PROJECT, true)) { res.status(403).json({ error: '디버거는 전체 파일 접근 권한이 필요합니다' }); return }
    if (req.headers['x-mew-debug-workspace'] !== encodeURIComponent(workspacePaths.root)) { res.status(409).json({ error: '프로젝트가 변경되었습니다. 디버거를 다시 여세요.' }); return }
    next()
  })
  router.get('/', async (req, res) => {
    try { const session = debugSession(authOf(req).email!, workspacePaths.root); const config = debugConfig(authOf(req).email!, workspacePaths.root); if (session && ['starting', 'running', 'stopped'].includes(session.snapshot.state)) { config.dataBreakpoints = session.config.dataBreakpoints }; res.json({ adapter: { installed: await jsDebugInstalled(), version: JS_DEBUG_VERSION }, config, session: session?.snapshot ?? idleDebugSnapshot(), sessions: debugSessions(authOf(req).email!, workspacePaths.root).map(s => ({ id: s.snapshot.id, state: s.snapshot.state, name: s.profile || s.config.kind })) }) }
    catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : '디버거 상태 조회 실패' }) }
  })
  router.put('/config', async (req, res) => {
    try { res.json(await saveDebugConfig(authOf(req).email!, workspacePaths.root, req.body)) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '설정 저장 실패' }) }
  })
  router.post('/install', async (req, res) => {
    try {
      const email = authOf(req).email!, root = workspacePaths.root
      if (debugSessions(email, root).some(s => ['starting', 'running', 'stopped'].includes(s.snapshot.state))) throw new Error('디버그 세션을 종료한 뒤 설치하세요')
      const entry = await installJsDebug()
      const config = debugConfig(email, root)
      res.json(await saveDebugConfig(email, root, { ...config, kind: 'js-debug', transport: 'tcp', command: process.execPath, args: [entry, '0', '127.0.0.1'], port: 0 }))
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '디버거 설치 실패' }) }
  })
  router.post('/start', async (req, res) => {
    try { if (req.body?.profile !== undefined && typeof req.body.profile !== 'string' || req.body?.additional !== undefined && typeof req.body.additional !== 'boolean') throw new Error('잘못된 실행 프로필'); const session = newDebugSession(authOf(req).email!, workspacePaths.root, req.body?.profile, req.body?.additional === true); await session.start(); res.json(session.snapshot) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '디버거 시작 실패' }) }
  })
  router.post('/profiles/import', async (req, res) => {
    try { res.json(await importDebugProfiles(workspacePaths.root, req.body?.file)) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '프로필 가져오기 실패' }) }
  })
  router.post('/bridge', async (req, res) => {
    try {
      if (typeof req.body?.enabled !== 'boolean') throw new Error('잘못된 에이전트 디버거 설정')
      const email = authOf(req).email!, config = debugConfig(email, workspacePaths.root), session = debugSession(email, workspacePaths.root)
      if (session && ['starting', 'running', 'stopped'].includes(session.snapshot.state)) config.dataBreakpoints = session.config.dataBreakpoints
      res.json(await saveDebugConfig(email, workspacePaths.root, { ...config, agentBridge: req.body.enabled }))
    }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '에이전트 디버거 설정 실패' }) }
  })
  router.post('/profiles/test', (req, res) => {
    try { res.json(testDebugProfile(workspacePaths.root, req.body?.runner, req.body?.file, req.body?.name)) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '테스트 설정 생성 실패' }) }
  })
  router.post('/test', async (req, res) => {
    try { const session = newDebugSession(authOf(req).email!, workspacePaths.root); await session.start(true); res.json({ ok: true }) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '연결 테스트 실패' }) }
  })
  router.post('/compound', async (req, res) => {
    try { if (typeof req.body?.name !== 'string') throw new Error('복합 실행 프로필을 선택하세요'); res.json(await startDebugCompound(authOf(req).email!, workspacePaths.root, req.body.name)) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '복합 실행 실패' }) }
  })
  router.post('/select', (req, res) => {
    try { if (typeof req.body?.sessionId !== 'string') throw new Error('세션을 선택하세요'); res.json(selectDebugSession(authOf(req).email!, workspacePaths.root, req.body.sessionId).snapshot) }
    catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : '디버그 세션이 변경되었습니다' }) }
  })
  router.post('/stop', async (req, res) => {
    const session = typeof req.body?.sessionId === 'string' ? debugSession(authOf(req).email!, workspacePaths.root, req.body.sessionId) : undefined
    if (!session) { res.status(409).json({ error: '디버그 세션이 변경되었습니다' }); return }
    await session?.stop(); res.json({ ok: true })
  })
  router.post('/command', async (req, res) => {
    try {
      const session = typeof req.body?.sessionId === 'string' ? debugSession(authOf(req).email!, workspacePaths.root, req.body.sessionId) : undefined
      if (!session || req.body?.sessionId !== session.snapshot.id) { res.status(409).json({ error: '디버그 세션이 변경되었습니다' }); return }
      const args = req.body.arguments ?? {}
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('잘못된 명령 인수')
      res.json(await session.command(req.body.command, args))
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '디버거 명령 실패' }) }
  })
  router.use('/browser', requireFeature('browser'))
  router.get('/browser', (req, res) => res.json({ tabs: debuggableDomTabs(authOf(req).email!), session: browserInspection(authOf(req).email!, workspacePaths.root)?.snapshot() ?? null }))
  router.post('/browser/connect', async (req, res) => {
    try { if (typeof req.body?.tab !== 'string') throw new Error('브라우저 탭을 선택하세요'); const session = await connectBrowserInspection(authOf(req).email!, workspacePaths.root, debuggableDomPage(authOf(req).email!, req.body.tab)); res.json(session.snapshot()) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '브라우저 분석 연결 실패' }) }
  })
  router.post('/browser/command', async (req, res) => {
    try {
      const session = browserInspection(authOf(req).email!, workspacePaths.root)
      if (!session || session.id !== req.body?.sessionId) { res.status(409).json({ error: '브라우저 분석 연결이 변경되었습니다' }); return }
      if (!req.body.arguments || typeof req.body.arguments !== 'object' || Array.isArray(req.body.arguments)) throw new Error('잘못된 브라우저 명령 인수')
      res.json(await session.command(req.body.command, req.body.arguments))
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '브라우저 분석 실패' }) }
  })
  router.post('/browser/close', async (req, res) => {
    const session = browserInspection(authOf(req).email!, workspacePaths.root)
    if (session && session.id !== req.body?.sessionId) { res.status(409).json({ error: '브라우저 분석 연결이 변경되었습니다' }); return }
    await session?.close(); res.json({ ok: true })
  })
  return router
}
