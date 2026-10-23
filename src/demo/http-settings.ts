import { DEMO_USER, DEMO_CODE_PATH } from './fixtures.ts'
import { demoJson, requireMethod, stringArray, stringField, type DemoHttpHandler } from './http.ts'
import { DemoError } from './workspace-store.ts'
import type { AgentRuntimeStatus, AgentSet, AgentTabsState, ChatMessage, CommentThread, IgnoreListState, MemberProfile, RootProjectTabState, WorkspaceUiState } from '../api/client.ts'
import type { TmuxSession } from '../../packages/tmux-term/src/types.ts'
import type { StoredTabs } from '../hooks/useTabs.ts'
import { demoHostSession } from './http-host.ts'
import { parseThemeSettings, type ThemeSettings } from '../../shared/theme.ts'

const runtimes: AgentRuntimeStatus[] = ['codex', 'claude', 'antigravity', 'hermes', 'kimi', 'openclaw', 'opencode', 'cursor', 'prime', 'tmux'].map(id => ({ id, label: id === 'codex' ? 'Demo agent' : `${id} · Demo`, surface: id === 'tmux' ? 'terminal' : 'acp', installed: true, installing: false, installable: true, uninstallable: id !== 'tmux', logoutable: id !== 'tmux' }))
const defaultDemoTabs: StoredTabs = { unifiedScopes: true, panes: [{ id: 'main', tabs: [{ path: 'mew:file:docs/welcome.md', preview: false, viewMode: 'hotview' }, { path: DEMO_CODE_PATH, preview: false, viewMode: 'plain' }], activePath: 'mew:file:docs/welcome.md' }], layout: { kind: 'leaf', pane: 'main' }, focusedPaneId: 'main' }
const defaultAgentTabs = (cwd: string): AgentTabsState => ({ tabs: [{ id: 'demo-agent', label: 'Demo agent', runtime: 'codex', cwd }], activeId: 'demo-agent' })
const defaultAgentSets: AgentSet[] = [{ id: 'demo-default', name: 'Demo agent', role: '프로젝트 문서와 코드를 함께 살펴봅니다.', runtime: 'codex', modelId: 'demo-model' }]
export const defaultDemoWorkspaceUi: WorkspaceUiState = {
  version: 1,
  sidebar: { explorerScope: 'docs', docsExpanded: true, expandedSubprojects: [] },
  chrome: { sidebarOpen: true, sidebarView: 'files', agentOpen: true, terminalOpen: true, gitOpen: true, tocOpen: false, tasksOpen: false, memoOpen: false },
  tabs: { '.workspace': defaultDemoTabs },
}

