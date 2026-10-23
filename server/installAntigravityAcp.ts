import './config.ts'
import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { antigravityDistribution, antigravityInstallDir } from './antigravityAcp.ts'

const run = promisify(execFile)

/** Extract only a pinned official archive into a private staging directory, then publish it. */
export async function installAntigravityAcp() {
  const distribution = antigravityDistribution()
  const destination = antigravityInstallDir()
  const parent = path.dirname(destination)
  await fs.mkdir(parent, { recursive: true, mode: 0o700 })
  const staging = await fs.mkdtemp(path.join(parent, '.install-'))
  try {
    console.log('Antigravity 공식 ACP 서버 다운로드 중…')
    const response = await fetch(distribution.url, { redirect: 'error', signal: AbortSignal.timeout(8 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`Google 다운로드 실패: HTTP ${response.status}`)
    const archive = path.join(staging, 'download.zip')
    const total = Number(response.headers.get('content-length'))
    await pipeline(Readable.fromWeb(response.body as never), async function* (source) {
      let received = 0, lastReport = 0
      for await (const chunk of source) {
        received += chunk.length
        if (Date.now() - lastReport >= 1000) {
          const size = `${(received / 1024 / 1024).toFixed(1)} MiB`
          console.log(total > 0 ? `다운로드: ${size} / ${(total / 1024 / 1024).toFixed(1)} MiB (${Math.floor(received / total * 100)}%)` : `다운로드: ${size}`)
          lastReport = Date.now()
        }
        yield chunk
      }
    }, createWriteStream(archive, { mode: 0o600 }))
    console.log('다운로드 완료. 배포 파일 검사 중…')
    const { stdout } = await run('unzip', ['-Z1', archive], { maxBuffer: 8 * 1024 * 1024 })
    for (const name of stdout.trim().split('\n')) {
      if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('안전하지 않은 배포 파일 경로입니다')
    }
    const unpacked = path.join(staging, 'unpacked')
    await fs.mkdir(unpacked, { mode: 0o700 })
    console.log('압축 해제 중…')
    await run('unzip', ['-q', archive, '-d', unpacked], { timeout: 120_000 })
    console.log('실행 파일 확인 중…')
    for (const name of ['agy_acp_server.par', 'localharness_external']) {
      const command = path.join(unpacked, name)
      if (!(await fs.lstat(command)).isFile()) throw new Error(`공식 ACP 실행 파일이 없습니다: ${name}`)
      await fs.chmod(command, 0o700)
    }
    // Never remove an existing installation or user credentials on failure.
    await fs.rename(unpacked, destination)
    console.log('Antigravity 공식 ACP 서버를 설치했습니다.')
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installAntigravityAcp().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
