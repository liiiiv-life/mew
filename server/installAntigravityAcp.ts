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
    const response = await fetch(distribution.url, { redirect: 'error', signal: AbortSignal.timeout(8 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`Google 다운로드 실패: HTTP ${response.status}`)
    const archive = path.join(staging, 'download.zip')
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(archive, { mode: 0o600 }))
    const { stdout } = await run('unzip', ['-Z1', archive], { maxBuffer: 8 * 1024 * 1024 })
    for (const name of stdout.trim().split('\n')) {
      if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new Error('안전하지 않은 배포 파일 경로입니다')
    }
    const unpacked = path.join(staging, 'unpacked')
    await fs.mkdir(unpacked, { mode: 0o700 })
    await run('unzip', ['-q', archive, '-d', unpacked], { timeout: 120_000 })
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
