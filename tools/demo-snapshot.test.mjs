import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createDemoSnapshot, includeDemoSource, createDemoRepositoryIndex, createDemoRepositorySource, includeDemoRepositorySource, MAX_REPOSITORY_INDEX_BYTES, MAX_REPOSITORY_INDEX_GZIP_BYTES } from './demo-snapshot.mjs'
import { demoRepositoryPlugin } from './demo-repository-plugin.mjs'

test('snapshot selection excludes private, generated, historical and oversized input', () => {
  for (const filename of ['.env', '.data/users.json', '.mew/settings.json', 'src/demo/repository-snapshot.json', 'docs/history/old.md', 'docs/research/raw.md', 'public/video.mp4', 'node_modules/tool.ts', 'mewlink/private.ts']) {
    assert.equal(includeDemoSource(filename, 10), false, filename)
  }
  assert.equal(includeDemoSource('docs/features/Editor.md', 17 * 1024), false)
  assert.equal(includeDemoSource('src/main.tsx', 49 * 1024), false)
  assert.equal(includeDemoSource('docs/tasks/Task.md', 9 * 1024), false)
  assert.equal(includeDemoSource('shared/features.ts', 1024), true)
})

test('snapshot reads committed blobs, omits accounts and never changes working files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-demo-snapshot-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git(['init', '-q'])
  for (const [filename, content] of Object.entries({
    'README.md': '# Mew snapshot test\n', 'LICENSE': 'MIT\n', 'src/main.tsx': 'export const version = 1\n',
    'docs/tasks/Task.md': '---\ntitle: Task\ndescription: Test task\ndone: false\nassignees: [owner@example.test]\n---\n\nKeep the original task body.\n',
    '.env': 'EXCLUDED=fixture-value\n',
  })) {
    await fs.mkdir(path.dirname(path.join(root, filename)), { recursive: true })
    await fs.writeFile(path.join(root, filename), content)
  }
  git(['add', 'README.md', 'LICENSE', 'src/main.tsx', 'docs/tasks/Task.md', '.env'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'test'])
  await fs.writeFile(path.join(root, 'src/main.tsx'), 'UNCOMMITTED_CONTENT\n')
  const before = git(['status', '--porcelain']).toString()
  const result = createDemoSnapshot(root)
  assert.equal(result.snapshot.files['src/main.tsx'], 'export const version = 1\n')
  assert.ok(!result.json.includes('UNCOMMITTED_CONTENT'))
  assert.ok(!result.json.includes('owner@example.test'))
  assert.ok(!result.json.includes('EXCLUDED'))
  assert.match(result.snapshot.files['docs/tasks/Task.md'], /Keep the original task body/)
  assert.equal(git(['status', '--porcelain']).toString(), before)
  assert.equal(await fs.readFile(path.join(root, 'src/main.tsx'), 'utf8'), 'UNCOMMITTED_CONTENT\n')
})

async function repositoryFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-demo-index-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git(['init', '-q'])
  const binary = Buffer.from([137, 80, 78, 71, 13, 10, 0, 255, 254])
  const contents = {
    'README.md': '# Committed Mew\n',
    'src/main.tsx': 'export const source = "committed"\n',
    'src/large.ts': 'x'.repeat(100 * 1024),
    'src/bom.ts': '\ufeffexport const bom = true\n',
    '.github/workflows/check.yml': 'name: Public workflow\n',
    '.mew/project-icon.json': '{"icon":"public"}\n',
    '.mew/assets/example.png': binary,
    '.env.example': 'PUBLIC_EXAMPLE=\n',
    '.env.production': 'EXCLUDED_PRIVATE_VALUE',
    '.data/users.json': 'EXCLUDED_USER_VALUE',
    'credentials.json': 'EXCLUDED_CREDENTIAL_VALUE',
    'mewlink/private.ts': 'EXCLUDED_CENTRAL_VALUE',
    'node_modules/package/index.js': 'EXCLUDED_INSTALLED_VALUE',
    'dist/assets/old.js': 'EXCLUDED_BUILD_VALUE',
    'src/demo/repository-index.json': 'EXCLUDED_RECURSIVE_VALUE',
    'src/demo/repository-snapshot.json': '{"format":"mew-demo-snapshot/v1"}\n',
    'docs/history/old.md': '# Historical public source\n',
    'docs/research/raw.md': '# Research public source\n',
    'docs/tasks/Task.md': '---\ntitle: Task\ndescription: Test task\ndone: false\nassignees: [owner@example.test]\n---\n\nKeep the task body.\n',
    'public/invalid-utf8.dat': Buffer.from([255, 254, 253]),
    'public/example.svg': '<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>',
    'public/example.html': '<html><script>example()</script></html>',
  }
  for (const [filename, content] of Object.entries(contents)) {
    await fs.mkdir(path.dirname(path.join(root, filename)), { recursive: true })
    await fs.writeFile(path.join(root, filename), content)
  }
  await fs.symlink('README.md', path.join(root, 'linked-readme'))
  git(['add', '-A'])
  const commit = () => git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'])
  commit()
  return { root, git, commit, binary, contents }
}

