import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { parseDocument } from 'yaml'

export const MAX_SNAPSHOT_BYTES = 768 * 1024
export const MAX_SNAPSHOT_GZIP_BYTES = 160 * 1024
export const MAX_REPOSITORY_INDEX_BYTES = 512 * 1024
export const MAX_REPOSITORY_INDEX_GZIP_BYTES = 112 * 1024
const root = path.resolve(import.meta.dirname, '..')
const entrypoints = new Set([
  'README.md', 'LICENSE', 'docs/operations/security.md', 'package.json', 'tsconfig.app.json',
  'docs/README.md', 'docs/AGENT.md',
  'docs/configuration/appearance.md', 'docs/configuration/accounts.md',
  'docs/guides/MOC.md', 'docs/guides/first-steps.md', 'docs/guides/editor.md',
  'docs/guides/getting-started-ko.md', 'docs/guides/terminal-agents.md', 'docs/guides/collaboration.md',
  'docs/development/getting-started.md',
  'src/main.tsx', 'src/AppBootstrap.tsx',
  'src/components/TabBar.tsx', 'src/components/DocsTab.tsx', 'src/components/ProjectSwitcher.tsx',
  'src/components/git-panel.tsx', 'src/components/feature-development.tsx',
  'packages/ui/src/Toast.tsx', 'packages/ui/src/ConfirmDialog.tsx',
  'packages/ui/src/select-field.tsx', 'packages/ui/src/dialog-frame.tsx',
  'packages/ui/src/copyText.ts', 'packages/ui/src/useOverlayDismiss.ts',
])

/** Only committed text in these explicit public areas can enter the demo. */
export function includeDemoSource(filename, bytes) {
  if (bytes > 48 * 1024 || filename.split('/').some(part => part.startsWith('.'))) return false
  if (entrypoints.has(filename)) return true
  if (/^docs\/features\/.+\.md$/.test(filename)) return bytes <= 16 * 1024
  if (/^docs\/tasks\/[^/]+\.md$/.test(filename)) return bytes <= 8 * 1024
  return /^(?:shared\/(?:features|task-[^/]+|document-[^/]+|file-[^/]+|project-[^/]+|selection-options|access-policy|active-sessions|agent-harness)|src\/runtime\/[^/]+)\.(?:ts|tsx)$/.test(filename) && !filename.endsWith('.test.ts')
}

function withoutTaskAccounts(filename, content) {
  if (!filename.startsWith('docs/tasks/')) return content
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) throw new Error(`태스크 문서에 속성이 없습니다: ${filename}`)
  const document = parseDocument(match[1])
  if (document.errors.length) throw new Error(`태스크 문서 속성을 확인하세요: ${filename}`)
  if (!document.has('assignees')) return content
  document.delete('assignees')
  return `---\n${document.toString({ lineWidth: 0 })}---\n${content.slice(match[0].length)}`
}

const excludedRepositoryDirectories = new Set(['.git', '.data', '.tokensave', 'node_modules', 'dist', 'dist-demo', 'dist-ssr', 'coverage', 'target'])
const binaryExtension = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|pdf|zip|gz|tgz|br|7z|woff2?|ttf|otf|mp[34]|webm|ogg|wav|wasm|node|exe|dll|dylib|so|bcmap|pfb|icc)$/i
const hash = value => createHash('sha256').update(value).digest('hex')

/** Public committed files include hidden project configuration, assets and historical documents. */
export function includeDemoRepositorySource(filename) {
  const parts = filename.split('/')
  if (!filename || parts.some(part => !part || part === '..' || excludedRepositoryDirectories.has(part))) return false
  if (parts[0] === 'mewlink' || filename === 'src/demo/repository-index.json') return false
  if (parts.some(part => /^\.env(?:\.|$)/.test(part) && part !== '.env.example')) return false
  if (parts.some(part => /^(?:credentials|secrets)(?:\.[^/]+)?$/i.test(part) || /^id_(?:rsa|ed25519|ecdsa)(?:\.pub)?$/.test(part))) return false
  if (/\.(?:pem|key|p12|pfx)$/i.test(filename)) return false
  if (/^native\/remote-desktop\/(?:runtime\/|\.mew-(?:ready|dependencies))/.test(filename)) return false
  return true
}

function repositoryGit(repository) {
  return (args, options = {}) => execFileSync('git', args, { cwd: repository, maxBuffer: 16 * 1024 * 1024, ...options })
}

