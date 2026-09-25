import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { RUNTIMES } from './agentRuntimes.ts'
import { readAgentSettings } from './agentSettings.ts'
import { ensureCommitSkill, MEW_SKILLS_DIR } from './mew-skills.ts'
import { parseConfig, patchConfig, atKeys, object, type ConfigFormat } from './harness-config.ts'
import type { HarnessDetail, HarnessInventory, HarnessItem, HarnessKind, HarnessLocation, HarnessMutation, HarnessScope } from '../shared/agent-harness.ts'

const MAX_TEXT = 2 * 1024 * 1024
const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'coverage', 'archives', 'docs-editor'])
const identity = (...parts: unknown[]) => Buffer.from(JSON.stringify(parts)).toString('base64url')
const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
export class HarnessError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}
interface Location extends HarnessLocation { format?: ConfigFormat; keys?: string[] }
interface Entry extends HarnessItem { directory?: string }
interface Index extends HarnessInventory { locations: Location[]; items: Entry[] }
export interface HarnessEnvironment { home: string; env: NodeJS.ProcessEnv; runtimeEnvs?: Record<string, NodeJS.ProcessEnv>; mewSkillsDir?: string }

function exists(file: string) { try { fs.lstatSync(file); return true } catch { return false } }
function linked(file: string): boolean {
  let current = path.resolve(file)
  while (current !== path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) return true } catch { /* A new destination can be absent. */ }
    current = path.dirname(current)
  }
  return false
}
function readText(file: string): string {
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size > MAX_TEXT) throw new HarnessError('파일이 너무 크거나 일반 텍스트 파일이 아닙니다')
  return fs.readFileSync(file, 'utf8')
}
function assertWritable(file: string) {
  if (linked(file)) throw new HarnessError('심볼릭 링크는 원본 위치에서 관리하세요')
}
function atomicWrite(file: string, content: string) {
  assertWritable(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = path.join(path.dirname(file), `.mew-harness-${randomUUID()}`)
  const mode = exists(file) ? fs.statSync(file).mode & 0o777 : 0o600
  try { fs.writeFileSync(temp, content, { flag: 'wx', mode }); fs.renameSync(temp, file) }
  finally { if (exists(temp)) fs.unlinkSync(temp) }
}
function configText(location: Location) { return exists(location.path) ? readText(location.path) : '' }
function skillMetadata(content: string, fallback: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) return { name: fallback, description: '' }
  try {
    const meta = parseConfig(match[1], 'yaml')
    return { name: typeof meta.name === 'string' ? meta.name : fallback, description: typeof meta.description === 'string' ? meta.description : '' }
  } catch { return { name: fallback, description: 'Frontmatter 문법 확인 필요' } }
}
function skillSnapshot(directory: string) {
  const hash = createHash('sha256'), files: string[] = []
  let size = 0
  function visit(folder: string) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name), relative = path.relative(directory, file)
      if (files.length > 2000) throw new HarnessError('스킬 파일 수가 너무 많습니다')
      if (entry.isSymbolicLink()) { files.push(relative); hash.update(relative).update(fs.readlinkSync(file)); continue }
      if (entry.isDirectory()) { hash.update(`dir:${relative}\0`); visit(file); continue }
      if (!entry.isFile()) throw new HarnessError('특수 파일을 포함한 스킬은 관리할 수 없습니다')
      size += fs.statSync(file).size
      if (size > 32 * 1024 * 1024) throw new HarnessError('스킬 폴더가 32MB를 초과합니다')
      files.push(relative)
      hash.update(`${relative}\0`).update(fs.readFileSync(file))
    }
  }
  visit(directory)
  return { revision: hash.digest('hex'), files }
}

/** Native source files remain the source of truth. This service never launches an agent or MCP process. */
export class AgentHarnessStore {
  environment?: HarnessEnvironment
  constructor(environment?: HarnessEnvironment) { this.environment = environment }

