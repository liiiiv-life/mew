import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse } from 'smol-toml'
import { powershell, encodedPowerShell, quotePowerShell } from './platform/windows/storage.ts'
const execute = promisify(execFile)
export const PSMUX_VERSION = '3.4.0'
const digests: Record<string, string> = { x64: 'a66b6be7c13c6fa0dc3660a267b9e34eaa91a4eb7f07fbd55a0468018bd0f721', arm64: 'b123398e3b37408032bc268b4da6e7a6eab5b56461e0c3414914513a57a7a5cf' }
const sourceDigests: Record<string, string> = {
  LICENSE: '08da43448469783a5b56d903e29c071383d7c201b9644287f98531e76083b959',
  'Cargo.lock': '36d4f0b7c3a141c1baab7b9d1a1810a654d2438a7d084e4ff28a9657a97b6164',
  'Cargo.toml': 'f8fc16e97ac879df345a74107580f3639416a06241dcd978b8bced68fbc96cb6',
  'crates/portable-pty-psmux/LICENSE.md': '191c46fcf52061382b1c51a70311eb9081381cc158e5899f3739473a9432185b',
  'crates/vt100-psmux/LICENSE': '53a04b0a11073f3d0183c31a4b7bdf9a3f68d453adeec136e59e5a9d9a554370',
}

export function crateSources(lock: string): { name: string; version: string; checksum: string; url: string }[] {
  const packages = parse(lock).package
  if (!Array.isArray(packages)) throw new Error('Invalid psmux dependency lock')
  return packages.flatMap(value => {
    const pkg = value as Record<string, unknown>
    if (!pkg.source && ['psmux', 'portable-pty-psmux', 'vt100-psmux'].includes(String(pkg.name))) return []
    if (pkg.source !== 'registry+https://github.com/rust-lang/crates.io-index' || typeof pkg.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(pkg.name) || typeof pkg.version !== 'string' || !/^[a-zA-Z0-9.+-]+$/.test(pkg.version) || typeof pkg.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(pkg.checksum)) throw new Error('Unreviewed psmux dependency source')
    return [{ name: pkg.name, version: pkg.version, checksum: pkg.checksum, url: `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate` }]
  })
}
export function selectedLicense(expression: string): string | null {
  const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', 'BSL-1.0', 'Unicode-DFS-2016', 'Unicode-3.0', 'Unlicense', 'CC0-1.0', 'WTFPL'])
  const tokens = expression.match(/[A-Za-z0-9.+-]+|[()/]/g) || []
  if (tokens.join('') !== expression.replace(/\s/g, '')) return null
  let index = 0
  function atom(): string | null {
    if (tokens[index] === '(') { index++; const result = or(); if (tokens[index++] !== ')') throw new Error('Invalid license'); return result }
    const license = tokens[index++]
    if (!license || ['AND', 'OR', 'WITH', ')', '/'].includes(license)) throw new Error('Invalid license')
    let choice = allowed.has(license) ? license : null
    if (tokens[index] === 'WITH') {
      index++; const exception = tokens[index++]
      choice = license === 'Apache-2.0' && exception === 'LLVM-exception' ? 'Apache-2.0 WITH LLVM-exception' : null
    }
    return choice
  }
  function and(): string | null {
    let value = atom()
    while (tokens[index] === 'AND') { index++; const next = atom(); value = value && next ? `${value} AND ${next}` : null }
    return value
  }
  function or(): string | null {
    let value = and()
    while (['OR', '/'].includes(tokens[index])) { index++; const next = and(); value ||= next }
    return value
  }
  try { const choice = or(); return index === tokens.length ? choice : null } catch { return null }
}
export const reviewedLicense = (expression: string): boolean => selectedLicense(expression) !== null

async function dependencyNotices(notices: string): Promise<void> {
  const crates = crateSources(await fs.readFile(path.join(notices, 'Cargo.lock'), 'utf8'))
  const directory = path.join(notices, 'dependencies')
  await fs.mkdir(directory, { recursive: true })
  const index: { name: string; version: string; checksum: string; url: string; license: string; selectedLicense: string; archive: string }[] = []
  let next = 0
  const workers = await Promise.allSettled(Array.from({ length: 6 }, async () => {
    while (next < crates.length) {
      const crate = crates[next++], archive = `${crate.name}-${crate.version}.crate`, file = path.join(directory, archive)
      // Preserve the complete checksum-verified source archive, including every notice.
      await fs.writeFile(file, await download(crate.url, crate.checksum))
      const manifest = parse((await execute('tar', ['-xOf', file, `${crate.name}-${crate.version}/Cargo.toml`], { maxBuffer: 4 * 1024 * 1024 })).stdout)
      const license = String((manifest.package as Record<string, unknown>)?.license || '')
      const selected = selectedLicense(license)
      if (!selected) throw new Error(`Unreviewed psmux license: ${crate.name} ${license || '(missing)'}`)
      index.push({ ...crate, license, selectedLicense: selected, archive })
    }
  }))
  const failure = workers.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failure) throw failure.reason
  index.sort((a, b) => `${a.name}-${a.version}`.localeCompare(`${b.name}-${b.version}`))
  await fs.writeFile(path.join(notices, 'dependencies.json'), JSON.stringify(index, null, 2) + '\n')
  await fs.writeFile(path.join(notices, 'README.txt'), 'psmux and patched crate licenses are included here. dependencies/ contains complete original crates.io source archives, verified against Cargo.lock, preserving license, copyright, NOTICE and source files for every locked dependency (including build/test/other-platform dependencies). dependencies.json records their declared licenses and provenance. Extract any .crate with tar -xf to read its notices. Unknown licenses stop release packaging for review.\n')
}

