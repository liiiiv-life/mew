import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { compileRuntimeSource, stageRuntimeSources, validateCompiledImports, validateRuntimeLinks } from './release-runtime.ts'
import { verifiedDownload } from './release-tmux.ts'
import { readDocumentationDependencies } from './documentation-skills.ts'

const exec = promisify(execFile)
const repository = path.resolve(import.meta.dirname, '..')

async function fixture(run: (root: string, output: string) => Promise<void>) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-release-test-'))
  const root = path.join(temporary, 'source'), output = path.join(temporary, 'runtime')
  await fs.mkdir(root)
  try { await run(root, output) }
  finally { await fs.rm(temporary, { recursive: true, force: true }) }
}

async function write(root: string, file: string, value: string) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await fs.writeFile(path.join(root, file), value)
}

test('runtime fixture resolves compiled imports, native worker URLs, package exports and JSON', async () => fixture(async (root, output) => {
  const files: Record<string, string> = {
    'package.json': '{"name":"runtime-fixture","type":"module","workspaces":["packages/*"]}',
    'package-lock.json': '{}', LICENSE: 'fixture license',
    'dist/index.html': '<main>fixture</main>', 'dist/assets/app.js': 'export {}',
    '.env': 'SECRET=private', '.data/users.json': '{"private":true}',
    'server/private.test.ts': 'throw new Error("not shipped")',
    'server/fixtures/private.json': '{"private":true}',
    'server/worker.ts': 'export const worker: string = "compiled"',
    'server/login-desktop-x11.py': 'import ctypes\n',
    'server/worker.mjs': 'export { worker } from "./worker.ts"',
    'server/entry.ts': `import { value } from '../shared/value.ts';
import { number } from '@mew/fixture';
import data from '../shared/data.json';
const worker = new URL('./worker.ts', import.meta.url);
const command = 'worker.ts';
const templateCommand = \`node \${'flag'} server/worker.ts\`;
console.log(JSON.stringify({value, number, data, worker: worker.pathname.endsWith('worker.js'), command, templateCommand}));`,
    'shared/value.ts': 'export { value } from "./nested"',
    'shared/nested.ts': 'export const value: string = "ok"',
    'shared/data.json': '{"enabled":true}',
    'packages/fixture/package.json': '{"name":"@mew/fixture","type":"module","exports":{".":{"import":"./src/index.ts"}}}',
    'packages/fixture/src/index.ts': 'export const number: number = 42',
    'native/remote-desktop/install.mjs': 'export const optional = true',
    'native/remote-desktop/.mew-ready': 'private marker',
    'native/remote-desktop/runtime/native.node': 'private build',
    'native/remote-desktop/capture-macos.dylib': 'local native build',
    'native/remote-desktop/debug.log': 'private diagnostics',
    'public/mewcat/default/skin.json': '{"name":"fixture"}',
    'docs/configuration/skills/english-technical-docs/SKILL.md': '---\nname: english-technical-docs\ndescription: Fixture\n---\nRead ../technical-docs-common/workflow.md',
    'docs/configuration/skills/english-technical-docs/agents/openai.yaml': 'interface:\n  display_name: "English docs"\n',
    'docs/configuration/skills/technical-docs-common/workflow.md': '# Shared fixture workflow\n',
    'docs/private.md': 'Unrelated documentation must not ship.',
  }
  for (const [file, value] of Object.entries(files)) await write(root, file, value)
  await stageRuntimeSources(root, output, { version: '0.1.0', platform: 'linux', arch: 'x64', nodeMajor: 24, entrypoint: 'server/cli-host.js', tmuxVersion: '3.7c' })
  await fs.mkdir(path.join(output, 'node_modules', '@mew'), { recursive: true })
  await fs.symlink('../../packages/fixture', path.join(output, 'node_modules', '@mew', 'fixture'))
  await validateRuntimeLinks(output)
  await validateCompiledImports(output)
  const { stdout } = await exec(process.execPath, [path.join(output, 'server', 'entry.js')])
  assert.deepEqual(JSON.parse(stdout), { value: 'ok', number: 42, data: { enabled: true }, worker: true, command: 'worker.js', templateCommand: 'node flag server/worker.js' })
  assert.match(await fs.readFile(path.join(output, 'server', 'worker.mjs'), 'utf8'), /worker\.js/)
  assert.equal(await fs.readFile(path.join(output, 'server', 'login-desktop-x11.py'), 'utf8'), files['server/login-desktop-x11.py'])
  assert.equal(JSON.parse(await fs.readFile(path.join(output, 'packages', 'fixture', 'package.json'), 'utf8')).exports['.'].import, './src/index.js')
  for (const file of ['.env', '.data/users.json', 'server/private.test.js', 'server/fixtures/private.json', 'native/remote-desktop/.mew-ready', 'native/remote-desktop/runtime/native.node', 'native/remote-desktop/capture-macos.dylib', 'native/remote-desktop/debug.log']) {
    await assert.rejects(fs.stat(path.join(output, file)), { code: 'ENOENT' })
  }
  assert.equal((await fs.readFile(path.join(output, 'mew-runtime.json'), 'utf8')).includes('server/cli-host.js'), true)
  for (const file of Object.keys(files).filter(file => file.startsWith('docs/configuration/skills/'))) assert.equal(await fs.readFile(path.join(output, file), 'utf8'), files[file])
  await assert.rejects(fs.stat(path.join(output, 'docs/private.md')), { code: 'ENOENT' })
}))

