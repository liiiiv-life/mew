import fs from 'node:fs/promises'
import path from 'node:path'
import { parse, type ParseError } from 'jsonc-parser'
import type { DebugProfile } from '../shared/debugger.ts'

export function expandDebugConfiguration(configuration: Record<string, unknown>, root: string, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 30) throw new Error('실행 설정의 중첩이 너무 깊습니다')
    if (typeof value === 'string') return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
      if (name === 'workspaceFolder') return root
      if (name === 'workspaceFolderBasename') return path.basename(root)
      if (/^env:[A-Za-z_][\w]*$/.test(name)) { const found = env[name.slice(4)]; if (found === undefined) throw new Error(`환경 변수가 없습니다: ${name.slice(4)}`); return found }
      throw new Error(`지원하지 않는 실행 변수: ${name}`)
    })
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, depth + 1)]))
    return value
  }
  const result = visit(configuration, 0) as Record<string, unknown>
  if (JSON.stringify(result).length > 128000) throw new Error('치환된 실행 설정이 너무 큽니다')
  return result
}
export async function importDebugProfiles(root: string, relative = '.vscode/launch.json'): Promise<{ profiles: DebugProfile[]; compounds: { name: string; profiles: string[] }[] }> {
  if (typeof relative !== 'string' || relative.length > 4096 || path.isAbsolute(relative)) throw new Error('프로젝트 상대 경로를 입력하세요')
  const base = await fs.realpath(root), file = await fs.realpath(path.resolve(root, relative))
  if (!file.startsWith(base + path.sep)) throw new Error('프로젝트 안의 설정 파일만 가져올 수 있습니다')
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('설정 파일이 없거나 너무 큽니다')
  const errors: ParseError[] = [], value = parse(await fs.readFile(file, 'utf8'), errors, { allowTrailingComma: true })
  if (errors.length || !Array.isArray(value?.configurations)) throw new Error('launch.json의 configurations 배열이 필요합니다')
  const profiles: DebugProfile[] = value.configurations.map((entry: Record<string, unknown>, i: number) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !['launch', 'attach'].includes(String(entry.request))) throw new Error(`실행 모드를 확인하세요: configuration ${i + 1}`)
    const { name, request, preLaunchTask, postDebugTask, ...configuration } = entry
    if (preLaunchTask || postDebugTask) throw new Error('자동 실행 태스크가 있는 프로필은 가져올 수 없습니다. 태스크를 별도로 실행한 뒤 실행 설정만 가져오세요.')
    if (typeof name !== 'string' || !name.trim() || name.length > 128 || JSON.stringify(configuration).length > 64000) throw new Error('잘못된 실행 프로필')
    return { name, request: request as DebugProfile['request'], configuration }
  })
  if (profiles.length > 32 || new Set(profiles.map(p => p.name)).size !== profiles.length) throw new Error('프로필은 고유 이름으로 최대 32개까지 가져올 수 있습니다')
  const compounds = (value.compounds ?? []).map((entry: any) => {
    if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.length > 128 || !Array.isArray(entry.configurations) || !entry.configurations.length || entry.configurations.length > 8 || entry.configurations.some((name: unknown) => !profiles.some(p => p.name === name)) || entry.preLaunchTask || entry.stopAll) throw new Error('복합 프로필 이름·구성을 확인하세요. 자동 태스크·stopAll은 지원하지 않습니다.')
    return { name: entry.name, profiles: entry.configurations }
  })
  if (compounds.length > 32) throw new Error('복합 프로필은 최대 32개입니다')
  return { profiles, compounds }
}
export function testDebugProfile(root: string, runner: string, file: string, name = ''): DebugProfile {
  if (!['node', 'vitest', 'pytest', 'go'].includes(runner) || typeof file !== 'string' || !file.trim() || file.length > 4096 || file.includes('\0') || typeof name !== 'string' || name.length > 1024 || name.includes('\0')) throw new Error('테스트 실행기·파일·이름을 확인하세요')
  const full = path.resolve(root, file)
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error('프로젝트 안의 테스트 파일을 선택하세요')
  const pattern = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const configuration: Record<string, unknown> = runner === 'node' ? { type: 'pwa-node', cwd: root, program: full, console: 'internalConsole', runtimeArgs: ['--test', '--test-concurrency=1', ...(name ? ['--test-name-pattern', pattern] : [])] }
    : runner === 'vitest' ? { type: 'pwa-node', cwd: root, program: path.join(root, 'node_modules/vitest/vitest.mjs'), console: 'internalConsole', autoAttachChildProcesses: true, args: ['run', full, '--no-file-parallelism', '--test-timeout=0', ...(name ? ['-t', pattern] : [])] }
    : runner === 'pytest' ? { type: 'python', cwd: root, module: 'pytest', justMyCode: true, args: [full, '-s', ...(name ? ['-k', name] : [])] }
    : { type: 'go', cwd: root, mode: 'test', program: path.dirname(full), args: [...(name ? ['-test.run', `^${pattern}$`] : [])] }
  return { name: `${runner} · ${path.basename(full)}${name ? ` · ${name}` : ''}`.slice(0, 128), request: 'launch', configuration }
}
