import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { McpServer } from '@agentclientprotocol/sdk'
import { DATA_DIR } from './dataDir.ts'
import { workspacePaths } from './paths.ts'
import { createExternalFolder, resolveExistingPath } from './fsBrowse.ts'
import { applyProjectSetup, defaultAgentSettings, planProjectSetup, readProjectAgentSettings } from './project-setup.ts'
import { projectDocsDir, safeProjectPath } from './project-agent-settings.ts'
import { MEWCAT_HELP_TOPICS, MEWCAT_PANELS, MEWCAT_TOOLS, type MewcatAction, type MewcatClientMessage, type MewcatContext } from '../shared/mewcat-assistant.ts'

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url))
const helpPaths = ['docs/guides/getting-started-ko.md', 'docs/guides/projects.md', 'docs/guides/project-setup.md', 'docs/guides/terminal-agents.md', 'docs/features/git/workbench.md', 'docs/features/화면·계정·운영/뮤캣 도우미·대화·Mew 조작.md']
export class MewcatToolError extends Error {}
const bindings = new Map<string, MewcatBinding>()
const starting = new Map<string, Promise<MewcatBinding>>()

export interface MewcatBindingOptions {
  account: string; browser: string; runtime: string
  authorized: () => boolean; owner: () => boolean
  superseded?: () => void
  send: (message: { type: 'mewcat_action'; id: string; action: MewcatAction }) => void
}