async function download(url: string, expected?: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`psmux download failed (${response.status})`)
  const value = Buffer.from(await response.arrayBuffer())
  if (expected && createHash('sha256').update(value).digest('hex') !== expected) throw new Error('psmux checksum mismatch')
  return value
}
export async function installReleasePsmux(directory: string, temporary: string, arch: string): Promise<void> {
  if (!digests[arch]) throw new Error('Unsupported psmux architecture')
  const name = `psmux-v${PSMUX_VERSION}-windows-${arch}.zip`
  const url = `https://github.com/psmux/psmux/releases/download/v${PSMUX_VERSION}/${name}`
  const archive = path.join(temporary, name), extracted = path.join(temporary, 'psmux')
  await fs.writeFile(archive, await download(url, digests[arch]))
  await execute(powershell(), encodedPowerShell(`Expand-Archive -LiteralPath ${quotePowerShell(archive)} -DestinationPath ${quotePowerShell(extracted)}`), { timeout: 60_000 })
  // Copy only the selected executable. No installer or PATH/registry mutation.
  const bin = path.join(directory, 'bin')
  await fs.mkdir(bin, { recursive: true })
  await fs.copyFile(path.join(extracted, 'psmux.exe'), path.join(bin, 'psmux.exe'))
  const version = (await execute(path.join(bin, 'psmux.exe'), ['-V'])).stdout
  if (!version.includes(PSMUX_VERSION)) throw new Error('psmux version mismatch')
  const notices = path.join(directory, 'notices', 'psmux')
  await fs.mkdir(notices, { recursive: true })
  const source = `https://raw.githubusercontent.com/psmux/psmux/v${PSMUX_VERSION}`
  for (const [file, checksum] of Object.entries(sourceDigests)) {
    const destination = path.join(notices, file)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, await download(`${source}/${file}`, checksum))
  }
  await dependencyNotices(notices)
  await fs.writeFile(path.join(notices, 'provenance.json'), JSON.stringify({ version: PSMUX_VERSION, url, sha256: digests[arch], source: `https://github.com/psmux/psmux/tree/v${PSMUX_VERSION}` }, null, 2) + '\n')
}

export async function compileWindowsProcessHost(root: string, directory: string): Promise<void> {
  const destination = path.join(directory, 'native', 'windows')
  await fs.mkdir(destination, { recursive: true })
  await fs.copyFile(path.join(root, 'native/windows/process-host.cpp'), path.join(destination, 'process-host.cpp'))
  await execute('cl.exe', ['/nologo', '/O2', '/EHsc', '/MT', '/W4', path.join(destination, 'process-host.cpp'), `/Fe:${path.join(destination, 'process-host.exe')}`, `/Fo:${path.join(destination, 'process-host.obj')}`], { cwd: destination, timeout: 120_000 })
  await fs.rm(path.join(destination, 'process-host.obj'))
}

/** Encode workspace junctions portably so user extraction needs no symlink privilege. */
export async function encodeWindowsRuntimeLinks(directory: string): Promise<void> {
  const links: { path: string; target: string }[] = []
  const scoped = path.join(directory, 'node_modules', '@mew')
  for (const entry of await fs.readdir(scoped, { withFileTypes: true })) {
    const file = path.join(scoped, entry.name)
    if (!entry.isSymbolicLink()) continue
    const actual = await fs.realpath(file)
    const rootRelative = path.relative(directory, actual).replaceAll('\\', '/')
    if (!rootRelative.startsWith('packages/')) throw new Error('Unexpected Windows workspace link')
    const location = path.relative(directory, file).replaceAll('\\', '/')
    links.push({ path: location, target: path.posix.relative(path.posix.dirname(location), rootRelative) })
    await fs.unlink(file)
  }
  await fs.writeFile(path.join(directory, 'runtime-links.json'), JSON.stringify(links) + '\n')
}