test('full repository index includes public hidden config, binaries, history and complete large files', async t => {
  const fixture = await repositoryFixture(t)
  const { root, git } = fixture
  await fs.writeFile(path.join(root, 'src/main.tsx'), 'UNCOMMITTED_STAGED_CONTENT')
  git(['add', 'src/main.tsx'])
  await fs.writeFile(path.join(root, 'src/main.tsx'), 'UNCOMMITTED_WORKTREE_CONTENT')
  await fs.writeFile(path.join(root, 'untracked.txt'), 'UNTRACKED_CONTENT')
  const status = git(['status', '--porcelain']).toString()
  const result = createDemoRepositoryIndex(root)
  assert.equal(result.index.format, 'mew-demo-snapshot/v2')
  assert.ok(result.bytes < MAX_REPOSITORY_INDEX_BYTES)
  assert.ok(result.gzipBytes < MAX_REPOSITORY_INDEX_GZIP_BYTES)
  assert.ok(!result.json.includes('export const'))
  assert.ok(!result.json.includes(fixture.binary.toString('base64')))
  const source = createDemoRepositorySource(result.index, root)
  const objects = new Map(source.objects())
  for (const filename of ['.github/workflows/check.yml', '.mew/project-icon.json', '.mew/assets/example.png', '.env.example', 'docs/history/old.md', 'docs/research/raw.md', 'src/large.ts', 'src/demo/repository-snapshot.json']) {
    assert.equal(includeDemoRepositorySource(filename), true, filename)
    assert.ok(result.index.files[filename], filename)
  }
  for (const filename of ['.env.production', '.data/users.json', 'credentials.json', 'mewlink/private.ts', 'node_modules/package/index.js', 'dist/assets/old.js', 'src/demo/repository-index.json', 'linked-readme', 'untracked.txt']) assert.equal(Object.hasOwn(result.index.files, filename), false, filename)
  for (const [filename, entry] of Object.entries(result.index.files)) {
    const payload = source.load(entry.oid), decoded = JSON.parse(payload)
    assert.equal(payload, objects.get(entry.oid))
    assert.equal(createHash('sha256').update(payload).digest('hex'), entry.oid)
    assert.equal(Buffer.byteLength(entry.binary ? Buffer.from(decoded.base64, 'base64') : decoded.content), entry.size, filename)
    if (!entry.binary) assert.equal(typeof decoded.content, 'string')
  }
  assert.equal(JSON.parse(source.load(result.index.files['src/main.tsx'].oid)).content, fixture.contents['src/main.tsx'])
  assert.equal(JSON.parse(source.load(result.index.files['src/bom.ts'].oid)).content, fixture.contents['src/bom.ts'])
  assert.equal(result.index.files['src/large.ts'].size, 100 * 1024)
  assert.match(source.load(result.index.files['docs/tasks/Task.md'].oid), /Keep the task body/)
  assert.ok(![...objects.values()].join('').includes('owner@example.test'))
  assert.ok(![...objects.values()].join('').includes('EXCLUDED_'))
  assert.deepEqual(source.loadBinary(result.index.files['.mew/assets/example.png'].oid), { bytes: fixture.binary, contentType: 'image/png' })
  const svg = result.index.files['public/example.svg']
  assert.equal(svg.binary, false)
  assert.deepEqual(source.loadRaw(svg.oid), { bytes: Buffer.from(fixture.contents['public/example.svg']), contentType: 'image/svg+xml' })
  assert.deepEqual(source.rawExtensions(svg.oid), ['svg'])
  assert.equal(result.index.files['public/invalid-utf8.dat'].binary, true)
  assert.equal(git(['status', '--porcelain']).toString(), status)
})