export class MewcatBinding {
  context: MewcatContext = { projectRoot: null, locale: 'en' }
  readonly tab: string
  readonly cwd: string
  readonly socketPath: string
  readonly mcpServers: McpServer[]
  readonly server: net.Server
  options: MewcatBindingOptions
  active = true
  private cleanupTimer: NodeJS.Timeout | null = null
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  constructor(options: MewcatBindingOptions) {
    this.options = options
    const digest = crypto.createHash('sha256').update(`${options.account}\0${options.browser}\0${options.runtime}`).digest('hex').slice(0, 24)
    this.tab = `mewcat-${digest}`
    this.cwd = path.join(DATA_DIR, 'mewcat', digest)
    this.socketPath = path.join(DATA_DIR, 'mewcat', `${digest}.sock`)
    this.mcpServers = [{ name: 'mew', command: process.execPath, args: [fileURLToPath(new URL('./mewcat-mcp-stdio.ts', import.meta.url)), this.socketPath], env: [] }]
    this.server = net.createServer(socket => {
      let buffer = ''
      socket.setEncoding('utf8')
      socket.on('error', () => {})
      socket.setTimeout(65_000, () => socket.destroy())
      socket.on('data', chunk => {
        buffer += chunk
        if (buffer.length > 64_000) { socket.destroy(); return }
        const end = buffer.indexOf('\n')
        if (end < 0) return
        socket.pause()
        void this.rpc(buffer.slice(0, end)).then(result => socket.end(`${JSON.stringify(result)}\n`)).catch(() => socket.destroy())
      })
    })
    this.server.unref()
  }
  assertAccess(owner = false) {
    if (!this.active || !this.options.authorized()) throw new MewcatToolError('MEWCAT_DISCONNECTED')
    if (owner && !this.options.owner()) throw new MewcatToolError('MEWCAT_FORBIDDEN')
  }
  handle(message: MewcatClientMessage) {
    this.assertAccess()
    if (message.type === 'mewcat_context') {
      const context = message.context
      if (!context || !['ko', 'en', 'ja', 'zh-CN'].includes(context.locale)
        || (context.projectRoot !== null && (typeof context.projectRoot !== 'string' || context.projectRoot.length > 4096 || !path.isAbsolute(context.projectRoot)))) return
      this.context = { projectRoot: context.projectRoot, locale: context.locale }
    } else if (message.type === 'mewcat_action_result') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok === true) pending.resolve({ ok: true })
      else pending.reject(new MewcatToolError('MEWCAT_ACTION_FAILED'))
    }
  }
  activate(options: MewcatBindingOptions) {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer)
    this.cleanupTimer = null
    this.options = options
    this.active = true
  }
  disconnect() {
    this.active = false
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new MewcatToolError('MEWCAT_DISCONNECTED')) }
    this.pending.clear()
    const key = JSON.stringify([this.options.account, this.options.browser, this.options.runtime])
    // Do not retain a closed browser's cookies or callbacks until a future reconnect.
    this.options = { ...this.options, authorized: () => false, owner: () => false, send() {}, superseded: undefined }
    if (!this.cleanupTimer) {
      this.cleanupTimer = setTimeout(() => {
        if (this.active || bindings.get(key) !== this) return
        bindings.delete(key)
        this.server.close()
        fs.rmSync(this.socketPath, { force: true })
      }, 30 * 60_000)
      this.cleanupTimer.unref()
    }
  }
  async view(action: MewcatAction) {
    this.assertAccess()
    return new Promise<unknown>((resolve, reject) => {
      const id = crypto.randomUUID()
      const timer = setTimeout(() => { this.pending.delete(id); reject(new MewcatToolError('MEWCAT_TIMEOUT')) }, 60_000)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      this.options.send({ type: 'mewcat_action', id, action })
    })
  }
  prompt(text: string) {
    return `You are Mewcat, the Mew application assistant. Reply in the UI language (${this.context.locale}) with brief, useful answers. Help the user start their own projects without studying agent setup. Use mew_get_help for product facts and mew_get_context for live state. Use the supplied mew MCP tools to operate Mew; never simulate clicks or use shell commands as a substitute for these tools. Do not claim success until a tool returns success. Do not delete, overwrite, deploy, restart Mew, or change runtime/MCP settings. Existing documents and instructions must be preserved. When asked to build something, create/open a project, prepare Documents, and hand off to a project work conversation with a concise initial request. Ask only for information essential to the requested task. Current screen context: ${JSON.stringify(this.context)}\n\nUser request:\n${text}`
  }
  async tool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.assertAccess()
    const string = (key: string, max = 4096) => {
      if (typeof args[key] !== 'string' || !args[key] || args[key].length > max) throw new MewcatToolError('MEWCAT_INVALID_ARGUMENT')
      return args[key] as string
    }
    const project = () => resolveExistingPath(string('projectRoot'))
    if (name === 'mew_get_context') return { ...this.context, canManageProjects: this.options.owner(), defaultProjectParent: path.dirname(this.context.projectRoot ?? workspacePaths.root), tools: MEWCAT_TOOLS.map(tool => tool.name) }
    if (name === 'mew_get_help') {
      const topic = MEWCAT_HELP_TOPICS.indexOf(string('topic') as typeof MEWCAT_HELP_TOPICS[number])
      if (topic < 0) throw new MewcatToolError('MEWCAT_INVALID_ARGUMENT')
      const source = helpPaths[topic]
      return { source, text: fs.readFileSync(path.join(APP_ROOT, source), 'utf8').slice(0, 24_000) }
    }
    if (name === 'mew_create_project') {
      this.assertAccess(true)
      return { path: createExternalFolder(string('parent'), string('name', 255)) }
    }
    if (name === 'mew_setup_documents') {
      this.assertAccess(true)
      const projectRoot = project()
      const input = { projectRoot, settings: readProjectAgentSettings(projectRoot) ?? defaultAgentSettings(projectDocsDir(projectRoot, process.env.MEW_DOCS)), initDocs: true, locale: this.context.locale }
      const plan = planProjectSetup(input)
      const result = applyProjectSetup(input, plan.revision)
      if (this.context.projectRoot === projectRoot) await this.view({ kind: 'refresh_documents', projectRoot })
      return { projectRoot, files: result.files }
    }
    if (name === 'mew_open_project') {
      this.assertAccess(true)
      const projectPath = resolveExistingPath(string('path'))
      await this.view({ kind: 'open_project', path: projectPath })
      return { path: projectPath, opened: true }
    }
    if (name === 'mew_open_panel') {
      const panel = string('panel') as typeof MEWCAT_PANELS[number]
      if (!MEWCAT_PANELS.includes(panel)) throw new MewcatToolError('MEWCAT_INVALID_ARGUMENT')
      return this.view({ kind: 'open_panel', panel })
    }
    if (name === 'mew_open_file') {
      const projectRoot = project()
      const relative = string('path')
      if (!fs.statSync(safeProjectPath(projectRoot, relative)).isFile()) throw new MewcatToolError('MEWCAT_INVALID_ARGUMENT')
      // Files are opened through the browser’s normal ACL-checked API.
      return this.view({ kind: 'open_file', projectRoot, path: relative })
    }
    if (name === 'mew_start_project_session') {
      return this.view({ kind: 'start_project_session', projectRoot: project(), runtime: this.options.runtime, request: string('request', 16_000) })
    }
    throw new MewcatToolError('MEWCAT_UNKNOWN_TOOL')
  }
  async rpc(line: string) {
    let request: { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string } }
    try { request = JSON.parse(line); if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid request') } catch { return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } }
    const response = (result: unknown) => ({ jsonrpc: '2.0', id: request.id ?? null, result })
    try {
      this.assertAccess()
      if (request.method === 'initialize') return response({ protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(request.params?.protocolVersion ?? '') ? request.params!.protocolVersion : '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mew', version: '1.0.0' } })
      if (request.method === 'ping') return response({})
      if (request.method === 'tools/list') return response({ tools: MEWCAT_TOOLS })
      if (request.method === 'tools/call') {
        const args = request.params?.arguments ?? {}
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new MewcatToolError('MEWCAT_INVALID_ARGUMENT')
        const result = await this.tool(request.params?.name ?? '', args)
        return response({ content: [{ type: 'text', text: JSON.stringify(result) }] })
      }
      return { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32601, message: 'Method not found' } }
    } catch (error) {
      const code = error instanceof MewcatToolError ? error.message : 'MEWCAT_ACTION_FAILED'
      return response({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code }) }] })
    }
  }
}

