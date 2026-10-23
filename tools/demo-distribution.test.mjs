import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildDemoDistribution, copyDemoDistribution, demoSourceFingerprint } from './demo-distribution.mjs'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-demo-distribution-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const directory of ['src', 'public', 'shared', 'tools']) await fs.mkdir(path.join(root, directory))
  await fs.writeFile(path.join(root, 'src/main.ts'), 'export const version = 1')
  await fs.writeFile(path.join(root, 'demo.html'), '<html>demo entry</html>')
  for (const filename of ['demo-distribution.mjs', 'demo-snapshot.mjs', 'demo-repository-plugin.mjs', 'demo-repository-plugin.d.mts']) await fs.writeFile(path.join(root, 'tools', filename), 'fixture build script')
  const executeBuild = async () => {
    await fs.mkdir(path.join(root, 'dist-demo/assets'), { recursive: true })
    await fs.writeFile(path.join(root, 'dist-demo/demo.html'), '<html><script src="/demo/assets/main.js"></script></html>')
    await fs.writeFile(path.join(root, 'dist-demo/assets/main.js'), 'fixture bundle')
  }
  return { root, executeBuild, destination: path.join(root, 'central-dist/demo') }
}

test('verified demo artifacts deploy under a stable subdirectory without copying another app entry', async t => {
  const options = await fixture(t)
  await buildDemoDistribution(options)
  await fs.mkdir(options.destination, { recursive: true })
  await fs.writeFile(path.join(options.destination, 'old.js'), 'old build')
  const result = await copyDemoDistribution(options)
  assert.equal(result.files, 2)
  assert.match(await fs.readFile(path.join(options.destination, 'index.html'), 'utf8'), /\/demo\/assets\/main.js/)
  assert.equal(await fs.readFile(path.join(options.destination, 'assets/main.js'), 'utf8'), 'fixture bundle')
  for (const filename of ['demo.html', 'old.js', 'mew-demo-build.json']) await assert.rejects(fs.access(path.join(options.destination, filename)))
})

test('missing, stale and modified builds cannot overwrite the previous deployment', async t => {
  const options = await fixture(t)
  await fs.mkdir(options.destination, { recursive: true })
  const previous = path.join(options.destination, 'index.html')
  await fs.writeFile(previous, 'previous deployment')
  await assert.rejects(copyDemoDistribution(options), /검증 가능한 데모 빌드가 없습니다/)
  await buildDemoDistribution(options)
  await fs.writeFile(path.join(options.root, 'src/main.ts'), 'export const version = 2')
  await assert.rejects(copyDemoDistribution(options), /현재 소스가 다릅니다/)
  assert.equal(await fs.readFile(previous, 'utf8'), 'previous deployment')
  await buildDemoDistribution(options)
  await fs.writeFile(path.join(options.root, 'dist-demo/assets/main.js'), 'changed after build')
  await assert.rejects(copyDemoDistribution(options), /변경되거나 누락/)
  assert.equal(await fs.readFile(previous, 'utf8'), 'previous deployment')
})

test('concurrent source edits and symbolic links cannot produce a verified artifact', async t => {
  const options = await fixture(t)
  await assert.rejects(buildDemoDistribution({ ...options, executeBuild: async () => {
    await options.executeBuild()
    await fs.writeFile(path.join(options.root, 'src/main.ts'), 'edited during build')
  } }), /빌드 중 데모 소스가 변경/)
  await assert.rejects(fs.access(path.join(options.root, 'dist-demo/mew-demo-build.json')))
  await fs.symlink(path.join(options.root, 'demo.html'), path.join(options.root, 'public/external.html'))
  await assert.rejects(buildDemoDistribution(options), /심볼릭 링크/)
})

test('repository generator, plugin and pinned index affect fingerprints while unrelated HEAD changes do not', async t => {
  const options = await fixture(t)
  await fs.mkdir(path.join(options.root, 'src/demo'))
  const indexPath = path.join(options.root, 'src/demo/repository-index.json')
  await fs.writeFile(indexPath, '{"revision":"pinned-one","files":{}}')
  let previous = await demoSourceFingerprint(options.root)
  await fs.mkdir(path.join(options.root, '.git'))
  await fs.writeFile(path.join(options.root, '.git/HEAD'), 'unrelated commit')
  assert.deepEqual(await demoSourceFingerprint(options.root), previous)
  for (const filename of ['tools/demo-snapshot.mjs', 'tools/demo-repository-plugin.mjs', 'src/demo/repository-index.json']) {
    await fs.appendFile(path.join(options.root, filename), '\nchanged')
    const current = await demoSourceFingerprint(options.root)
    assert.notEqual(current.fingerprint, previous.fingerprint, filename)
    previous = current
  }
})
