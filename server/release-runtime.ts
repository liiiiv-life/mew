import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import ts from 'typescript'
import { installReleaseTmux, TMUX_VERSION } from './release-tmux.ts'
import { installReleasePsmux, PSMUX_VERSION, compileWindowsProcessHost, encodeWindowsRuntimeLinks } from './release-psmux.ts'
import { execHostFile } from './platform/process.ts'

const exec = promisify(execFile)
const CODE = /\.(?:ts|tsx|js|mjs|cjs)$/
const RESOURCE = /\.(?:ts|tsx|js|mjs|cjs|json|css|svg|txt|png|webp|woff2?|ttf|wasm|html|cpp|h|m|py|ps1|inf)$/
const SKILL_RESOURCE = /\.(?:md|ya?ml|py|txt|json|png|svg|tsv|csv|toml)$/
const EXCLUDED = /(?:^|\/)(?:\.[^/]+|node_modules|dist|target|build|runtime|fixtures)(?:\/|$)|(?:\.test|\.browser\.test)\.[^/]+$|\.d\.(?:ts|mts)$/
const SOURCE_DIRS = ['server', 'shared', 'packages', 'docs/configuration/skills', 'docs/configuration/skills/.vendor']

export interface RuntimeManifest {
  version: string
  platform: string
  arch: string
  nodeMajor: number
  entrypoint: string
  tmuxVersion?: string
  psmuxVersion?: string
}

function outputPath(file: string) { return file.replace(/\.(?:ts|tsx)$/, '.js') }

function moduleReference(node: ts.StringLiteralLike) {
  const parent = node.parent
  return ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
    || ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword
}

function rewrittenPath(value: string, filename: string, module = false) {
  const local = value.startsWith('.') || !value.includes('/') && /\.tsx?$/.test(value)
  if (!local) return value
  const target = path.resolve(path.dirname(filename), value)
  if (/\.tsx?$/.test(value) && existsSync(target)) return outputPath(value)
  if (module && !path.extname(value)) {
    for (const extension of ['.ts', '.tsx', '.js', '.mjs', '.cjs']) if (existsSync(target + extension)) return outputPath(value + extension)
    for (const extension of ['.ts', '.tsx', '.js']) if (existsSync(path.join(target, 'index' + extension))) return outputPath(`${value}/index${extension}`)
  }
  return value
}

function rewrittenTemplate(text: string, filename: string) {
  return text.replace(/(?:\.\.?\/|(?:server|shared|packages|src)\/)[a-zA-Z0-9_./-]+\.tsx?\b/g, value => {
    const target = path.resolve(path.dirname(filename), value)
    const appTarget = path.resolve(path.dirname(filename), '..', value)
    return existsSync(target) || existsSync(appTarget) ? outputPath(value) : value
  })
}

export function compileRuntimeSource(source: string, filename: string) {
  const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
    const visit: ts.Visitor = node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith('.json') && !node.attributes) {
        return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause, node.moduleSpecifier,
          context.factory.createImportAttributes(context.factory.createNodeArray([context.factory.createImportAttribute(context.factory.createIdentifier('type'), context.factory.createStringLiteral('json'))])))
      }
      if (ts.isStringLiteral(node)) {
        const rewritten = rewrittenPath(node.text, filename, moduleReference(node))
        if (rewritten !== node.text) return context.factory.createStringLiteral(rewritten)
      }
      if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const text = rewrittenTemplate(node.text, filename)
        if (text !== node.text) {
          if (ts.isTemplateHead(node)) return context.factory.createTemplateHead(text)
          if (ts.isTemplateMiddle(node)) return context.factory.createTemplateMiddle(text)
          if (ts.isTemplateTail(node)) return context.factory.createTemplateTail(text)
          return context.factory.createNoSubstitutionTemplateLiteral(text)
        }
      }
      return ts.visitEachChild(node, visit, context)
    }
    return file => ts.visitNode(file, visit) as ts.SourceFile
  }
  const result = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, verbatimModuleSyntax: true, allowJs: true },
    transformers: { before: [transformer] },
    reportDiagnostics: true,
  })
  const errors = result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => path.dirname(filename), getNewLine: () => '\n',
  }))
  return result.outputText
}