function committedTree(repository, ref) {
  const git = repositoryGit(repository)
  const revision = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).toString().trim()
  const files = []
  for (const row of git(['ls-tree', '-rlz', revision]).toString().split('\0').filter(Boolean)) {
    const separator = row.indexOf('\t'), filename = row.slice(separator + 1)
    const [mode, kind, oid, size] = row.slice(0, separator).trim().split(/\s+/)
    if (['100644', '100755'].includes(mode) && kind === 'blob' && includeDemoRepositorySource(filename)) files.push({ filename, oid, size: Number(size) })
  }
  return { revision, files }
}

function committedBlobs(repository, files) {
  if (!files.length) return []
  const output = repositoryGit(repository)(['cat-file', '--batch'], {
    input: files.map(file => file.oid + '\n').join(''),
    maxBuffer: Math.max(1024 * 1024, files.reduce((total, file) => total + file.size + 256, 0)),
  })
  let offset = 0
  return files.map(file => {
    const end = output.indexOf(10, offset)
    const [oid, kind, size] = output.subarray(offset, end).toString().split(' ')
    if (end < offset || oid !== file.oid || kind !== 'blob' || Number(size) !== file.size) throw new Error(`데모 Git blob을 확인하세요: ${file.filename}`)
    const content = output.subarray(end + 1, end + 1 + file.size)
    offset = end + 2 + file.size
    return content
  })
}

function repositoryObject(filename, bytes) {
  let content, binary = binaryExtension.test(filename) || bytes.includes(0)
  if (!binary) {
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
    catch { binary = true }
  }
  if (!binary) content = withoutTaskAccounts(filename, content)
  const payload = JSON.stringify(binary ? { base64: bytes.toString('base64') } : { content })
  return { payload, entry: { oid: hash(payload), size: binary ? bytes.length : Buffer.byteLength(content), binary } }
}

export function createDemoRepositoryIndex(repository = root, ref = 'HEAD') {
  const tree = committedTree(repository, ref), blobs = committedBlobs(repository, tree.files)
  const files = Object.create(null)
  tree.files.forEach((file, index) => { files[file.filename] = repositoryObject(file.filename, blobs[index]).entry })
  const index = { format: 'mew-demo-snapshot/v2', revision: tree.revision, files }
  const json = JSON.stringify(index) + '\n'
  const bytes = Buffer.byteLength(json), gzipBytes = gzipSync(json).byteLength
  if (bytes > MAX_REPOSITORY_INDEX_BYTES || gzipBytes > MAX_REPOSITORY_INDEX_GZIP_BYTES) {
    throw new Error(`데모 파일 목록 용량 예산을 초과했습니다: ${bytes} bytes, gzip ${gzipBytes} bytes.`)
  }
  return { index, json, bytes, gzipBytes }
}

const rawContentTypes = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' }
export const DEMO_RAW_RESOURCE_EXTENSIONS = Object.freeze(Object.keys(rawContentTypes))
export function demoRepositoryContentType(extension) { return Object.hasOwn(rawContentTypes, extension) ? rawContentTypes[extension] : 'application/octet-stream' }

