import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const CRONTAB_BIN = 'crontab'

/** 서버 프로세스 사용자의 crontab을 읽는다. 크론탭 자체가 없으면 빈 문자열(정상 상태). */
export async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await exec(CRONTAB_BIN, ['-l'])
    return stdout
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/no crontab for/i.test(message)) return ''
    throw err
  }
}

/** crontab -로 표준입력에 새 내용을 흘려 통째로 대체한다. */
export function writeCrontab(text: string): Promise<void> {
  const body = text.endsWith('\n') || text === '' ? text : `${text}\n`
  return new Promise((resolve, reject) => {
    const child = spawn(CRONTAB_BIN, ['-'], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `crontab - exited with code ${code}`))
    })
    child.stdin.write(body)
    child.stdin.end()
  })
}
