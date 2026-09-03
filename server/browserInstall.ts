#!/usr/bin/env node
// Mew 전용 Chrome for Testing을 DATA_DIR 아래 설치한다. npm 패키지나 레포에는 브라우저를 넣지 않는다.
import './config.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DATA_DIR, writeFileAtomic } from './dataDir.ts'
import { browserExecutableStatus } from './browserRuntime.ts'

const DOWNLOADS_URL = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'
const BROWSER_DIR = path.join(DATA_DIR, 'browser')
const RUNTIME_DIR = path.join(BROWSER_DIR, 'runtime')
const POINTER_FILE = path.join(BROWSER_DIR, 'runtime.json')

type Download = { platform: string; url: string }
type Metadata = { channels?: { Stable?: { version?: string; downloads?: { chrome?: Download[] } } } }

function target(): { platform: string; executable: string } {
  if (process.platform === 'linux' && process.arch === 'x64') return { platform: 'linux64', executable: 'chrome-linux64/chrome' }
  if (process.platform === 'darwin' && process.arch === 'arm64') return { platform: 'mac-arm64', executable: 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' }
  if (process.platform === 'darwin' && process.arch === 'x64') return { platform: 'mac-x64', executable: 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' }
  throw new Error(`관리형 서버 브라우저를 지원하지 않는 환경입니다: ${process.platform}/${process.arch}. MEW_BROWSER_EXECUTABLE에 Chromium 절대경로를 지정하세요.`)
}

async function install(): Promise<void> {
  const wanted = target()
  fs.mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 })
  fs.chmodSync(BROWSER_DIR, 0o700)
  process.stdout.write('Chrome for Testing 안정 버전을 확인하는 중…\n')
  const metadataResponse = await fetch(DOWNLOADS_URL)
  if (!metadataResponse.ok) throw new Error(`브라우저 버전 목록을 받지 못했습니다: HTTP ${metadataResponse.status}`)
  const metadata = await metadataResponse.json() as Metadata
  const stable = metadata.channels?.Stable
  const version = stable?.version
  const download = stable?.downloads?.chrome?.find((item) => item.platform === wanted.platform)
  if (!version || !/^[0-9.]+$/.test(version) || !download?.url.startsWith('https://')) throw new Error('안정 버전 다운로드 정보를 찾지 못했습니다.')

  const versionDir = path.join(RUNTIME_DIR, version)
  const executable = path.join(versionDir, wanted.executable)
  if (!fs.existsSync(executable)) {
    const staging = fs.mkdtempSync(path.join(BROWSER_DIR, 'download-'))
    const archive = path.join(staging, 'chrome.zip')
    const unpacked = path.join(staging, 'unpacked')
    try {
      process.stdout.write(`Chrome ${version} 다운로드 중…\n`)
      const response = await fetch(download.url)
      if (!response.ok || !response.body) throw new Error(`브라우저를 받지 못했습니다: HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive, { mode: 0o600 }))
      fs.mkdirSync(unpacked, { mode: 0o700 })
      const unzip = spawnSync('unzip', ['-q', archive, '-d', unpacked], { stdio: 'inherit' })
      if (unzip.error && (unzip.error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('unzip이 없습니다. 먼저 설치한 뒤 다시 실행하세요.')
      if (unzip.status !== 0) throw new Error(`브라우저 압축을 풀지 못했습니다 (exit ${unzip.status ?? 'unknown'}).`)
      fs.renameSync(unpacked, versionDir)
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
  }
  fs.accessSync(executable, fs.constants.X_OK)
  writeFileAtomic(POINTER_FILE, `${JSON.stringify({ version, executable }, null, 2)}\n`)
  process.stdout.write(`설치 완료: ${executable}\n`)
  process.stdout.write('브라우저 창이 열려 있으면 몇 초 안에 새 런타임으로 다시 연결됩니다.\n')
}

function status(): void {
  const current = browserExecutableStatus()
  if (current.available) process.stdout.write(`available: ${current.executable}\n`)
  else {
    process.stdout.write('not installed\n')
    process.stdout.write('install: ./mew browser install\n')
    process.exitCode = 1
  }
}

if (os.platform() !== process.platform) throw new Error('플랫폼 판별에 실패했습니다.')
const command = process.argv[2] ?? 'status'
if (command === 'install') await install()
else if (command === 'status') status()
else throw new Error('사용법: ./mew browser install|status')