export const handleDemoSettings: DemoHttpHandler = ({ store, request, url, body, project }) => {
  const route = url.pathname, method = request.method
  if (route === '/api/auth/me') { requireMethod(request, 'GET'); return demoJson(store.authStatus()) }
  if (route === '/api/auth/profile') {
    requireMethod(request, 'PUT')
    const displayName = stringField(body, 'displayName').trim(), avatarDataUrl = body.avatarDataUrl
    const controlCharacter = [...displayName].some(character => { const code = character.codePointAt(0)!; return code < 32 || code === 127 })
    if (!displayName || displayName.length > 50 || controlCharacter) throw new DemoError('표시 이름은 1~50자로 입력하세요.')
    if (avatarDataUrl !== null && (typeof avatarDataUrl !== 'string' || !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(avatarDataUrl) || avatarDataUrl.length > 700_000)) throw new DemoError('프로필 사진은 512KB 이하의 JPG, PNG, WebP 또는 GIF만 사용할 수 있습니다.')
    const profile: MemberProfile = { email: DEMO_USER.email, displayName, avatarDataUrl: avatarDataUrl as string | null }
    store.setState('profile', profile); return demoJson({ ok: true, profile })
  }
  if (route === '/api/auth/login' || route === '/api/auth/change-password') { requireMethod(request, 'POST'); throw new DemoError('데모에서는 실제 계정을 사용하지 않습니다. 데모를 초기화하면 다시 시작할 수 있습니다.', 501) }
  if (route === '/api/auth/logout') { requireMethod(request, 'POST'); store.reset(); return demoJson({ ok: true }) }
  if (route === '/api/user-ui/theme') {
    requireMethod(request, 'GET', 'PUT')
    let state = store.getState<ThemeSettings | null>('theme', null)
    if (method === 'PUT' && (!body.initialize || !state)) {
      state = parseThemeSettings(body.state)
      store.setState('theme', state)
    }
    return demoJson({ state })
  }
  if (route === '/api/user-ui/root-projects') {
    requireMethod(request, 'GET', 'PUT')
    if (method === 'PUT') store.setState('root-projects', body)
    return demoJson({ state: store.getState<RootProjectTabState>('root-projects', { paths: [store.workspacePath], icons: {} }) })
  }
  if (route === '/api/user-ui/workspace' || route === '/api/user-ui/agent-tabs') {
    requireMethod(request, 'GET', 'PUT')
    const workspace = method === 'GET' ? url.searchParams.get('workspace') ?? store.workspacePath : stringField(body, 'workspacePath', store.workspacePath)
    const key = `${route}:${workspace}`, agent = route.endsWith('agent-tabs')
    if (method === 'PUT') store.setState(key, agent ? { tabs: body.tabs, activeId: body.activeId } : body.state)
    const fallback = agent ? defaultAgentTabs(workspace) : defaultDemoWorkspaceUi
    return demoJson({ state: store.getState<unknown>(key, fallback), ...(agent && method === 'GET' ? { claims: [] } : {}) })
  }
  if (route === '/api/project-icons/read') {
    requireMethod(request, 'POST')
    const icons = store.getState<Record<string, string>>('project-icons', {})
    return demoJson({ icons: Object.fromEntries(stringArray(body, 'paths').filter(path => icons[path]).map(path => [path, icons[path]])) })
  }
  if (route === '/api/project-icons' || route === '/api/project-icon') {
    requireMethod(request, 'PUT')
    const icons = store.getState<Record<string, string>>('project-icons', {}), target = stringField(body, 'path', project), icon = stringField(body, 'icon')
    if (icon) icons[target] = icon; else delete icons[target]
    store.setState('project-icons', icons); return demoJson({ ok: true, icon: icon || null })
  }
  if (route === '/api/agent-runtimes') { requireMethod(request, 'GET'); return demoJson({ runtimes: store.getState('agent-runtimes', runtimes) }) }
  const runtimeAction = route.match(/^\/api\/agent-runtimes\/([^/]+)\/(install|logout)$/)
  if (runtimeAction) {
    requireMethod(request, ...(runtimeAction[2] === 'logout' ? ['POST'] : ['POST', 'DELETE']))
    const statuses = store.getState('agent-runtimes', runtimes), status = statuses.find(item => item.id === runtimeAction[1])
    if (!status) throw new DemoError('데모 런타임을 찾을 수 없습니다.', 404)
    if (runtimeAction[2] === 'install') {
      status.installed = method === 'POST'
      status.installation = method === 'POST' ? { state: 'succeeded', output: 'Demo: 런타임 설치를 완료했습니다. 실제 설치는 변경하지 않았습니다.' } : undefined
      store.setState('agent-runtimes', statuses)
    }
    else store.setState(`runtime-logged-out:${status.id}`, true)
    return demoJson({ status, output: 'Demo: 실제 설치·삭제·계정 연결은 변경하지 않았습니다.' })
  }
  const runtimeRoute = route.match(/^\/api\/agent-runtimes\/([^/]+)\/(models|account|settings|terminal\/([^/]+))$/)
  if (runtimeRoute) {
    const id = decodeURIComponent(runtimeRoute[1])
    if (runtimeRoute[3] && runtimes.some(item => item.id === id)) {
      requireMethod(request, 'POST', 'DELETE')
      const tab = decodeURIComponent(runtimeRoute[3])
      if (!/^[\w-]{1,64}$/.test(tab)) throw new DemoError('터미널 탭을 확인해 주세요.')
      const session = `demo-agent-${id}-${tab}`
      const sessions = store.getState<TmuxSession[]>('tmux-sessions', [{ name: 'demo-terminal', windows: 1, attached: false, createdAt: 0 }])
      if (method === 'POST') {
        const cwd = stringField(body, 'cwd', store.workspaceInfo().path)
        const canonical = store.canonicalFilePath(cwd)
        const absolute = store.workspacePath + (canonical ? `/${canonical}` : '')
        store.tree('.workspace', absolute)
        if (!sessions.some(item => item.name === session)) {
          store.setState(`tmux-session-cwd:${session}`, absolute)
          store.setState('tmux-sessions', [...sessions, { name: session, windows: 1, attached: false, createdAt: Date.now() }])
        }
        return demoJson({ ok: true, session })
      }
      store.setState('tmux-sessions', sessions.filter(item => item.name !== session))
      store.deleteState(`tmux-session-cwd:${session}`)
      return demoJson({ ok: true })
    }
    if (!runtimes.some(item => item.id === id)) throw new DemoError('이 런타임은 데모에서 제공하지 않습니다.', 404)
    const resource = runtimeRoute[2]
    if (resource === 'models') { requireMethod(request, 'GET'); return demoJson({ models: [{ modelId: 'demo-model', name: 'Demo model' }], thinking: null }) }
    if (resource === 'account') { requireMethod(request, 'GET'); return demoJson({ account: { runtime: id, account: 'Demo visitor', plan: 'Demo', authentication: store.getState(`runtime-logged-out:${id}`, false) ? 'signed_out' : 'connected', subscription: 'paid', issue: null, subscriptionUrl: null, note: 'Demo · 실제 계정에 연결하지 않습니다.', checkedAt: new Date().toISOString() } }) }
    if (resource === 'settings') {
      requireMethod(request, 'GET', 'PUT', 'DELETE')
      const key = `runtime-settings:${id}`
      if (method === 'PUT') {
        const env = body.env && typeof body.env === 'object' ? Object.fromEntries(Object.entries(body.env).map(([name, value]) => [name, value ? '********' : ''])) : undefined
        store.setState(key, { cmd: stringField(body, 'cmd'), extraArgs: stringArray(body, 'extraArgs'), env })
      } else if (method === 'DELETE') store.deleteState(key)
      return demoJson(method === 'DELETE' ? { ok: true } : { settings: store.getState(key, null) })
    }
    requireMethod(request, 'POST', 'DELETE')
    return demoJson({ ok: true, session: `demo-agent-${id}-${runtimeRoute[3]}` })
  }
  if (/^\/api\/agent-defaults\/[^/]+$/.test(route)) {
    requireMethod(request, 'GET', 'PUT')
    if (method === 'PUT') store.setState(route, body)
    return demoJson({ settings: store.getState(route, { modelId: 'demo-model' }) })
  }
  if (route === '/api/agent-sets') {
    requireMethod(request, 'GET', 'PUT')
    if (method === 'PUT') store.setState('agent-sets', body.sets)
    return demoJson({ sets: store.getState('agent-sets', defaultAgentSets) })
  }
  if (route === '/api/skills') { requireMethod(request, 'GET'); return demoJson({ skills: [] }) }
  if (route === '/api/agent/harness') { requireMethod(request, 'GET'); return demoJson({ scopes: [{ id: 'project', label: 'Project', path: store.workspacePath, global: false }], agents: [{ id: 'codex', label: 'Demo agent' }], locations: [], items: [], warnings: [] }) }
  if (route === '/api/agent/commands') { requireMethod(request, 'GET'); return demoJson({ commands: [] }) }
  if (route.startsWith('/api/agent/commands/stop-tab/')) { requireMethod(request, 'POST'); return demoJson({ ok: true }) }
  if (route === '/api/cmd-buttons/run') {
    requireMethod(request, 'POST')
    const buttons = store.getState<{ name: string; command: string }[]>(`/api/cmd-buttons:${project}`, [{ name: 'Demo check', command: 'npm run check' }])
    const index = buttons.findIndex(item => item.name === stringField(body, 'name'))
    if (index < 0) throw new DemoError('명령어 버튼을 찾을 수 없습니다.', 404)
    const session = `mewcmd-demo-${index}`; demoHostSession(store, session, `${buttons[index].name}\r\n$ ${buttons[index].command}`)
    return demoJson({ ok: true, session })
  }
  if (route === '/api/cmd-buttons' || route === '/api/term-buttons') {
    requireMethod(request, 'GET', 'PUT')
    const key = `${route}:${project}`
    if (method === 'PUT') store.setState(key, body.buttons ?? [])
    const buttons = store.getState<{ name: string; command: string }[]>(key, route === '/api/cmd-buttons' ? [{ name: 'Demo check', command: 'npm run check' }] : [{ name: '현재 폴더', command: 'pwd' }, { name: 'Git 변경', command: 'git status --short' }])
    return demoJson({ buttons: route === '/api/cmd-buttons' ? buttons.map((button, index) => ({ ...button, session: `mewcmd-demo-${index}`, running: false })) : buttons })
  }
  if (route === '/api/ignore') {
    requireMethod(request, 'GET', 'PUT')
    if (method === 'PUT') store.setState('ignore', body)
    return demoJson(store.getState<IgnoreListState>('ignore', { names: [], defaults: [], locked: [] }))
  }
  if (route === '/api/tmux/sessions') {
    requireMethod(request, 'GET', 'POST')
    const sessions = store.getState<TmuxSession[]>('tmux-sessions', [{ name: 'demo-terminal', windows: 1, attached: false, createdAt: 0 }])
    if (method === 'POST') {
      const name = stringField(body, 'name', `demo-terminal-${sessions.length + 1}`)
      if (sessions.some(session => session.name === name)) throw new DemoError('같은 이름의 터미널이 있습니다.', 409)
      sessions.push({ name, windows: 1, attached: false, createdAt: Date.now() }); store.setState('tmux-sessions', sessions)
      return demoJson({ ok: true, name })
    }
    return demoJson(sessions)
  }
  const terminalRoute = route.match(/^\/api\/tmux\/sessions\/([^/]+)(\/rename)?$/)
  if (terminalRoute) {
    requireMethod(request, terminalRoute[2] ? 'POST' : 'DELETE')
    const name = decodeURIComponent(terminalRoute[1]), sessions = store.getState<TmuxSession[]>('tmux-sessions', [{ name: 'demo-terminal', windows: 1, attached: false, createdAt: 0 }])
    if (terminalRoute[2]) {
      const terminal = sessions.find(session => session.name === name), newName = stringField(body, 'newName').trim()
      if (!terminal) throw new DemoError('터미널을 찾을 수 없습니다.', 404)
      if (!newName || sessions.some(session => session !== terminal && session.name === newName)) throw new DemoError('다른 터미널 이름을 입력하세요.', 409)
      terminal.name = newName
      if (name !== newName) {
        const cwd = store.getState<string | null>(`tmux-session-cwd:${name}`, null)
        if (cwd !== null) store.setState(`tmux-session-cwd:${newName}`, cwd)
        store.deleteState(`tmux-session-cwd:${name}`)
      }
      store.setState('tmux-session-rename', { oldName: name, newName })
      store.setState('tmux-sessions', sessions)
      return demoJson({ ok: true, name: terminal.name })
    }
    store.setState('tmux-sessions', sessions.filter(session => session.name !== name))
    store.deleteState(`tmux-session-cwd:${name}`)
    return demoJson({ ok: true })
  }
  if (route === '/api/todos') { requireMethod(request, 'GET'); return demoJson({ items: [] }) }
  if (route === '/api/members') { requireMethod(request, 'GET'); return demoJson({ members: [DEMO_USER.email] }) }
  if (route === '/api/member-profiles') { requireMethod(request, 'GET'); const auth = store.authStatus(); return demoJson({ members: [{ email: auth.email, displayName: auth.displayName, avatarDataUrl: auth.avatarDataUrl }] }) }
  if (route === '/api/chat') {
    requireMethod(request, 'GET', 'POST', 'DELETE')
    const messages = store.getState<ChatMessage[]>('chat', [])
    if (method === 'GET') return demoJson({ messages, unread: {}, canDeleteHistory: true })
    if (method === 'DELETE') { store.setState('chat', []); return demoJson({ ok: true, deleted: messages.length }) }
    const message: ChatMessage = { id: crypto.randomUUID(), author: DEMO_USER.email, time: Date.now(), text: stringField(body, 'text'), unread: 0, ...(Array.isArray(body.to) ? { to: stringArray(body, 'to') } : {}) }
    messages.push(message); store.setState('chat', messages); return demoJson({ ok: true, message })
  }
  if (route === '/api/chat/read') { requireMethod(request, 'POST'); return demoJson({ ok: true }) }
  if (route === '/api/comments') {
    requireMethod(request, 'GET', 'POST', 'PUT', 'DELETE')
    const target = method === 'GET' || method === 'DELETE' ? url.searchParams.get('path') ?? '' : stringField(body, 'path'), key = `comments:${store.canonicalFilePath(target, project)}`
    let threads = store.getState<CommentThread[]>(key, [])
    if (method === 'GET') return demoJson({ threads })
    const threadId = method === 'DELETE' ? url.searchParams.get('threadId') ?? '' : stringField(body, 'threadId'), commentId = method === 'DELETE' ? url.searchParams.get('commentId') ?? '' : stringField(body, 'commentId')
    let thread = threads.find(item => item.id === threadId)
    if (method === 'POST') {
      if (!thread) { if (!body.anchor) throw new DemoError('댓글 위치를 선택하세요.'); thread = { id: crypto.randomUUID(), anchor: body.anchor as CommentThread['anchor'], comments: [] }; threads.push(thread) }
      thread.comments.push({ id: crypto.randomUUID(), author: DEMO_USER.email, time: Date.now(), text: stringField(body, 'text') })
    } else {
      if (!thread) throw new DemoError('댓글을 찾을 수 없습니다.', 404)
      const comment = thread.comments.find(item => item.id === commentId)
      if (!comment) throw new DemoError('댓글을 찾을 수 없습니다.', 404)
      if (method === 'PUT') { comment.text = stringField(body, 'text'); comment.edited = Date.now() }
      else { thread.comments = thread.comments.filter(item => item.id !== commentId); if (!thread.comments.length) { threads = threads.filter(item => item.id !== threadId); thread = undefined } }
    }
    store.setState(key, threads); return demoJson({ ok: true, thread: thread ?? null })
  }
  if (route === '/api/presence/history') { requireMethod(request, 'GET'); return demoJson({ records: [], people: [], recordedSince: null, generatedAt: Date.now() }) }
}
