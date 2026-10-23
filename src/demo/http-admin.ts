import { defaultCapabilities, FEATURES, type AccessSettings, type FileRule } from '../../shared/access-policy.ts'
import type { MewlinkAccessOverview } from '../../shared/mewlink-identity.ts'
import type { AdminUser } from '../api/client.ts'
import type { TreeNode } from '../../packages/editor/src/types.ts'
import { DEMO_USER } from './fixtures.ts'
import { demoJson, requireMethod, stringField, type DemoHttpHandler } from './http.ts'
import { DemoError } from './workspace-store.ts'

const demoUsers: AdminUser[] = [
  { ...DEMO_USER, id: 'demo-visitor', role: 'owner', hasPassword: false, mustChangePassword: false, createdAt: 0 },
  { email: 'member@example.test', id: 'demo-member', displayName: 'Demo member', role: 'member', hasPassword: true, mustChangePassword: false, createdAt: 0 },
]
const overview: MewlinkAccessOverview = { requests: [{ id: 'demo-request', identity: { issuer: 'https://demo.invalid', subject: 'demo-request-identity', displayName: 'Demo guest', provider: 'email', username: 'demo-guest' }, requestedAt: 0, status: 'pending' }], links: [] }

export const handleDemoAdmin: DemoHttpHandler = ({ store, request, url, body, project }) => {
  const route = url.pathname, method = request.method
  if (!route.startsWith('/api/admin/')) return
  const users = store.getState<AdminUser[]>('admin-users', demoUsers)
  const settings: AccessSettings = { workspace: store.workspacePath, rows: users.map(user => {
    const overrides = store.getState<AccessSettings['rows'][number]['overrides']>(`admin-features:${user.email}`, {})
    return { subject: user.email, role: user.role, displayName: user.displayName ?? user.email, avatarDataUrl: user.email === store.authStatus().email ? store.authStatus().avatarDataUrl : null, capabilities: { ...defaultCapabilities(user.role), ...overrides }, overrides }
  }) }
  if (route === '/api/admin/users') {
    requireMethod(request, 'GET', 'POST')
    if (method === 'GET') return demoJson(users)
    const email = stringField(body, 'email').trim(), role = stringField(body, 'role')
    if (!email.includes('@') || !['owner', 'manager', 'member'].includes(role)) throw new DemoError('계정과 역할을 확인해 주세요.')
    if (users.some(user => user.email === email)) throw new DemoError('이미 추가한 데모 계정입니다.', 409)
    users.push({ email, role: role as AdminUser['role'], mustChangePassword: true, createdAt: Date.now() })
    store.setState('admin-users', users); return demoJson({ ok: true, email, tempPassword: 'DEMO-ONLY-NOT-A-PASSWORD' })
  }
  const role = route.match(/^\/api\/admin\/users\/([^/]+)\/role$/)
  if (role) {
    requireMethod(request, 'PUT')
    const user = users.find(user => user.email === decodeURIComponent(role[1]))
    if (!user) throw new DemoError('데모 계정을 찾을 수 없습니다.', 404)
    const value = stringField(body, 'role')
    if (!['owner', 'manager', 'member'].includes(value)) throw new DemoError('역할을 확인해 주세요.')
    if (user.role === 'owner' && value !== 'owner' && users.filter(user => user.role === 'owner').length === 1) throw new DemoError('마지막 owner의 역할은 변경할 수 없습니다.')
    user.role = value as AdminUser['role']; store.setState('admin-users', users); return demoJson({ ok: true })
  }
  const account = route.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (account) {
    requireMethod(request, 'DELETE')
    const accountId = decodeURIComponent(account[1]).trim().toLowerCase(), user = users.find(user => user.email === accountId)
    if (!user) throw new DemoError('데모 계정을 찾을 수 없습니다.', 404)
    if (user.role === 'owner' && users.filter(user => user.role === 'owner').length === 1) throw new DemoError('마지막 owner는 삭제할 수 없습니다.')
    if (user.email === store.authStatus().email) throw new DemoError('현재 로그인한 계정은 삭제할 수 없습니다.')
    store.setState('admin-users', users.filter(user => user.email !== accountId))
    store.setState('admin-features:' + accountId, {})
    const paths = store.getState<Record<string, Record<string, FileRule>>>('admin-path-rules', {})
    for (const rules of Object.values(paths)) delete rules[accountId]
    store.setState('admin-path-rules', paths)
    const state = store.getState<MewlinkAccessOverview>('admin-mewlink', overview)
    store.setState('admin-mewlink', { requests: state.requests.filter(request => request.accountId !== accountId), links: state.links.filter(link => link.accountId !== accountId) })
    return demoJson({ ok: true })
  }
  if (route === '/api/admin/access') { requireMethod(request, 'GET'); return demoJson(settings) }
  if (route === '/api/admin/access/feature') {
    requireMethod(request, 'PUT')
    const row = settings.rows.find(row => row.subject === stringField(body, 'subject')), feature = FEATURES.find(feature => feature === body.feature)
    if (!row || !feature || body.enabled !== null && typeof body.enabled !== 'boolean') throw new DemoError('기능 권한을 확인해 주세요.')
    if (body.enabled === null) delete row.overrides[feature]; else row.overrides[feature] = body.enabled as boolean
    row.capabilities = { ...defaultCapabilities(row.role), ...row.overrides }
    store.setState(`admin-features:${row.subject}`, row.overrides); return demoJson(settings)
  }
  if (route === '/api/admin/access/path') {
    requireMethod(request, 'GET', 'PUT')
    const path = method === 'GET' ? url.searchParams.get('path') ?? '' : stringField(body, 'path')
    const key = `${project}:${path}`, paths = store.getState<Record<string, Record<string, FileRule>>>('admin-path-rules', {}), rules = paths[key] ?? {}
    if (method === 'PUT') {
      const subject = stringField(body, 'subject'), access = stringField(body, 'access')
      if (access === 'inherit') delete rules[subject]
      else rules[subject] = { path, view: access !== 'deny', edit: access === 'edit' }
      paths[key] = rules; store.setState('admin-path-rules', paths); return demoJson({ ok: true })
    }
    let entries: TreeNode[] = [], directory = true
    try { entries = store.tree(project, path) } catch { store.fileInfo(path, project); directory = false }
    return demoJson({ workspace: store.workspacePath, project, path, directory, entries, permissions: settings.rows.map(row => ({ subject: row.subject, explicit: rules[row.subject] ?? null, effective: rules[row.subject] ?? { view: row.capabilities.filesRead, edit: row.capabilities.filesWrite } })) })
  }
  if (route.startsWith('/api/admin/mewlink')) {
    const state = store.getState<MewlinkAccessOverview>('admin-mewlink', overview)
    if (route === '/api/admin/mewlink') { requireMethod(request, 'GET'); return demoJson(state) }
    const action = route.match(/\/requests\/([^/]+)\/(approve|deny)$/)
    if (action) {
      requireMethod(request, 'POST')
      const item = state.requests.find(item => item.id === action[1])
      if (!item) throw new DemoError('데모 요청을 찾을 수 없습니다.', 404)
      item.status = action[2] === 'approve' ? 'approved' : 'denied'
      if (item.status === 'approved') { item.accountId = DEMO_USER.email; state.links.push({ id: item.id, identity: item.identity, accountId: DEMO_USER.email, linkedAt: Date.now() }) }
    } else if (route.includes('/links/')) { requireMethod(request, 'DELETE'); state.links = state.links.filter(link => link.id !== route.split('/').at(-1)) }
    else return
    store.setState('admin-mewlink', state); return demoJson({ ok: true })
  }
}