test('compiled import validation rejects missing runtime modules', async () => fixture(async (root, output) => {
  await write(root, 'sibling.ts', 'export {}')
  await write(output, 'server/broken.js', compileRuntimeSource('import "./missing.ts"', path.join(root, 'entry.ts')))
  await assert.rejects(validateCompiledImports(output), /Unresolved runtime import/)
}))

test('runtime links preserve internal executables and reject escape chains', async () => fixture(async (_root, output) => {
  await write(output, 'node_modules/tool/cli.js', 'export {}')
  await fs.mkdir(path.join(output, 'node_modules', '.bin'))
  await fs.symlink('../tool/cli.js', path.join(output, 'node_modules', '.bin', 'tool'))
  await validateRuntimeLinks(output)
  await fs.symlink('../../outside', path.join(output, 'node_modules', 'escape'))
  await assert.rejects(validateRuntimeLinks(output), /escapes archive/)
}))

test('tmux binary download must match the pinned digest', () => {
  const bytes = new TextEncoder().encode('fixture binary')
  assert.equal(verifiedDownload(bytes, createHash('sha256').update(bytes).digest('hex')), bytes)
  assert.throws(() => verifiedDownload(bytes, '0'.repeat(64)), /checksum mismatch/)
})

test('repository source graph stages without missing imports or optional helper resources', async () => fixture(async (root, output) => {
  for (const directory of ['server', 'shared', 'packages', 'native/remote-desktop', 'public/mewcat', 'docs/configuration/skills']) {
    const source = path.join(repository, directory)
    await fs.cp(source, path.join(root, directory), { recursive: true, filter: file => !/(?:^|\/)(?:node_modules|\.data|\.git)(?:\/|$)/.test(path.relative(source, file)) })
  }
  for (const file of ['package.json', 'package-lock.json', 'LICENSE', 'src/utils/layout-presets.ts', 'src/utils/dock-layout.ts']) {
    await write(root, file, await fs.readFile(path.join(repository, file), 'utf8'))
  }
  await write(root, 'dist/index.html', '<main>isolated graph fixture</main>')
  await stageRuntimeSources(root, output, { version: '0.1.0', platform: 'linux', arch: 'x64', nodeMajor: 24, entrypoint: 'server/cli-host.js', tmuxVersion: '3.7c' })
  await validateCompiledImports(output)
  await validateRuntimeLinks(output)
  const helper = await import(pathToFileURL(path.join(output, 'native/remote-desktop/helper-version.mjs')).href)
  for (const name of ['korean', 'english', 'japanese', 'chinese']) {
    const file = path.join(output, 'docs/configuration/skills', `${name}-technical-docs`, 'SKILL.md')
    assert.match(await fs.readFile(file, 'utf8'), /technical-docs-common\/workflow\.md/)
  }
  for (const file of ['workflow.md', 'structure.md', 'translation.md']) await fs.access(path.join(output, 'docs/configuration/skills/technical-docs-common', file))
  const dependencies = readDocumentationDependencies(path.join(output, 'docs/configuration/skills'))
  for (const skill of dependencies.packages) {
    for (const file of skill.files.filter(file => !file.path.split('/').some(part => part.startsWith('.')))) {
      const bytes = await fs.readFile(path.join(output, 'docs/configuration/skills/.vendor', skill.name, file.path))
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `packaged ${skill.name}/${file.path}`)
    }
  }
  assert.match(helper.helperVersion(path.join(output, 'native/remote-desktop')), /^[a-f0-9]{64}$/)
  const checks: Record<string, string[]> = {
    'server/cli-host.js': ['./instance-lock.js', './serve.js'],
    'server/agent-commands.js': ['./agent-command-runner.js'],
    'server/schedules.js': ['runAgentJob.js'],
    'server/primeAdapter.js': ['primePermissionGate.js'],
    'server/agentRuntimes.js': ['primeAdapter.js', 'installAntigravityAcp.js'],
    'server/feature-agent-instructions.js': ['feature-cli.js'],
    'server/remote-access-rtc.mjs': ['./remote-access-ice.js'],
    'server/api.js': ['server/runMewUpdate.js'],
  }
  for (const [file, references] of Object.entries(checks)) {
    const source = await fs.readFile(path.join(output, file), 'utf8')
    for (const reference of references) assert.ok(source.includes(reference), `${file} must reference ${reference}`)
  }
}))