test('repository objects remain pinned after later commits and reject mismatched metadata', async t => {
  const { root, git, commit } = await repositoryFixture(t)
  const result = createDemoRepositoryIndex(root)
  await fs.writeFile(path.join(root, 'src/main.tsx'), 'export const source = "new commit"\n')
  git(['add', 'src/main.tsx'])
  commit()
  const source = createDemoRepositorySource(result.index, root), entry = result.index.files['src/main.tsx']
  assert.equal(source.has(entry.oid), true)
  assert.equal(source.has('f'.repeat(64)), false)
  assert.equal(source.isBinary(entry.oid), false)
  assert.match(source.load(entry.oid), /committed/)
  assert.throws(() => source.load('f'.repeat(64)), /찾을 수 없습니다/)
  assert.throws(() => source.loadBinary(entry.oid), /바이너리/)
  for (const change of [{ size: entry.size + 1 }, { binary: true }, { oid: 'e'.repeat(64) }]) {
    const index = structuredClone(result.index)
    index.files['src/main.tsx'] = { ...entry, ...change }
    assert.throws(() => createDemoRepositorySource(index, root).load(index.files['src/main.tsx'].oid), /기준 목록과 다릅니다/)
  }
  const missing = structuredClone(result.index)
  delete missing.files['README.md']
  assert.throws(() => createDemoRepositorySource(missing, root), /기준 커밋의 파일/)
  assert.throws(() => createDemoRepositorySource({ ...result.index, revision: 'HEAD' }, root), /목록 형식/)
  const wrongRevision = { ...result.index, revision: git(['rev-parse', 'HEAD']).toString().trim() }
  assert.throws(() => createDemoRepositorySource(wrongRevision, root).load(entry.oid), /기준 목록과 다릅니다/)
})

test('repository plugin emits verified independent objects and serves only requested committed objects', async t => {
  const { root, binary } = await repositoryFixture(t)
  const result = createDemoRepositoryIndex(root)
  await fs.writeFile(path.join(root, 'src/demo/repository-index.json'), result.json)
  const plugin = demoRepositoryPlugin({ root })
  const assets = new Map()
  plugin.generateBundle.call({ emitFile(asset) { assets.set(asset.fileName, asset.source) } })
  const object = result.index.files['.mew/assets/example.png']
  assert.deepEqual(assets.get(`repository/${object.oid}.bin`), binary)
  assert.deepEqual(assets.get(`repository/${object.oid}.png`), binary)
  assert.equal(typeof assets.get(`repository/${object.oid}.json`), 'string')
  let middleware
  plugin.configureServer({ middlewares: { use(handler) { middleware = handler } } })
  function request(url) {
    const response = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value }, end(body) { this.body = body } }
    middleware({ url }, response, () => { response.next = true })
    return response
  }
  const text = result.index.files['README.md']
  const response = request(`/demo/repository/${text.oid}.json`)
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['Cache-Control'], /immutable/)
  assert.equal(response.body, assets.get(`repository/${text.oid}.json`))
  assert.deepEqual(request(`/demo/repository/${object.oid}.bin`).body, binary)
  assert.equal(request(`/repository/${object.oid}.bin`).headers['Content-Type'], 'application/octet-stream')
  assert.equal(request(`/repository/${object.oid}.bin`).headers['Content-Disposition'], 'attachment')
  assert.equal(request(`/repository/${object.oid}.png`).headers['Content-Type'], 'image/png')
  assert.equal(request(`/demo/repository/${'a'.repeat(64)}.json`).statusCode, 404)
  assert.equal(request(`/demo/repository/${text.oid}.bin`).body.toString(), '# Committed Mew\n')
  const svg = result.index.files['public/example.svg']
  assert.equal(request(`/demo/repository/${svg.oid}.svg`).headers['Content-Type'], 'image/svg+xml')
  const html = result.index.files['public/example.html']
  assert.equal(request(`/demo/repository/${html.oid}.html`).statusCode, 404)
  assert.equal(assets.has(`repository/${html.oid}.html`), false)
  assert.equal(assets.has(`repository/${result.index.files['src/main.tsx'].oid}.js`), false)
  assert.equal(request('/demo/repository/../../.env').statusCode, 404)
  assert.equal(request('/demo/assets/main.js').next, true)
  const corrupt = structuredClone(result.index)
  corrupt.files['README.md'].size++
  await fs.writeFile(path.join(root, 'src/demo/repository-index.json'), JSON.stringify(corrupt))
  assert.equal(request(`/demo/repository/${text.oid}.json`).statusCode, 500)
  assert.throws(() => plugin.generateBundle.call({ emitFile() {} }), /기준 목록과 다릅니다/)
})
