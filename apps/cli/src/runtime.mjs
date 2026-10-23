import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Transform } from 'node:stream'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream, constants } from 'node:fs'
import * as tar from 'tar'

const repository = 'https://github.com/s-saens/mew/releases/download'
const archiveLimit = 1024 * 1024 * 1024

export function runtimeTarget(platform = process.platform, arch = process.arch, nodeVersion = process.versions.node, glibc = process.report.getReport().header.glibcVersionRuntime, kernel = os.release()) {
  if (Number(nodeVersion.split('.')[0]) !== 24) throw new Error('Node.js 24가 필요합니다. https://nodejs.org')
  if (!['linux', 'darwin', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Linux·macOS·Windows x64/arm64를 지원합니다.')
  if (platform === 'linux' && !glibc) throw new Error('Linux glibc 환경이 필요합니다. Alpine/musl은 지원하지 않습니다.')
  if (platform === 'linux') {
    const [major, minor] = glibc.split('.').map(Number)
    if (major < 2 || major === 2 && minor < 35) throw new Error('Linux glibc 2.35 이상이 필요합니다. Ubuntu 22.04 이상을 사용하세요.')
  }
  if (platform === 'darwin' && Number(kernel.split('.')[0]) < 24) throw new Error('사전 빌드 실행본은 macOS 15 이상을 지원합니다. 이전 OS에서는 소스 설치를 사용하세요.')
  if (platform === 'win32' && (Number(kernel.split('.')[0]) < 10 || Number(kernel.split('.')[2]) < 17763)) throw new Error('Windows 10 1809 이상 또는 Windows 11이 필요합니다.')
  return { platform, arch, nodeMajor: 24 }
}

export function checksumFor(text, filename) {
  const matches = text.split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?([^\s]+)$/.exec(line)).filter(match => match?.[2] === filename)
  if (matches.length !== 1) throw new Error(`릴리스 체크섬을 확인하지 못했습니다: ${filename}`)
  return matches[0][1].toLowerCase()
}

export function safeArchiveEntry(name, entry, platform = process.platform) {
  const normalized = path.posix.normalize(name)
  if (name.includes('\\') || path.posix.isAbsolute(name) || normalized === '..' || normalized.startsWith('../')) throw new Error('실행 패키지에 잘못된 경로가 있습니다.')
  if (platform === 'win32' && (/[<>:"|?*]/.test(name) || Array.from(name).some(character => character.charCodeAt(0) < 32) || name.split('/').some(part => /[. ]$/.test(part) && part !== '.' || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)))) throw new Error('Windows 실행 패키지에 잘못된 파일 이름이 있습니다.')
  if (!['File', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type)) throw new Error('실행 패키지에 지원하지 않는 파일 형식이 있습니다.')
  if (entry.size > archiveLimit) throw new Error('실행 패키지의 파일이 너무 큽니다.')
  if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
    const link = entry.linkpath
    const target = path.posix.normalize(entry.type === 'Link' ? link : path.posix.join(path.posix.dirname(normalized), link))
    if (!link || link.includes('\\') || path.posix.isAbsolute(link) || target === '..' || target.startsWith('../')) throw new Error('실행 패키지의 링크가 패키지 밖을 가리킵니다.')
  }
  return true
}

export async function validateRuntime(directory, version, target) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'mew-runtime.json'), 'utf8'))
  for (const [key, value] of Object.entries({ version, ...target, entrypoint: 'server/cli-host.js' })) {
    if (manifest[key] !== value) throw new Error(`실행 패키지 정보가 맞지 않습니다: ${key}`)
  }
  await Promise.all(['server/cli-host.js', 'dist/index.html'].map(file => fs.access(path.join(directory, file))))
  await fs.access(path.join(directory, 'bin', target.platform === 'win32' ? 'psmux.exe' : 'tmux'), constants.X_OK)
  if (target.platform === 'win32') await fs.access(path.join(directory, 'native/windows/process-host.exe'))
  return directory
}