/** Resolve immutable object URLs from the manifest's commit, never HEAD or the working tree. */
export function createDemoRepositorySource(index, repository = root) {
  if (index?.format !== 'mew-demo-snapshot/v2' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(index.revision) || !index.files || typeof index.files !== 'object') throw new Error('데모 파일 목록 형식이 올바르지 않습니다.')
  const tree = committedTree(repository, index.revision)
  const entries = Object.entries(index.files)
  if (entries.length !== tree.files.length) throw new Error('데모 파일 목록과 기준 커밋의 파일이 다릅니다.')
  const byObject = new Map(), cache = new Map(), extensions = new Map()
  for (const file of tree.files) {
    const entry = Object.hasOwn(index.files, file.filename) ? index.files[file.filename] : undefined
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.oid) || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.binary !== 'boolean') throw new Error(`데모 파일 정보를 확인하세요: ${file.filename}`)
    byObject.set(entry.oid, { file, entry })
    const extension = path.extname(file.filename).slice(1).toLowerCase()
    if (Object.hasOwn(rawContentTypes, extension)) {
      if (!extensions.has(entry.oid)) extensions.set(entry.oid, new Set())
      extensions.get(entry.oid).add(extension)
    }
  }
  function verify(file, bytes) {
    const object = repositoryObject(file.filename, bytes), expected = index.files[file.filename]
    if (object.entry.oid !== expected.oid || object.entry.size !== expected.size || object.entry.binary !== expected.binary) throw new Error(`데모 파일 내용이 기준 목록과 다릅니다: ${file.filename}`)
    cache.set(expected.oid, object.payload)
    return object.payload
  }
  function load(oid) {
    const source = byObject.get(oid)
    if (!source) throw new Error('데모 파일 객체를 찾을 수 없습니다.')
    if (!cache.has(oid)) verify(source.file, repositoryGit(repository)(['cat-file', 'blob', source.file.oid], { maxBuffer: Math.max(source.file.size + 1, 1024 * 1024) }))
    return cache.get(oid)
  }
  function loadRaw(oid) {
    const source = byObject.get(oid)
    if (!source) throw new Error('데모 파일 객체를 찾을 수 없습니다.')
    const object = JSON.parse(load(oid))
    return { bytes: source.entry.binary ? Buffer.from(object.base64, 'base64') : Buffer.from(object.content, 'utf8'), contentType: demoRepositoryContentType(path.extname(source.file.filename).slice(1).toLowerCase()) }
  }
  return {
    has(oid) { return byObject.has(oid) },
    isBinary(oid) { return byObject.get(oid)?.entry.binary === true },
    rawExtensions(oid) { return [...extensions.get(oid) ?? []].sort() },
    load,
    loadRaw,
    loadBinary(oid) {
      const source = byObject.get(oid)
      if (!source?.entry.binary) throw new Error('데모 바이너리 객체를 찾을 수 없습니다.')
      return loadRaw(oid)
    },
    *objects() {
      const blobs = committedBlobs(repository, tree.files)
      const emitted = new Set()
      for (let position = 0; position < tree.files.length; position++) {
        const file = tree.files[position], payload = verify(file, blobs[position]), oid = index.files[file.filename].oid
        if (!emitted.has(oid)) { emitted.add(oid); yield [oid, payload] }
      }
    },
  }
}

export function createDemoSnapshot(repository = root, ref = 'HEAD') {
  const git = args => execFileSync('git', args, { cwd: repository, maxBuffer: 16 * 1024 * 1024 })
  const revision = git(['rev-parse', '--verify', `${ref}^{commit}`]).toString().trim()
  const files = {}
  for (const row of git(['ls-tree', '-rlz', revision]).toString().split('\0').filter(Boolean)) {
    const separator = row.indexOf('\t'), filename = row.slice(separator + 1)
    const [mode, kind, oid, size] = row.slice(0, separator).trim().split(/\s+/)
    if (!['100644', '100755'].includes(mode) || kind !== 'blob' || !includeDemoSource(filename, Number(size))) continue
    const content = git(['cat-file', 'blob', oid]).toString('utf8')
    if (content.includes('\0') || content.includes('\ufffd')) throw new Error(`텍스트 파일을 확인하세요: ${filename}`)
    files[filename] = withoutTaskAccounts(filename, content)
  }
  for (const filename of ['README.md', 'LICENSE', 'src/main.tsx']) {
    if (!(filename in files)) throw new Error(`데모 필수 파일이 없습니다: ${filename}`)
  }
  const snapshot = { format: 'mew-demo-snapshot/v1', revision, files }
  const json = JSON.stringify(snapshot, null, 2) + '\n'
  const bytes = Buffer.byteLength(json), gzipBytes = gzipSync(json).byteLength
  if (bytes > MAX_SNAPSHOT_BYTES || gzipBytes > MAX_SNAPSHOT_GZIP_BYTES) {
    throw new Error(`데모 용량 예산을 초과했습니다: ${bytes} bytes, gzip ${gzipBytes} bytes. 포함 목록을 줄이세요.`)
  }
  return { snapshot, json, bytes, gzipBytes }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = createDemoSnapshot()
  const repositoryIndex = createDemoRepositoryIndex(root, result.snapshot.revision)
  await fs.writeFile(path.join(root, 'src/demo/repository-snapshot.json'), result.json)
  process.stdout.write(`${Object.keys(result.snapshot.files).length} files, ${result.bytes} bytes, gzip ${result.gzipBytes} bytes, revision ${result.snapshot.revision}\n`)
  await fs.writeFile(path.join(root, 'src/demo/repository-index.json'), repositoryIndex.json)
  process.stdout.write(`index: ${Object.keys(repositoryIndex.index.files).length} files, ${repositoryIndex.bytes} bytes, gzip ${repositoryIndex.gzipBytes} bytes, revision ${repositoryIndex.index.revision}\n`)
}
