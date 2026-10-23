import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
export const TMUX_VERSION = '3.7c'
const RELEASE = `https://github.com/tmux/tmux-builds/releases/download/v${TMUX_VERSION}`
const CHECKSUMS: Record<string, string> = {
  'linux-x64': 'cc56bd1cc873eb6089c615f0496b072385bda8a6d944069f38564a5d49c128aa',
  'linux-arm64': '29dcb978da2a4b0cf6790f9e004865dac239a3ba03bbf776dddacce23d03831b',
  'darwin-x64': '1c21f9ade964e4a539be05ffe3a4e95854ab76a0a9c4c05d0ffbe7fc6c4d783f',
  'darwin-arm64': '0a763dd0380aa980d239509654da1bc7455843706a3c050f6709c8cd2e13d12d',
}
const LICENSE_CHECKSUM = '094905d3ba42397c65fecd817dc29736dd14bd35e75600441403a365125f47d1'
const SOURCE_CHECKSUM = '7c60cae9a0e25288e2e24750aafc9e8800fc7fd4555e447e1b29ee4201cfb3bf'
const SOURCE_URL = `https://github.com/tmux/tmux/releases/download/${TMUX_VERSION}/tmux-${TMUX_VERSION}.tar.gz`

export function verifiedDownload(bytes: Uint8Array, expected: string) {
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('tmux download checksum mismatch')
  return bytes
}

async function download(url: string, expected: string, file: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`tmux download failed (${response.status}): ${url}`)
  await fs.writeFile(file, verifiedDownload(new Uint8Array(await response.arrayBuffer()), expected))
}

export async function installReleaseTmux(directory: string, temporary: string, platform: string, arch: string) {
  const checksum = CHECKSUMS[`${platform}-${arch}`]
  if (!checksum) throw new Error(`Unsupported tmux platform: ${platform}-${arch}`)
  const filename = `tmux-${TMUX_VERSION}-${platform === 'darwin' ? 'macos' : 'linux'}-${arch === 'x64' ? 'x86_64' : 'arm64'}.tar.gz`
  const archive = path.join(temporary, filename)
  await download(`${RELEASE}/${filename}`, checksum, archive)
  const entries = (await exec('tar', ['-tzf', archive])).stdout.trim().split('\n')
  if (entries.length !== 1 || entries[0] !== 'tmux') throw new Error('Unexpected tmux archive contents')
  const bin = path.join(directory, 'bin')
  await fs.mkdir(bin, { recursive: true })
  await exec('tar', ['-xzf', archive, '-C', bin])
  if (!(await fs.lstat(path.join(bin, 'tmux'))).isFile()) throw new Error('tmux archive does not contain a regular executable')
  await fs.chmod(path.join(bin, 'tmux'), 0o755)
  if ((await exec(path.join(bin, 'tmux'), ['-V'])).stdout.trim() !== `tmux ${TMUX_VERSION}`) throw new Error('Bundled tmux version mismatch')
  if (platform === 'darwin') {
    const libraries = (await exec('otool', ['-L', path.join(bin, 'tmux')])).stdout.trim().split('\n').slice(1)
    if (libraries.some(line => !/^\s+\/(usr\/lib|System\/Library)\//.test(line))) throw new Error('Bundled tmux depends on non-system macOS libraries')
  }
  const licenses = path.join(temporary, 'LICENSES.tar.gz')
  await download(`${RELEASE}/LICENSES.tar.gz`, LICENSE_CHECKSUM, licenses)
  const notices = path.join(directory, 'notices', 'tmux')
  await fs.mkdir(notices, { recursive: true })
  // Keep upstream's full notice archive together with the redistributed binary.
  await fs.copyFile(licenses, path.join(notices, 'LICENSES.tar.gz'))
  // tmux's notices also live in its individual source files.
  await download(SOURCE_URL, SOURCE_CHECKSUM, path.join(notices, `tmux-${TMUX_VERSION}.tar.gz`))
  await fs.writeFile(path.join(notices, 'provenance.json'), JSON.stringify({
    version: TMUX_VERSION, url: `${RELEASE}/${filename}`, sha256: checksum,
    licenseUrl: `${RELEASE}/LICENSES.tar.gz`, licenseSha256: LICENSE_CHECKSUM,
    sourceUrl: SOURCE_URL, sourceSha256: SOURCE_CHECKSUM,
    buildSource: 'https://github.com/tmux/tmux-builds',
  }, null, 2) + '\n')
}