export async function prepareRuntime({ cacheDir, version, target, fetchImpl = fetch, log = () => {}, releaseBase = repository }) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('잘못된 CLI 버전입니다.')
  const destination = path.join(cacheDir, `${version}-${target.platform}-${target.arch}-node${target.nodeMajor}`)
  let exists = true
  try { await fs.stat(destination) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    exists = false
  }
  if (exists) {
    try { return await validateRuntime(destination, version, target) } catch (error) {
      throw new Error(`캐시된 실행 패키지가 손상됐습니다. 이 폴더만 삭제하고 다시 실행하세요: ${destination}`, { cause: error })
    }
  }
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 })
  const temporary = await fs.mkdtemp(path.join(cacheDir, '.download-'))
  const filename = `mew-runtime-${target.platform}-${target.arch}.tar.gz`
  const base = `${releaseBase}/mew-cli-v${version}`
  const archive = path.join(temporary, 'runtime.tar.gz')
  const extracted = path.join(temporary, 'runtime')
  try {
    log(`mew ${version} 실행 패키지를 받는 중…`)
    const checksums = await fetchImpl(`${base}/SHA256SUMS`, { signal: AbortSignal.timeout(30_000) })
    if (!checksums.ok) throw new Error(`릴리스 ${version}을 받지 못했습니다 (HTTP ${checksums.status}). 아직 게시되지 않았거나 네트워크 연결이 끊겼습니다.`)
    const checksumText = await checksums.text()
    if (checksumText.length > 64 * 1024) throw new Error('릴리스 체크섬 목록이 너무 큽니다.')
    const expected = checksumFor(checksumText, filename)
    const response = await fetchImpl(`${base}/${filename}`, { signal: AbortSignal.timeout(10 * 60_000) })
    if (!response.ok || !response.body) throw new Error(`실행 패키지를 받지 못했습니다 (HTTP ${response.status}).`)
    const hash = createHash('sha256')
    let bytes = 0
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length
      if (bytes > archiveLimit) return callback(new Error('실행 패키지가 너무 큽니다.'))
      hash.update(chunk)
      callback(null, chunk)
    } }), createWriteStream(archive, { mode: 0o600 }))
    if (hash.digest('hex') !== expected) throw new Error('실행 패키지의 SHA-256 체크섬이 맞지 않습니다. 다시 실행하세요.')
    await fs.mkdir(extracted, { mode: 0o700 })
    let unpacked = 0, validationError
    await tar.x({ file: archive, cwd: extracted, strict: true, preservePaths: false, chmod: true, filter(name, entry) {
      if (validationError) return false
      try {
        unpacked += entry.size || 0
        if (unpacked > 4 * archiveLimit) throw new Error('압축 해제한 실행 패키지가 너무 큽니다.')
        if (target.platform === 'win32' && ['Link', 'SymbolicLink'].includes(entry.type)) throw new Error('Windows 실행 패키지는 junction 목록만 사용해야 합니다.')
        return safeArchiveEntry(name, entry, target.platform)
      } catch (error) { validationError = error; return false }
    } })
    if (validationError) throw validationError
    if (target.platform === 'win32') {
      const links = JSON.parse(await fs.readFile(path.join(extracted, 'runtime-links.json'), 'utf8'))
      if (!Array.isArray(links) || links.length > 100) throw new Error('Windows 실행본의 링크 목록이 잘못됐습니다.')
      const seen = new Set()
      for (const link of links) {
        if (typeof link?.path !== 'string' || typeof link.target !== 'string') throw new Error('Windows 실행본의 링크가 잘못됐습니다.')
        safeArchiveEntry(link.path, { type: 'SymbolicLink', linkpath: link.target, size: 0 }, 'linux')
        const relative = path.posix.normalize(path.posix.join(path.posix.dirname(link.path), link.target))
        if (!/^node_modules\/@mew\/[a-z0-9-]+$/.test(link.path) || !/^packages\/[a-z0-9-]+$/.test(relative) || seen.has(link.path)) throw new Error('Windows 실행본은 내부 workspace 링크만 허용합니다.')
        seen.add(link.path)
        if (!(await fs.stat(path.join(extracted, relative))).isDirectory()) throw new Error('Windows workspace 링크 대상이 없습니다.')
        await fs.symlink(path.resolve(destination, relative), path.join(extracted, link.path), 'junction')
      }
    }
    await validateRuntime(extracted, version, target)
    try { await fs.rename(extracted, destination) } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) && !(process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code))) throw error
      await validateRuntime(destination, version, target)
    }
    return destination
  } finally {
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
