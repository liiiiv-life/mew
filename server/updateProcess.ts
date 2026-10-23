import path from 'node:path'
import { spawnHostProcess } from './platform/process.ts'
import type { SpawnSpec } from './agentRuntimes.ts'

/** Inherit terminal input while forwarding output and retaining only a bounded error tail. */
export async function runLoggedUpdate(spec: SpawnSpec, cwd: string): Promise<void> {
  const child = spawnHostProcess(spec.cmd, spec.args, {
    cwd,
    env: { ...process.env, MEW_NODE: process.execPath, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`, ...spec.env },
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  let tail = ''
  const remember = (chunk: Buffer, channel: NodeJS.WriteStream) => {
    channel.write(chunk)
    tail = `${tail}${chunk.toString()}`.slice(-8_000)
  }
  child.stdout?.on('data', chunk => remember(chunk, process.stdout))
  child.stderr?.on('data', chunk => remember(chunk, process.stderr))
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('업데이트 실행 시간이 초과됐습니다.')) }, 10 * 60_000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(tail.trim() || (signal ? `업데이트가 ${signal} 신호로 종료되었습니다` : `업데이트 명령이 코드 ${code ?? 1}로 실패했습니다`)))
    })
  })
}
