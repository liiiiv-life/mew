import { defaultDebugConfig, type DebugConfig, type DebugSnapshot, type DebugVariable } from '../../shared/debugger.ts'
import type { DebuggerStatus } from '../api/debugger.ts'
import { demoJson, requireMethod, stringField, type DemoHttpHandler } from './http.ts'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'

export function demoDebuggerStatus(store: DemoWorkspaceStore, root = store.workspaceInfo().path): DebuggerStatus {
  const config = { ...defaultDebugConfig('js-debug', root), configuration: { program: `${root}/src/main.tsx`, cwd: root }, watches: ['demo', 'step'] }
  const session: DebugSnapshot = {
    id: 'demo-debugger', state: 'stopped', reason: 'Demo · 로컬 시뮬레이션', stopRevision: 1, threadId: 1,
    frames: [{ id: 1, name: 'initializeDemo (simulated)', line: 12, source: { path: `${root}/src/main.tsx`, name: 'main.tsx' } }],
    output: 'Demo: 실제 프로세스·디버그 어댑터를 실행하지 않습니다.\n중단점·단계 실행·변수 확인을 체험해 보세요.\n',
    breakpoints: [], capabilities: { supportsConfigurationDoneRequest: true, supportsEvaluateForHovers: true, supportsSetVariable: true, supportsSetExpression: true, supportsRestartRequest: true }, threads: [{ id: 1, name: 'Demo main thread', stopped: true }],
  }
  return { config: store.getState(`debug-config:${root}`, config), session: store.getState(`debug-session:${root}`, session), adapter: { installed: true, version: 'demo · simulated' } }
}

export const handleDemoDebugger: DemoHttpHandler = ({ store, request, url, body }) => {
  if (!url.pathname.startsWith('/api/debugger')) return
  const root = decodeURIComponent(request.headers.get('X-Mew-Debug-Workspace') ?? store.workspaceInfo().path)
  store.tree('.workspace', root)
  const route = url.pathname.slice('/api/debugger'.length), status = demoDebuggerStatus(store, root)
  const saveSession = () => store.setState(`debug-session:${root}`, status.session)
  if (!route) { requireMethod(request, 'GET'); return demoJson(status) }
  if (route === '/config') {
    requireMethod(request, 'PUT')
    const config = body as unknown as DebugConfig
    if (!Array.isArray(config.breakpoints) || !Array.isArray(config.watches)) throw new DemoError('디버거 설정을 확인해 주세요.')
    store.setState(`debug-config:${root}`, config)
    status.session.breakpoints = config.breakpoints.filter(item => item.enabled).map((item, index) => ({ file: item.file, line: item.line, id: index + 1, verified: true }))
    saveSession(); return demoJson(config)
  }
  if (route === '/bridge') { requireMethod(request, 'POST'); status.config.agentBridge = body.enabled === true; store.setState(`debug-config:${root}`, status.config); return demoJson(status.config) }
  if (route === '/install' || route === '/test') { requireMethod(request, 'POST'); return demoJson(status.config) }
  if (route === '/profiles/import') { requireMethod(request, 'POST'); return demoJson({ profiles: status.config.profiles ?? [], compounds: status.config.compounds ?? [] }) }
  if (route === '/profiles/test') { requireMethod(request, 'POST'); return demoJson({ name: 'Demo test', request: 'launch', configuration: { program: stringField(body, 'file'), cwd: root } }) }
  if (['/start', '/compound', '/stop', '/select'].includes(route)) {
    requireMethod(request, 'POST')
    status.session.state = route === '/stop' ? 'terminated' : 'stopped'
    status.session.id = 'demo-debugger'; status.session.reason = 'Demo · 로컬 시뮬레이션'; saveSession()
    return demoJson({ ok: true })
  }
  if (route === '/command') {
    requireMethod(request, 'POST')
    const command = stringField(body, 'command'), args = (body.arguments ?? {}) as Record<string, unknown>
    const step = status.session.stopRevision ?? 1
    const variables = store.getState<DebugVariable[]>(`debug-variables:${root}`, [{ name: 'demo', value: 'true', type: 'boolean', variablesReference: 0 }, { name: 'step', value: String(step), type: 'number', variablesReference: 0 }, { name: 'workspace', value: JSON.stringify(root), type: 'string', variablesReference: 0 }])
    if (command === 'scopes') return demoJson({ scopes: [{ name: 'Demo locals', variablesReference: 1, expensive: false }] })
    if (command === 'variables') return demoJson({ variables: variables.map(item => item.name === 'step' ? { ...item, value: String(step) } : item) })
    if (command === 'threads') return demoJson({ threads: status.session.threads })
    if (command === 'stackTrace') return demoJson({ stackFrames: status.session.frames, totalFrames: status.session.frames.length })
    if (command === 'evaluate') {
      const expression = String(args.expression ?? ''), variable = variables.find(item => item.name === expression)
      return demoJson({ result: expression === 'step' ? String(step) : variable?.value ?? `Demo: ${expression}`, variablesReference: 0, type: variable?.type ?? 'string' })
    }
    if (command === 'setVariable' || command === 'setExpression') {
      const name = String(args.name ?? args.expression ?? ''), value = String(args.value ?? ''), variable = variables.find(item => item.name === name)
      if (variable) variable.value = value
      store.setState(`debug-variables:${root}`, variables); return demoJson({ value, variablesReference: 0 })
    }
    if (command === 'setBreakpoints') {
      const source = args.source as { path?: string } | undefined
      const breakpoints = (Array.isArray(args.breakpoints) ? args.breakpoints : []) as { line: number }[]
      status.session.breakpoints = breakpoints.map((item, index) => ({ ...item, id: index + 1, file: source?.path ?? '', verified: true })); saveSession()
      return demoJson({ breakpoints: status.session.breakpoints })
    }
    if (['next', 'stepIn', 'stepOut', 'continue', 'pause', 'restart', 'disconnect', 'terminate'].includes(command)) {
      status.session.state = command === 'continue' ? 'running' : ['terminate', 'disconnect'].includes(command) ? 'terminated' : 'stopped'
      status.session.stopRevision = step + 1; status.session.reason = `Demo · ${command}`
      status.session.frames[0].line = 12 + (step % 6)
      status.session.output += `Demo: ${command}\n`; saveSession(); return demoJson({ allThreadsContinued: command === 'continue' })
    }
    throw new DemoError('이 디버그 요청은 데모에서 실행하지 않습니다. 단계 실행·변수·감시식으로 체험해 주세요.', 501)
  }
  throw new DemoError('이 디버거 기능은 실제 디버그 어댑터가 필요합니다.', 501)
}