  async index(cwd: string, kind: HarnessKind): Promise<Index> {
    const root = path.resolve(cwd)
    if (!fs.statSync(root).isDirectory()) throw new HarnessError('프로젝트 폴더를 찾을 수 없습니다')
    const { home, env, runtimeEnvs } = this.environment ?? { home: os.homedir(), env: process.env, runtimeEnvs: Object.fromEntries(Object.entries(readAgentSettings()).map(([id, setting]) => [id, setting.env ?? {}])) }
    const envFor = (agent: string): NodeJS.ProcessEnv => ({ ...env, ...(agent === 'claude' && env.MEW_AGENT_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: env.MEW_AGENT_CONFIG_DIR } : {}), ...runtimeEnvs?.[agent] })
    const codexEnv = envFor('codex'), claudeEnv = envFor('claude'), kimiEnv = envFor('kimi'), hermesEnv = envFor('hermes'), openclawEnv = envFor('openclaw')
    const scopes: HarnessScope[] = [{ id: 'global', label: '전역', path: home, global: true }, { id: root, label: path.basename(root), path: root, global: false }]
    const warnings: string[] = []
    let visited = 0, truncated = false
    const walk = async (directory: string, depth: number) => {
      if (++visited > 12000 || depth > 16) { truncated = true; return }
      let entries: fs.Dirent[]
      try { entries = await fsp.readdir(directory, { withFileTypes: true }) } catch { warnings.push(`폴더를 읽을 수 없습니다: ${directory}`); return }
      const names = new Set(entries.map(entry => entry.name))
      if (directory !== root && ['.mew', '.git', '.agents', '.claude', '.codex', '.cursor', '.opencode', '.kimi', '.kimi-code', '.agent', '.prime', '.mcp.json', 'opencode.json', 'opencode.jsonc'].some(name => names.has(name))) {
        scopes.push({ id: directory, label: path.relative(root, directory), path: directory, global: false })
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIP.has(entry.name) && entry.name !== 'skills') await walk(path.join(directory, entry.name), depth + 1)
        if (visited > 12000) break
      }
    }
    await walk(root, 0)
    if (truncated) warnings.push('탐색 한도에 도달했습니다. 누락된 폴더를 현재 작업 경로로 열어 확인하세요.')
    const locations: Location[] = [], items: Entry[] = []
    const add = (scope: HarnessScope, agent: string, file: string, label: string, format?: ConfigFormat, keys?: string[], reason?: string) => {
      if (kind === 'mcp' && !format || kind === 'skills' && format) return
      const location: Location = { id: identity(kind, scope.id, agent, file, keys), kind, scope: scope.id, agent, label, path: file, writable: !reason && !linked(file), reason: reason || (linked(file) ? '심볼릭 링크' : undefined), format, keys }
      if (!locations.some(value => value.id === location.id)) locations.push(location)
    }
    const codexHome = codexEnv.CODEX_HOME || path.join(home, '.codex')
    const claudeHome = claudeEnv.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
    const claudeConfig = claudeEnv.CLAUDE_CONFIG_DIR ? path.join(claudeHome, '.claude.json') : path.join(home, '.claude.json')
    const configHome = envFor('opencode').XDG_CONFIG_HOME || path.join(home, '.config')
    const geminiHome = envFor('antigravity').GEMINI_HOME || path.join(home, '.gemini')
    for (const scope of scopes) {
      const global = scope.global, base = global ? home : scope.path
      add(scope, 'shared', path.join(base, '.agents/skills'), '공통')
      add(scope, 'codex', path.join(global ? codexHome : path.join(base, '.codex'), 'skills'), 'Codex')
      add(scope, 'claude', path.join(global ? claudeHome : path.join(base, '.claude'), 'skills'), 'Claude')
      add(scope, 'cursor', path.join(base, '.cursor/skills'), 'Cursor')
      add(scope, 'prime', path.join(base, '.prime/agent/skills'), 'Prime Agent')
      add(scope, 'opencode', path.join(global ? path.join(configHome, 'opencode') : path.join(base, '.opencode'), 'skills'), 'OpenCode')
      add(scope, 'kimi', path.join(global ? kimiEnv.KIMI_CODE_HOME || path.join(home, '.kimi-code') : path.join(base, '.kimi-code'), 'skills'), 'Kimi Code')
      if (exists(path.join(base, '.kimi/skills'))) add(scope, 'kimi', path.join(base, '.kimi/skills'), 'Kimi (이전 경로)')
      add(scope, 'antigravity', global ? path.join(geminiHome, 'antigravity/skills') : path.join(base, '.agent/skills'), 'Antigravity')
      if (global && exists(path.join(home, '.gemini/antigravity-cli/skills'))) add(scope, 'antigravity', path.join(home, '.gemini/antigravity-cli/skills'), 'Antigravity CLI')
      if (global) {
        add(scope, 'hermes', path.join(hermesEnv.HERMES_HOME || path.join(home, '.hermes'), 'skills'), 'Hermes')
        add(scope, 'openclaw', path.join(openclawEnv.OPENCLAW_STATE_DIR || path.join(home, '.openclaw'), 'skills'), 'OpenClaw')
      } else add(scope, 'openclaw', path.join(base, 'skills'), 'OpenClaw')
      add(scope, 'codex', path.join(global ? codexHome : path.join(base, '.codex'), 'config.toml'), 'Codex', 'toml', ['mcp_servers'])
      add(scope, 'claude', global ? claudeConfig : path.join(base, '.mcp.json'), global ? 'Claude' : 'Claude · 프로젝트 공유', 'json', ['mcpServers'])
      if (!global) add(scope, 'claude', claudeConfig, 'Claude · 프로젝트 개인', 'json', ['projects', base, 'mcpServers'])
      add(scope, 'cursor', path.join(base, '.cursor/mcp.json'), 'Cursor', 'json', ['mcpServers'])
      add(scope, 'prime', path.join(base, '.prime/agent/settings.json'), 'Prime Agent', 'jsonc', ['mcpServers'])
      for (const ext of ['json', 'jsonc'] as const) add(scope, 'opencode', path.join(global ? path.join(configHome, 'opencode') : base, `opencode.${ext}`), `OpenCode · ${ext}`, ext, ['mcp'])
      add(scope, 'kimi', path.join(global ? kimiEnv.KIMI_CODE_HOME || path.join(home, '.kimi-code') : path.join(base, '.kimi-code'), 'mcp.json'), 'Kimi Code', 'json', ['mcpServers'])
      if (exists(path.join(base, '.kimi/mcp.json'))) add(scope, 'kimi', path.join(base, '.kimi/mcp.json'), 'Kimi (이전 경로)', 'json', ['mcpServers'])
      add(scope, 'antigravity', global ? path.join(geminiHome, 'config/mcp_config.json') : path.join(base, '.agents/mcp_config.json'), 'Antigravity · CLI/IDE', 'json', ['mcpServers'])
      if (global) {
        if (exists(path.join(home, '.gemini/antigravity/mcp_config.json'))) add(scope, 'antigravity', path.join(home, '.gemini/antigravity/mcp_config.json'), 'Antigravity (이전 경로)', 'json', ['mcpServers'])
        add(scope, 'hermes', path.join(hermesEnv.HERMES_HOME || path.join(home, '.hermes'), 'config.yaml'), 'Hermes', 'yaml', ['mcp_servers'])
        add(scope, 'openclaw', openclawEnv.OPENCLAW_CONFIG_PATH || path.join(openclawEnv.OPENCLAW_STATE_DIR || path.join(home, '.openclaw'), 'openclaw.json'), 'OpenClaw', 'json5', ['mcp', 'servers'])
      }
    }
    // Package-owned skill trees are discoverable, but installation remains the package manager's job.
    for (const [agent, cache] of [['codex', path.join(codexHome, 'plugins/cache')], ['claude', path.join(claudeHome, 'plugins/cache')]]) {
      if (!exists(cache)) continue
      if (kind === 'skills') add(scopes[0], agent, cache, `${agent} · 플러그인`, undefined, undefined, '플러그인에서 관리')
      else {
        let visited = 0
        const scan = async (directory: string, depth: number) => {
          if (++visited > 6000 || depth > 8) return
          try {
            for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
              if (entry.isFile() && ['.mcp.json', 'mcp.json', 'mcp_config.json'].includes(entry.name)) add(scopes[0], agent, path.join(directory, entry.name), `${agent} · 플러그인 · ${path.relative(cache, directory)}`, 'json', ['mcpServers'], '플러그인에서 관리')
              else if (entry.isDirectory() && !SKIP.has(entry.name) && entry.name !== '.git') await scan(path.join(directory, entry.name), depth + 1)
            }
          } catch { warnings.push(`플러그인 설정을 읽을 수 없습니다: ${directory}`) }
        }
        await scan(cache, 0)
      }
    }
    if (kind === 'skills') {
      const skillsRoot = this.environment?.mewSkillsDir ?? (this.environment ? path.join(home, '.mew-skills') : MEW_SKILLS_DIR)
      const commitPath = ensureCommitSkill(skillsRoot)
      const scope = { id: 'mew', label: 'Mew', path: skillsRoot, global: false }
      scopes.unshift(scope)
      add(scope, 'mew', skillsRoot, 'Mew')
      // The fixed entrypoint is editable, but cannot be moved/deleted by generic harness actions.
      const location = locations.find(location => location.agent === 'mew')!
      items.push({ id: identity(location.id, 'commit'), location: location.id, ...skillMetadata(readText(commitPath), 'commit'), name: 'commit', path: commitPath, writable: !linked(commitPath), managed: true })
    }
    for (const location of locations) {
      if (location.agent === 'mew') continue
      if (kind === 'skills') await this.scanSkills(location, items, warnings)
      else if (exists(location.path)) {
        try {
          const servers = atKeys(parseConfig(configText(location), location.format!), location.keys!)
          for (const name of Object.keys(servers)) {
            const config = object(servers[name])
            const transport = config.command ? 'stdio' : config.url || config.serverUrl || config.httpUrl ? 'HTTP' : '설정 확인 필요'
            items.push({ id: identity(location.id, name), location: location.id, name, description: `${transport}${config.enabled === false || config.disabled === true ? ' · 비활성 설정' : ''}`, path: location.path, writable: location.writable, reason: location.reason })
          }
        } catch { warnings.push(`설정 문법 또는 읽기 권한을 확인하세요: ${location.path}`) }
      }
    }
    return { scopes, agents: [...(kind === 'skills' ? [{ id: 'mew', label: 'Mew' }] : []), { id: 'shared', label: '공통' }, ...Object.values(RUNTIMES).filter(runtime => runtime.id !== 'tmux').map(({ id, label }) => ({ id, label }))], locations, items: items.sort((a, b) => a.name.localeCompare(b.name)), warnings: [...new Set(warnings)] }
  }

  private async scanSkills(location: Location, items: Entry[], warnings: string[]) {
    if (!exists(location.path)) return
    let visited = 0
    const seen = new Set<string>()
    const walk = async (directory: string, depth: number, inheritedReadOnly: boolean) => {
      if (++visited > 6000 || depth > 10) { if (visited === 6001) warnings.push(`스킬 탐색 한도: ${location.path}`); return }
      try {
        const real = await fsp.realpath(directory)
        if (seen.has(real)) return
        seen.add(real)
        const file = path.join(directory, 'SKILL.md')
        if (exists(file)) {
          const readonly = inheritedReadOnly || linked(file) || directory === location.path
          const metadata = skillMetadata(readText(file), path.basename(directory))
          items.push({ id: identity(location.id, path.relative(location.path, directory)), location: location.id, ...metadata, path: file, directory, writable: location.writable && !readonly, reason: location.reason || (readonly ? '시스템 스킬 또는 심볼릭 링크' : undefined) })
          return
        }
        for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
          if (entry.name === '.git' || entry.name === 'node_modules') continue
          if (directory === location.path && ['prime', 'kimi'].includes(location.agent) && entry.isFile() && entry.name.endsWith('.md') && !exists(path.join(directory, entry.name.slice(0, -3), 'SKILL.md'))) {
            const flat = path.join(directory, entry.name)
            items.push({ id: identity(location.id, entry.name), location: location.id, ...skillMetadata(readText(flat), entry.name.slice(0, -3)), path: flat, writable: location.writable, reason: location.reason })
          }
          if (entry.isDirectory() || entry.isSymbolicLink() && fs.statSync(path.join(directory, entry.name)).isDirectory()) await walk(path.join(directory, entry.name), depth + 1, inheritedReadOnly || entry.name === '.system' || entry.isSymbolicLink())
        }
      } catch { warnings.push(`스킬을 읽을 수 없습니다: ${directory}`) }
    }
    await walk(location.path, 0, !location.writable)
  }

  async list(cwd: string, kind: HarnessKind): Promise<HarnessInventory> {
    const index = await this.index(cwd, kind)
    return { ...index, locations: index.locations.map(({ format: _format, keys: _keys, ...location }) => location), items: index.items.map(({ directory: _directory, ...item }) => item) }
  }
  private find(index: Index, id: unknown) {
    const item = index.items.find(item => item.id === id)
    if (!item) throw new HarnessError('항목이 변경되었거나 삭제되었습니다. 새로고침하세요', 404)
    return { item, location: index.locations.find(location => location.id === item.location)! }
  }
  private read(item: Entry, location: Location): HarnessDetail {
    const { directory: _directory, ...publicItem } = item
    if (location.kind === 'skills') {
      const content = readText(item.path)
      return { item: publicItem, content, ...(item.directory ? skillSnapshot(item.directory) : { revision: digest(content), files: [path.basename(item.path)] }) }
    }
    const text = configText(location)
    const servers = atKeys(parseConfig(text, location.format!), location.keys!)
    return { item: publicItem, content: JSON.stringify(servers[item.name], null, 2), revision: digest(text), files: [] }
  }
  async detail(cwd: string, kind: HarnessKind, id: string) {
    const { item, location } = this.find(await this.index(cwd, kind), id)
    return this.read(item, location)
  }

  async mutate(input: HarnessMutation) {
    const index = await this.index(input.cwd, input.kind)
    if (!['create', 'save', 'move', 'delete'].includes(input.action)) throw new HarnessError('알 수 없는 작업입니다')
    const target = index.locations.find(location => location.id === input.target)
    if (input.action === 'create' || input.action === 'move') {
      if (target?.agent === 'mew') throw new HarnessError('Mew 기본 스킬은 기존 파일의 내용만 편집할 수 있습니다')
      if (!target?.writable) throw new HarnessError('쓸 수 있는 대상 위치를 선택하세요')
      assertWritable(target.path)
    }
    if (input.action === 'create') {
      const name = input.name?.trim() ?? ''
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(name)) throw new HarnessError('이름은 영문·숫자로 시작하며 영문·숫자·점·밑줄·하이픈 100자 이내여야 합니다')
      const content = this.content(input.content, input.kind, target!.agent)
      if (input.kind === 'skills') {
        const directory = path.join(target!.path, name)
        if (exists(directory)) throw new HarnessError('같은 이름의 스킬이 이미 있습니다', 409)
        fs.mkdirSync(target!.path, { recursive: true })
        fs.mkdirSync(directory)
        try { atomicWrite(path.join(directory, 'SKILL.md'), content) } catch (error) { fs.rmdirSync(directory); throw error }
      } else {
        const text = configText(target!)
        if (Object.hasOwn(atKeys(parseConfig(text, target!.format!), target!.keys!), name)) throw new HarnessError('같은 이름의 MCP가 이미 있습니다', 409)
        atomicWrite(target!.path, patchConfig(text, target!.format!, target!.keys!, name, JSON.parse(content)))
      }
      return
    }
    const { item, location } = this.find(index, input.id)
    if (item.managed && input.action !== 'save') throw new HarnessError('Mew 기본 스킬은 이동·삭제할 수 없습니다. 내용을 편집하세요.')
    if (!item.writable) throw new HarnessError(item.reason || '읽기 전용 항목입니다')
    assertWritable(item.path)
    const detail = this.read(item, location)
    if (typeof input.revision !== 'string' || detail.revision !== input.revision) throw new HarnessError('다른 곳에서 변경되었습니다. 새로고침 후 다시 시도하세요', 409)
    if (input.action === 'save') {
      const content = this.content(input.content, input.kind, location.agent)
      atomicWrite(item.path, input.kind === 'skills' ? content : patchConfig(configText(location), location.format!, location.keys!, item.name, JSON.parse(content)))
    } else if (input.kind === 'skills') {
      if (!item.directory) {
        if (input.action === 'delete') fs.unlinkSync(item.path)
        else {
          const destination = path.join(target!.path, path.basename(item.path, '.md'))
          if (exists(destination)) throw new HarnessError('대상에 같은 이름의 스킬이 있습니다', 409)
          fs.mkdirSync(target!.path, { recursive: true }); fs.mkdirSync(destination)
          try { fs.renameSync(item.path, path.join(destination, 'SKILL.md')) } catch (error) { fs.rmdirSync(destination); throw error }
        }
        return
      }
      // A directory move carries scripts/assets. Reject links inside it because moving relative links changes their meaning.
      if (detail.files.some(file => fs.lstatSync(path.join(item.directory!, file)).isSymbolicLink())) throw new HarnessError('링크를 포함한 스킬은 원본 폴더에서 이동·삭제하세요')
      if (input.action === 'delete') fs.rmSync(item.directory!, { recursive: true })
      else {
        const destination = path.join(target!.path, path.basename(item.directory!))
        if (exists(destination)) throw new HarnessError('대상에 같은 이름의 스킬이 있습니다', 409)
        if (destination.startsWith(`${item.directory!}${path.sep}`)) throw new HarnessError('스킬 내부로 옮길 수 없습니다')
        fs.mkdirSync(target!.path, { recursive: true })
        // Rename is atomic. Cross-device moves fail without deleting or partially copying the source.
        try { fs.renameSync(item.directory!, destination) } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EXDEV') throw new HarnessError('다른 디스크 간 이동은 지원하지 않습니다. 파일 탐색기에서 복사 후 확인하세요')
          throw error
        }
      }
    } else {
      const sourceText = configText(location)
      const removed = patchConfig(sourceText, location.format!, location.keys!, item.name, undefined)
      if (input.action === 'delete') { atomicWrite(location.path, removed); return }
      if (location.agent !== target!.agent) throw new HarnessError('MCP 이동은 같은 에이전트의 스코프 사이에서 지원합니다')
      if (location.id === target!.id) throw new HarnessError('다른 위치를 선택하세요')
      const targetText = configText(target!)
      if (Object.hasOwn(atKeys(parseConfig(targetText, target!.format!), target!.keys!), item.name)) throw new HarnessError('대상에 같은 이름의 MCP가 있습니다', 409)
      const combined = patchConfig(location.path === target!.path ? removed : targetText, target!.format!, target!.keys!, item.name, JSON.parse(detail.content))
      if (location.path === target!.path) atomicWrite(location.path, combined)
      else {
        atomicWrite(target!.path, combined)
        try { atomicWrite(location.path, removed) } catch {
          // Never remove the only surviving copy. Keep both and report exactly what happened.
          throw new HarnessError('대상에 복사했지만 원본 삭제에 실패했습니다. 두 위치를 확인하세요', 409)
        }
      }
    }
  }
  private content(value: unknown, kind: HarnessKind, agent: string): string {
    if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_TEXT) throw new HarnessError('내용은 2MB 이하의 텍스트여야 합니다')
    if (kind === 'mcp') {
      let config: Record<string, unknown>
      try { config = object(JSON.parse(value)) } catch { throw new HarnessError('MCP 설정은 올바른 JSON 객체여야 합니다') }
      const command = typeof config.command === 'string' && config.command.trim()
      const commandArray = Array.isArray(config.command) && config.command.length > 0 && config.command.every(value => typeof value === 'string' && value.trim())
      const remote = ['url', 'serverUrl', 'httpUrl'].some(key => typeof config[key] === 'string' && config[key].trim())
      if (!command && !commandArray && !remote) throw new HarnessError('command 또는 서버 URL이 필요합니다')
      if (config.args !== undefined && (!Array.isArray(config.args) || !config.args.every(value => typeof value === 'string'))) throw new HarnessError('args는 문자열 배열이어야 합니다')
      if (agent === 'opencode' && !(config.type === 'local' && commandArray || config.type === 'remote' && typeof config.url === 'string' && config.url.trim())) throw new HarnessError('OpenCode는 type: local과 command 배열 또는 type: remote와 url을 사용합니다')
      if (agent === 'claude' && remote && !['http', 'sse', 'streamable-http'].includes(String(config.type))) throw new HarnessError('Claude 원격 MCP의 type은 http 또는 sse여야 합니다')
      if (agent === 'antigravity' && remote && !config.serverUrl) throw new HarnessError('Antigravity 원격 MCP는 serverUrl을 사용합니다')
    }
    return value
  }
}