test('npm-only workflow skips runtime builds and verifies the complete existing release', async () => fixture(async (root, output) => {
  const workflow = parseYaml(await fs.readFile(path.join(repository, '.github/workflows/cli-release.yml'), 'utf8'))
  assert.equal(workflow.jobs.runtime.if, 'inputs.publish_npm != true')
  assert.match(workflow.jobs.release.if, /always\(\)/)
  assert.equal(workflow.jobs.npm.environment, 'npm-publish')
  assert.equal(workflow.jobs.npm.permissions['id-token'], 'write')
  const releaseStep = workflow.jobs.release.steps.find((step: { run?: string }) => step.run)
  const files = ['mew-runtime-linux-x64.tar.gz', 'mew-runtime-linux-arm64.tar.gz', 'mew-runtime-darwin-x64.tar.gz', 'mew-runtime-darwin-arm64.tar.gz', 'mew-runtime-win32-x64.tar.gz', 'mew-runtime-win32-arm64.tar.gz']
  const fakeRelease = path.join(root, 'published')
  const sums = []
  for (const file of files) {
    await write(fakeRelease, file, file)
    sums.push(`${createHash('sha256').update(file).digest('hex')}  ${file}`)
  }
  await write(fakeRelease, 'SHA256SUMS', sums.join('\n') + '\n')
  const gh = path.join(root, 'bin', 'gh')
  await write(root, 'bin/gh', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[1] === 'view') process.exit(process.env.FAKE_MISSING === 'true' ? 1 : 0);
if (args[1] !== 'download') { console.error('Unexpected release mutation'); process.exit(1); }
fs.cpSync(process.env.FAKE_RELEASE, args[args.indexOf('--dir') + 1], {recursive: true});
`)
  await fs.chmod(gh, 0o755)
  await write(root, 'bin/sha256sum', `#!/usr/bin/env node
const fs = require('node:fs'), crypto = require('node:crypto');
const lines = fs.readFileSync(process.argv.at(-1), 'utf8').trim().split('\\n');
for (const line of lines) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match || crypto.createHash('sha256').update(fs.readFileSync(match[2])).digest('hex') !== match[1]) process.exit(1);
}
`)
  await fs.chmod(path.join(root, 'bin', 'sha256sum'), 0o755)
  const env = { ...process.env, PATH: `${path.dirname(gh)}:${process.env.PATH}`, PUBLISH_NPM: 'true', FAKE_RELEASE: fakeRelease, RELEASE_TAG: 'mew-cli-v0.1.0', REPOSITORY: 'fixture/repository' }
  const run = async (name: string, additional = {}) => {
    const cwd = path.join(output, name)
    await fs.mkdir(cwd, { recursive: true })
    return exec('/bin/bash', ['-e', '-c', releaseStep.run], { cwd, env: { ...env, ...additional } })
  }
  await run('complete')
  await write(fakeRelease, 'SHA256SUMS', sums[0] + '\n')
  await assert.rejects(run('subset'), /Command failed/)
  await write(fakeRelease, 'SHA256SUMS', sums.join('\n') + '\n')
  await write(fakeRelease, files[0], 'corrupted bytes')
  await assert.rejects(run('corrupt'), /Command failed/)
  await assert.rejects(run('missing', { FAKE_MISSING: 'true' }), /Publish the tagged runtime release/)
}))

test('npm publication skips identical versions and rejects changed bytes or registry errors', async () => fixture(async (root, output) => {
  const workflow = parseYaml(await fs.readFile(path.join(repository, '.github/workflows/cli-release.yml'), 'utf8'))
  const npmStep = workflow.jobs.npm.steps.find((step: { id?: string }) => step.id === 'package')
  const publishStep = workflow.jobs.npm.steps.find((step: { run?: string }) => step.run === 'npm publish --access public')
  assert.equal(publishStep.if, "steps.package.outputs.publish == 'true'")
  await write(root, 'bin/npm', `#!/usr/bin/env node
const action = process.argv[2];
if (action === 'pack') { console.log(JSON.stringify([{integrity: 'sha512-fixture'}])); process.exit(0); }
if (action !== 'view') process.exit(1);
const registry = process.env.FAKE_REGISTRY;
if (registry === 'same' || registry === 'different') { console.log(JSON.stringify(registry === 'same' ? 'sha512-fixture' : 'sha512-other')); process.exit(0); }
const code = registry === 'missing' ? 'E404' : 'E401';
console.log(JSON.stringify({error: {code}})); console.error('npm error ' + code); process.exit(1);
`)
  const npm = path.join(root, 'bin', 'npm')
  await fs.chmod(npm, 0o755)
  const run = async (registry: string) => {
    const cwd = path.join(output, registry), result = path.join(cwd, 'step-output')
    await write(cwd, 'package.json', '{"name":"@fixture/mew-cli","version":"0.1.0"}')
    await exec('/bin/bash', ['-e', '-c', npmStep.run], { cwd, env: { ...process.env, PATH: `${path.dirname(npm)}:${process.env.PATH}`, FAKE_REGISTRY: registry, GITHUB_OUTPUT: result } })
    return fs.readFile(result, 'utf8')
  }
  assert.equal(await run('same'), 'publish=false\n')
  assert.equal(await run('missing'), 'publish=true\n')
  await assert.rejects(run('different'), /different package bytes/)
  await assert.rejects(run('unauthorized'), /E401/)
}))