export async function bindMewcat(options: MewcatBindingOptions): Promise<MewcatBinding> {
  const key = JSON.stringify([options.account, options.browser, options.runtime])
  const previous = bindings.get(key)
  if (previous) { previous.options.superseded?.(); previous.disconnect(); previous.activate(options); return previous }
  const pending = starting.get(key)
  if (pending) { await pending; return bindMewcat(options) }
  const initialized = createMewcatBinding(options).then(binding => { bindings.set(key, binding); return binding }).finally(() => starting.delete(key))
  starting.set(key, initialized)
  return initialized
}

async function createMewcatBinding(options: MewcatBindingOptions): Promise<MewcatBinding> {
  const binding = new MewcatBinding(options)
  fs.mkdirSync(binding.cwd, { recursive: true, mode: 0o700 })
  fs.chmodSync(path.dirname(binding.cwd), 0o700)
  // Remove only a stale socket, never another running app's socket or a file.
  if (fs.existsSync(binding.socketPath)) {
    if (!fs.lstatSync(binding.socketPath).isSocket()) throw new MewcatToolError('MEWCAT_CONNECTION_FAILED')
    const alive = await new Promise<boolean>(resolve => {
      const probe = net.createConnection(binding.socketPath)
      probe.once('connect', () => { probe.destroy(); resolve(true) })
      probe.once('error', () => { probe.destroy(); resolve(false) })
    })
    if (alive) throw new MewcatToolError('MEWCAT_CONNECTION_FAILED')
    fs.rmSync(binding.socketPath)
  }
  await new Promise<void>((resolve, reject) => { binding.server.once('error', reject); binding.server.listen(binding.socketPath, () => { binding.server.off('error', reject); fs.chmodSync(binding.socketPath, 0o600); resolve() }) })
  return binding
}
