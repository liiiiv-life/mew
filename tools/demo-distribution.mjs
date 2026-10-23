import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repository = path.resolve(import.meta.dirname, '..')
const manifestName = 'mew-demo-build.json'
const ignoredDirectories = new Set(['node_modules', '.git', '.data', 'dist', 'dist-demo', 'coverage', 'target'])
const digest = value => createHash('sha256').update(value).digest('hex')

async function filesIn(directory, relative = '') {
  const files = []
  for (const entry of (await fs.readdir(path.join(directory, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const filename = path.posix.join(relative, entry.name)
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) files.push(...await filesIn(directory, filename))
    else if (entry.isFile()) files.push(filename)
    else if (entry.isSymbolicLink()) throw new Error(`데모 배포 입력에 심볼릭 링크를 사용할 수 없습니다: ${filename}`)
  }
  return files
}

async function fileDigests(directory, files) {
  return Promise.all(files.sort().map(async filename => [filename, digest(await fs.readFile(path.join(directory, filename)))]))
}

export async function demoSourceFingerprint(root = repository) {
  const files = []
  for (const directory of ['src', 'packages', 'public', 'shared']) {
    try { files.push(...(await filesIn(path.join(root, directory))).map(filename => `${directory}/${filename}`)) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:demo\.html|(?:package(?:-lock)?|tsconfig(?:\.[^.]+)*)\.json|vite(?:\.demo)?\.config\.[cm]?[jt]s)$/.test(entry.name)) files.push(entry.name)
  }
  files.push('tools/demo-distribution.mjs', 'tools/demo-snapshot.mjs', 'tools/demo-repository-plugin.mjs', 'tools/demo-repository-plugin.d.mts')
  const sources = await fileDigests(root, files)
  return { fingerprint: digest(JSON.stringify(sources)), count: sources.length }
}

function runVite(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.demo.config.ts'], { cwd: root, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('데모 빌드가 실패했습니다.')))
  })
}

export async function buildDemoDistribution({ root = repository, executeBuild = runVite } = {}) {
  const before = await demoSourceFingerprint(root), output = path.join(root, 'dist-demo')
  await executeBuild(root)
  const after = await demoSourceFingerprint(root)
  if (before.fingerprint !== after.fingerprint) throw new Error('빌드 중 데모 소스가 변경됐습니다. build:demo를 다시 실행하세요.')
  await fs.access(path.join(output, 'demo.html'))
  const files = await fileDigests(output, (await filesIn(output)).filter(filename => filename !== manifestName))
  await fs.writeFile(path.join(output, manifestName), JSON.stringify({ format: 'mew-demo-build/v1', sourceFingerprint: after.fingerprint, sourceFiles: after.count, files }, null, 2) + '\n')
}

export async function copyDemoDistribution({ root = repository, destination = path.join(root, 'mewlink/dist/demo') } = {}) {
  const output = path.join(root, 'dist-demo'), source = await demoSourceFingerprint(root)
  let manifest
  try { manifest = JSON.parse(await fs.readFile(path.join(output, manifestName), 'utf8')) }
  catch { throw new Error('검증 가능한 데모 빌드가 없습니다. 저장소 루트에서 npm run build:demo를 실행하세요.') }
  if (manifest.format !== 'mew-demo-build/v1' || manifest.sourceFingerprint !== source.fingerprint) {
    throw new Error('데모 빌드와 현재 소스가 다릅니다. 저장소 루트에서 npm run build:demo를 다시 실행하세요.')
  }
  const files = await fileDigests(output, (await filesIn(output)).filter(filename => filename !== manifestName))
  if (JSON.stringify(files) !== JSON.stringify(manifest.files) || !files.some(([filename]) => filename === 'demo.html')) {
    throw new Error('데모 빌드 파일이 변경되거나 누락됐습니다. npm run build:demo를 다시 실행하세요.')
  }
  if (path.resolve(destination) === output || path.resolve(destination).startsWith(output + path.sep)) throw new Error('데모 빌드 원본 안으로 배포할 수 없습니다.')
  await fs.rm(destination, { recursive: true, force: true })
  await fs.mkdir(destination, { recursive: true })
  for (const [filename] of files) {
    const target = path.join(destination, filename === 'demo.html' ? 'index.html' : filename)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(output, filename), target)
  }
  return { sourceFingerprint: source.fingerprint, files: files.length }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2]
  if (command === 'build') await buildDemoDistribution()
  else if (command === 'copy') await copyDemoDistribution()
  else throw new Error('사용법: node tools/demo-distribution.mjs build|copy')
}
