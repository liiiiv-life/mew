import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DATA_DIR } from './dataDir.ts'
const exec = promisify(execFile)
export const JS_DEBUG_VERSION = '1.140.0'
const digest = '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968'
const asset = `https://github.com/microsoft/vscode-js-debug/releases/download/v${JS_DEBUG_VERSION}/js-debug-dap-v${JS_DEBUG_VERSION}.tar.gz`
const destination = path.join(DATA_DIR, 'debuggers', `js-debug-${JS_DEBUG_VERSION}`)
export const jsDebugEntry = path.join(destination, 'js-debug', 'src', 'dapDebugServer.js')
let installing: Promise<string> | null = null
export async function jsDebugInstalled() { return fs.stat(jsDebugEntry).then(stat => stat.isFile(), () => false) }
/** Keep the standalone CommonJS bundle independent of the parent project's module type. */
export async function prepareJsDebugPackage(directory = path.dirname(path.dirname(jsDebugEntry))) {
  const file = path.join(directory, 'package.json')
  let manifest: Record<string, unknown> = { private: true }
  try { manifest = JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('js-debug package.json 형식이 올바르지 않습니다')
  if (manifest.type === 'commonjs') return
  const temporary = `${file}.tmp-${randomUUID()}`
  try {
    await fs.writeFile(temporary, JSON.stringify({ ...manifest, type: 'commonjs' }, null, 2) + '\n', { mode: 0o600 })
    await fs.rename(temporary, file)
  } finally { await fs.rm(temporary, { force: true }) }
}
export function installJsDebug(): Promise<string> {
  if (installing) return installing
  installing = install().finally(() => { installing = null })
  return installing
}
async function install() {
  if (await jsDebugInstalled()) { await prepareJsDebugPackage(); return jsDebugEntry }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-js-debug-'))
  try {
    const response = await fetch(asset, { signal: AbortSignal.timeout(60000) })
    if (!response.ok || !response.body) throw new Error('공식 js-debug 다운로드 실패')
    const chunks: Uint8Array[] = []; let size = 0
    for await (const chunk of response.body) { size += chunk.length; if (size > 40 * 1024 * 1024) throw new Error('디버거 다운로드 크기 제한 초과'); chunks.push(chunk) }
    const bytes = Buffer.concat(chunks)
    if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('디버거 다운로드 체크섬 불일치')
    const archive = path.join(temp, 'adapter.tar.gz')
    await fs.writeFile(archive, bytes, { mode: 0o600 })
    const { stdout: listing } = await exec('tar', ['-tzf', archive], { maxBuffer: 4 * 1024 * 1024, timeout: 15000 })
    const entries = listing.trim().split('\n')
    if (entries.some(name => !name.startsWith('js-debug/') || name.split('/').includes('..') || name.includes('\\'))) throw new Error('안전하지 않은 디버거 압축 경로')
    const { stdout: types } = await exec('tar', ['-tvzf', archive], { maxBuffer: 8 * 1024 * 1024, timeout: 15000 })
    if (types.trim().split('\n').some(line => !line.startsWith('-') && !line.startsWith('d'))) throw new Error('디버거 압축에 링크나 특수 파일이 있습니다')
    const unpacked = path.join(temp, 'unpacked')
    await fs.mkdir(unpacked)
    await exec('tar', ['-xzf', archive, '-C', unpacked, '--no-same-owner', '--no-same-permissions'], { timeout: 15000 })
    await fs.access(path.join(unpacked, 'js-debug', 'src', 'dapDebugServer.js'))
    await prepareJsDebugPackage(path.join(unpacked, 'js-debug'))
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    // Copy across filesystems into a temporary sibling; only publish a complete install.
    const staging = `${destination}.tmp-${process.pid}`
    await fs.rm(staging, { recursive: true, force: true })
    await fs.cp(unpacked, staging, { recursive: true })
    await fs.rename(staging, destination)
    return jsDebugEntry
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
}
