import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { RUNTIMES, findExecutable, resolvedSpec } from './agentRuntimes.ts'

const run = promisify(execFile)
const installing = new Set<string>()

export type RuntimeStatus = {
  id: string
  label: string
  installed: boolean
  installing: boolean
  installable: boolean
}

function executableExists(command: string): boolean {
  if (!path.isAbsolute(command)) return findExecutable(command) !== null
  try {
    fs.accessSync(command, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function runtimeStatuses(): RuntimeStatus[] {
  return Object.values(RUNTIMES).map((runtime) => ({
    id: runtime.id,
    label: runtime.label,
    // 설정 화면에서 바꾼 실행 파일 기준으로 판정한다 — 저장한 경로가 실제로 있는지가 "설치됨"이다
    installed: executableExists(resolvedSpec(runtime.id)?.cmd ?? runtime.spec().cmd),
    installing: installing.has(runtime.id),
    installable: runtime.install !== undefined,
  }))
}

export class RuntimeInstallError extends Error {}

/** 등록표의 고정 명령만 실행한다. runtime id 외의 인자는 HTTP에서 받지 않는다. */
export async function installRuntime(id: string): Promise<{ status: RuntimeStatus; output: string }> {
  const runtime = RUNTIMES[id]
  if (!runtime) throw new RuntimeInstallError('알 수 없는 에이전트 런타임입니다')
  const before = runtimeStatuses().find((item) => item.id === id)!
  if (before.installed) return { status: before, output: '이미 설치되어 있습니다.' }
  if (!runtime.install) throw new RuntimeInstallError('자동 설치를 지원하지 않는 런타임입니다')
  if (installing.has(id)) throw new RuntimeInstallError('이 런타임을 설치하고 있습니다')

  installing.add(id)
  try {
    const spec = runtime.install()
    const result = await run(spec.cmd, spec.args, {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, ...spec.env },
      timeout: 10 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const status = runtimeStatuses().find((item) => item.id === id)!
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().slice(-12_000)
    if (!status.installed) throw new RuntimeInstallError(output || '설치는 끝났지만 실행 파일을 찾지 못했습니다')
    return { status: { ...status, installing: false }, output }
  } catch (err) {
    if (err instanceof RuntimeInstallError) throw err
    const detail = err as Error & { stdout?: string; stderr?: string }
    const output = `${detail.stdout ?? ''}\n${detail.stderr ?? ''}`.trim().slice(-12_000)
    throw new RuntimeInstallError(output || detail.message)
  } finally {
    installing.delete(id)
  }
}
