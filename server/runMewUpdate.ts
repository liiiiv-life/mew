import './config.ts'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { MEW_APP_ROOT, writeMewUpdateJob } from './mewUpdate.ts'

const startedAt = Date.now()
writeMewUpdateJob({ state: 'running', startedAt, finishedAt: null, message: null })

const child = spawn('bash', [path.join(MEW_APP_ROOT, 'mew'), 'update'], {
  cwd: MEW_APP_ROOT,
  env: { ...process.env, MEW_NODE: process.execPath, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let outputTail = ''
const remember = (chunk: Buffer) => {
  const text = chunk.toString()
  process.stdout.write(text)
  outputTail = `${outputTail}${text}`.slice(-8_000)
}
child.stdout.on('data', remember)
child.stderr.on('data', remember)

const result = await new Promise<{ code: number; message: string | null }>((resolve) => {
  child.once('error', (err) => resolve({ code: 1, message: err.message }))
  child.once('close', (code, signal) => resolve({
    code: code ?? 1,
    message: code === 0
      ? null
      : outputTail.trim() || (signal ? `업데이트가 ${signal} 신호로 종료되었습니다` : `업데이트 명령이 코드 ${code ?? 1}로 실패했습니다`),
  }))
})

writeMewUpdateJob({
  state: result.code === 0 ? 'succeeded' : 'failed',
  startedAt,
  finishedAt: Date.now(),
  message: result.message,
})
process.exitCode = result.code