function compiledExports(value: unknown): unknown {
  if (typeof value === 'string') return outputPath(value)
  if (Array.isArray(value)) return value.map(compiledExports)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compiledExports(item)]))
  return value
}

async function copySourceTree(source: string, target: string, relative = '', resources = RESOURCE) {
  await fs.mkdir(target, { recursive: true })
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name
    if (EXCLUDED.test(name) || /^release-/.test(entry.name) || /(?:benchmark|browser-test)/.test(entry.name)) continue
    const input = path.join(source, entry.name), output = path.join(target, outputPath(entry.name))
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${input}`)
    if (entry.isDirectory()) await copySourceTree(input, output, name, resources)
    else if (entry.isFile()) {
      if (!resources.test(entry.name) && !/^(?:LICENSE|COPYING|COPYRIGHT)(?:\..*)?$/.test(entry.name)) continue
      if (CODE.test(entry.name)) await fs.writeFile(output, compileRuntimeSource(await fs.readFile(input, 'utf8'), input), { mode: (await fs.stat(input)).mode & 0o777 })
      else if (entry.name === 'package.json') {
        const manifest = JSON.parse(await fs.readFile(input, 'utf8'))
        if (manifest.exports) manifest.exports = compiledExports(manifest.exports)
        if (manifest.main) manifest.main = outputPath(manifest.main)
        await fs.writeFile(output, JSON.stringify(manifest, null, 2) + '\n')
      } else await fs.copyFile(input, output)
    }
  }
}

export async function stageRuntimeSources(root: string, directory: string, manifest: RuntimeManifest) {
  if (!existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Missing built dist/index.html. Build in release CI before packaging.')
  await fs.mkdir(directory, { recursive: true })
  for (const folder of SOURCE_DIRS) {
    const source = path.join(root, folder)
    if (existsSync(source)) await copySourceTree(source, path.join(directory, folder), '', folder.startsWith('docs/configuration/skills') ? SKILL_RESOURCE : RESOURCE)
  }
  // A server-side layout-icon CLI shares these two pure application utilities.
  for (const file of ['src/utils/layout-presets.ts', 'src/utils/dock-layout.ts']) {
    if (!existsSync(path.join(root, file))) continue
    const destination = path.join(directory, outputPath(file))
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, compileRuntimeSource(await fs.readFile(path.join(root, file), 'utf8'), path.join(root, file)))
  }
  await fs.cp(path.join(root, 'dist'), path.join(directory, 'dist'), { recursive: true, filter: file => !EXCLUDED.test(path.relative(path.join(root, 'dist'), file)) })
  if (existsSync(path.join(root, 'public', 'mewcat'))) await copySourceTree(path.join(root, 'public', 'mewcat'), path.join(directory, 'public', 'mewcat'))
  if (existsSync(path.join(root, 'native', 'remote-desktop'))) await copySourceTree(path.join(root, 'native', 'remote-desktop'), path.join(directory, 'native', 'remote-desktop'))
  for (const file of ['package.json', 'package-lock.json', 'LICENSE']) await fs.copyFile(path.join(root, file), path.join(directory, file))
  await fs.writeFile(path.join(directory, 'mew-runtime.json'), JSON.stringify(manifest, null, 2) + '\n')
}

export async function validateRuntimeLinks(directory: string) {
  async function visit(folder: string) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await fs.readlink(file)
        const relative = path.relative(directory, path.resolve(path.dirname(file), target))
        if (process.platform !== 'win32' && path.isAbsolute(target) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error(`Runtime link escapes archive: ${path.relative(directory, file)}`)
        const actual = path.relative(directory, await fs.realpath(file))
        if (actual === '..' || actual.startsWith(`..${path.sep}`)) throw new Error(`Runtime link chain escapes archive: ${path.relative(directory, file)}`)
      } else if (entry.isDirectory()) await visit(file)
    }
  }
  await visit(directory)
}

export async function validateCompiledImports(directory: string) {
  async function visit(folder: string) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (CODE.test(entry.name)) {
        const parsed = ts.createSourceFile(file, await fs.readFile(file, 'utf8'), ts.ScriptTarget.ESNext, true)
        const inspect = (node: ts.Node) => {
          if (ts.isStringLiteral(node) && moduleReference(node) && node.text.startsWith('.')) {
            if (!existsSync(path.resolve(path.dirname(file), node.text))) throw new Error(`Unresolved runtime import in ${path.relative(directory, file)}: ${node.text}`)
            if (/\.tsx?$/.test(node.text)) throw new Error(`Uncompiled runtime import in ${file}: ${node.text}`)
          }
          ts.forEachChild(node, inspect)
        }
        inspect(parsed)
      }
    }
  }
  for (const folder of [...SOURCE_DIRS, 'src', 'native/remote-desktop']) if (existsSync(path.join(directory, folder))) await visit(path.join(directory, folder))
}

async function verifyNativeDependencies(directory: string) {
  const script = `import { createRequire } from 'node:module';
const require = createRequire(new URL('./package.json', import.meta.url));
const pty = require('node-pty'); if (typeof pty.spawn !== 'function') throw new Error('node-pty missing');
const rtc = require('node-datachannel'); const peer = new rtc.PeerConnection('release-check', { iceServers: [] }); peer.close(); rtc.cleanup();
await import('./packages/tmux-term/src/server/pty-helper.js').then(module => module.preparePtyHelper());
await import('@mew/editor/frontmatter'); await import('@mew/editor/server'); await import('@mew/ui/i18n-core');
`
  await exec(process.execPath, ['--input-type=module', '-e', script], { cwd: directory, timeout: 30_000 })
}

export async function packageRuntime(root: string, output: string) {
  if (process.versions.node.split('.')[0] !== '24') throw new Error('Release packaging requires Node.js 24')
  if (!['linux', 'darwin', 'win32'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('Unsupported release host')
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'apps', 'cli', 'package.json'), 'utf8'))
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid CLI version')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-release-'))
  const directory = path.join(temporary, 'runtime')
  try {
    await stageRuntimeSources(root, directory, { version, platform: process.platform, arch: process.arch, nodeMajor: 24, entrypoint: 'server/cli-host.js', ...(process.platform === 'win32' ? { psmuxVersion: PSMUX_VERSION } : { tmuxVersion: TMUX_VERSION }) })
    if (process.platform === 'win32') await compileWindowsProcessHost(root, directory)
    // The isolated installation preserves npm's workspace and executable links.
    const install = process.platform === 'win32' ? execHostFile : exec
    await install(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--include=optional', '--no-audit', '--no-fund'], { cwd: directory, env: { ...process.env, MEW_WINDOWS_PROCESS_HOST: path.join(directory, 'native/windows/process-host.exe'), MEW_AGENT_MEMORY_SCOPE: 'off' }, timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024 })
    await fs.rm(path.join(directory, 'node_modules', '.cache'), { recursive: true, force: true })
    const packageFile = path.join(directory, 'package.json')
    const runtimePackage = JSON.parse(await fs.readFile(packageFile, 'utf8'))
    delete runtimePackage.devDependencies
    runtimePackage.scripts = { serve: 'node server/cli-host.js' }
    await fs.writeFile(packageFile, JSON.stringify(runtimePackage, null, 2) + '\n')
    await verifyNativeDependencies(directory)
    if (process.platform === 'win32') await installReleasePsmux(directory, temporary, process.arch)
    else await installReleaseTmux(directory, temporary, process.platform, process.arch)
    await validateCompiledImports(directory)
    await validateRuntimeLinks(directory)
    if (process.platform === 'win32') await encodeWindowsRuntimeLinks(directory)
    if (!existsSync(path.join(directory, 'server', 'cli-host.js'))) throw new Error('Missing runtime entrypoint server/cli-host.js')
    await fs.mkdir(output, { recursive: true })
    const archive = path.join(output, `mew-runtime-${process.platform}-${process.arch}.tar.gz`)
    await exec('tar', ['-czf', archive, '-C', directory, '.'], { timeout: 10 * 60_000 })
    const sum = createHash('sha256').update(await fs.readFile(archive)).digest('hex')
    await fs.writeFile(`${archive}.sha256`, `${sum}  ${path.basename(archive)}\n`)
    return archive
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node server/release-runtime.ts --output <directory>')
  const archive = await packageRuntime(path.resolve(import.meta.dirname, '..'), path.resolve(args[1]))
  console.log(archive)
}
