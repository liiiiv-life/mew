import { processes as windows } from './windows/process.ts'
import { processes as posix } from './posix/process.ts'
import { execFile, type ExecFileOptions } from 'node:child_process'
import { promisify } from 'node:util'
import { StringDecoder } from 'node:string_decoder'

const processes = process.platform === 'win32' ? windows : posix
export const spawnHostProcess = processes.spawn
export const processGroupAlive = processes.groupAlive
export const stopProcessGroup = processes.stopGroup
const execute = promisify(execFile)
export async function execHostFile(command: string, args: string[], options: ExecFileOptions & { onOutput?: (text: string) => void } = {}): Promise<{ stdout: string; stderr: string }> {
  if (process.platform !== 'win32') {
    const pending = execute(command, args, { ...options, encoding: 'utf8' })
    if (options.onOutput) {
      pending.child.stdout?.setEncoding('utf8').on('data', options.onOutput)
      pending.child.stderr?.setEncoding('utf8').on('data', options.onOutput)
    }
    const result = await pending
    return { stdout: result.stdout, stderr: result.stderr }
  }
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', bytes = 0, failed = false
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
    const child = spawnHostProcess(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const fail = (error: Error) => { if (failed) return; failed = true; clearTimeout(timer); if (child.pid) stopProcessGroup(child.pid); reject(Object.assign(error, { stdout, stderr })) }
    const timer = options.timeout ? setTimeout(() => fail(new Error('명령 실행 시간이 초과됐습니다.')), options.timeout) : undefined
    const output = (chunk: Buffer, channel: 'stdout' | 'stderr') => {
      bytes += chunk.length
      if (bytes > (options.maxBuffer ?? 1024 * 1024)) { fail(new Error('명령 출력이 너무 큽니다.')); return }
      const text = decoders[channel].write(chunk)
      if (channel === 'stdout') stdout += text; else stderr += text
      options.onOutput?.(text)
    }
    child.stdout?.on('data', chunk => output(chunk, 'stdout')); child.stderr?.on('data', chunk => output(chunk, 'stderr'))
    child.once('error', fail)
    child.once('close', code => {
      clearTimeout(timer)
      if (failed) return
      const outTail = decoders.stdout.end(), errTail = decoders.stderr.end()
      stdout += outTail; stderr += errTail
      if (outTail || errTail) options.onOutput?.(outTail + errTail)
      if (code === 0) resolve({ stdout, stderr })
      else { failed = true; reject(Object.assign(new Error(`명령 실행 실패 (${code})`), { stdout, stderr, code })) }
    })
  })
}
