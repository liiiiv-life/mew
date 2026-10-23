import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import * as tar from 'tar'
import { runtimeTarget, checksumFor, safeArchiveEntry, prepareRuntime } from '../src/runtime.mjs'
import { parseOptions } from '../src/options.mjs'
import { acquireDataLock, checkLegacyInstance } from '../src/lock.mjs'
import { runHost, runtimeEnvironment } from '../src/launcher.mjs'
import { hostPaths } from '../src/platform/index.mjs'

async function directory(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-cli-test-'))
  t.after(() => fs.rm(temp, { recursive: true, force: true }))
  return temp
}

test('release target rejects unsupported OS, Node ABI and musl', () => {
  assert.deepEqual(runtimeTarget('linux', 'arm64', '24.1.0', '2.35'), { platform: 'linux', arch: 'arm64', nodeMajor: 24 })
  assert.equal(runtimeTarget('win32', 'x64', '24.1.0', undefined, '10.0.22631').platform, 'win32')
  assert.equal(runtimeTarget('darwin', 'arm64', '24.1.0', undefined, '24.0.0').platform, 'darwin')
  for (const args of [['linux', 'x64', '22.1.0'], ['linux', 'x64', '24.1.0', null], ['linux', 'x64', '24.1.0', '2.31'], ['darwin', 'x64', '24.1.0', undefined, '23.0.0']]) assert.throws(() => runtimeTarget(...args))
})

test('CLI cwd and explicit options override old configuration without rewriting it', async t => {
  const dir = await directory(t), env = { XDG_CONFIG_HOME: path.join(dir, 'config'), LOCALAPPDATA: path.join(dir, 'local') }, configDir = hostPaths(env).config
  await fs.mkdir(configDir, { recursive: true })
  const config = 'MEW_WORKSPACE=/old/workspace\nMEW_DATA_DIR=/old/data\nMEW_TEAM_PORT=9000\n'
  await fs.writeFile(path.join(configDir, 'config.env'), config)
  const options = parseOptions(['--data-dir', 'persistent', '--port', '0', '--no-open'], { cwd: dir, env })
  assert.equal(options.workspace, dir)
  assert.equal(options.dataDir, path.join(dir, 'persistent'))
  assert.equal(options.port, 0)
  assert.equal(options.open, false)
  assert.equal(await fs.readFile(path.join(configDir, 'config.env'), 'utf8'), config)
  assert.equal(parseOptions([], { cwd: dir, env }).dataDir, path.resolve(dir, '/old/data'))
  for (const args of [['--port', 'NaN'], ['--port', '-1'], ['--unknown'], ['--workspace']]) assert.throws(() => parseOptions(args, { cwd: dir, env: {} }))
})

test('extractor rejects escaping paths and links while preserving internal executable links', () => {
  assert.equal(safeArchiveEntry('node_modules/.bin/tool', { type: 'SymbolicLink', linkpath: '../tool/bin.js', size: 0 }), true)
  assert.equal(safeArchiveEntry('node_modules/@mew/ui', { type: 'SymbolicLink', linkpath: '../../packages/ui', size: 0 }), true)
  for (const [name, entry] of [
    ['../outside', { type: 'File' }], ['/absolute', { type: 'File' }],
    ['bin/bad', { type: 'SymbolicLink', linkpath: '../../outside' }],
    ['bin/bad', { type: 'Link', linkpath: '../outside' }],
    ['bin/device', { type: 'CharacterDevice' }],
  ]) assert.throws(() => safeArchiveEntry(name, entry))
})

async function runtimeFixture(t, platform = 'linux') {
  const dir = await directory(t), source = path.join(dir, 'source'), cacheDir = path.join(dir, 'cache')
  for (const sub of ['server', 'dist', 'bin']) await fs.mkdir(path.join(source, sub), { recursive: true })
  const target = { platform, arch: 'x64', nodeMajor: 24 }
  await fs.writeFile(path.join(source, 'mew-runtime.json'), JSON.stringify({ version: '0.1.0', ...target, entrypoint: 'server/cli-host.js' }))
  await fs.writeFile(path.join(source, 'server/cli-host.js'), '// fixture\n')
  await fs.writeFile(path.join(source, 'dist/index.html'), '<html></html>')
  await fs.writeFile(path.join(source, 'bin/tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  if (platform === 'win32') {
    for (const sub of ['native/windows', 'packages/ui', 'node_modules/@mew']) await fs.mkdir(path.join(source, sub), { recursive: true })
    await fs.writeFile(path.join(source, 'bin/psmux.exe'), 'fixture', { mode: 0o755 })
    await fs.writeFile(path.join(source, 'native/windows/process-host.exe'), 'fixture')
    await fs.writeFile(path.join(source, 'packages/ui/fixture.txt'), 'workspace')
    await fs.writeFile(path.join(source, 'runtime-links.json'), JSON.stringify([{ path: 'node_modules/@mew/ui', target: '../../packages/ui' }]))
  }
  const archive = path.join(dir, 'fixture.tar.gz')
  await tar.c({ gzip: true, cwd: source, file: archive }, ['.'])
  const bytes = await fs.readFile(archive), checksum = createHash('sha256').update(bytes).digest('hex')
  const filename = `mew-runtime-${platform}-x64.tar.gz`
  return { dir, cacheDir, target, bytes, filename, checksum, version: '0.1.0' }
}

test('downloads are verified, atomically cached and reusable offline with executable modes', async t => {
  const fixture = await runtimeFixture(t), requests = []
  const options = { ...fixture, fetchImpl: async url => {
    requests.push(url)
    return new Response(url.endsWith('SHA256SUMS') ? `${fixture.checksum}  ${fixture.filename}\n` : fixture.bytes)
  } }
  const runtime = await prepareRuntime(options)
  assert.equal(requests.length, 2)
  assert.ok(process.platform === 'win32' || (await fs.stat(path.join(runtime, 'bin/tmux'))).mode & 0o111)
  assert.equal(await prepareRuntime({ ...options, fetchImpl: () => { throw new Error('offline') } }), runtime)
  assert.deepEqual((await fs.readdir(fixture.cacheDir)).filter(name => name.startsWith('.download-')), [])
})

test('wrong checksums never install executable code and cleanup the download', async t => {
  const fixture = await runtimeFixture(t)
  await assert.rejects(prepareRuntime({ ...fixture, fetchImpl: async url => new Response(url.endsWith('SHA256SUMS') ? `${'0'.repeat(64)}  ${fixture.filename}\n` : fixture.bytes) }), /SHA-256/)
  assert.deepEqual(await fs.readdir(fixture.cacheDir), [])
  assert.throws(() => checksumFor(`${fixture.checksum}  ${fixture.filename}\n${fixture.checksum}  ${fixture.filename}`, fixture.filename))
})

test('cache installs race safely and retain one complete release', async t => {
  const fixture = await runtimeFixture(t), fetchImpl = async url => new Response(url.endsWith('SHA256SUMS') ? `${fixture.checksum}  ${fixture.filename}\n` : fixture.bytes)
  const results = await Promise.all([prepareRuntime({ ...fixture, fetchImpl }), prepareRuntime({ ...fixture, fetchImpl })])
  assert.equal(results[0], results[1])
  assert.equal((await fs.readdir(fixture.cacheDir)).length, 1)
})

test('an incomplete cached release is reported without downloading or overwriting it', async t => {
  const fixture = await runtimeFixture(t)
  const runtime = await prepareRuntime({ ...fixture, fetchImpl: async url => new Response(url.endsWith('SHA256SUMS') ? `${fixture.checksum}  ${fixture.filename}\n` : fixture.bytes) })
  await fs.unlink(path.join(runtime, 'server/cli-host.js'))
  await assert.rejects(prepareRuntime({ ...fixture, fetchImpl: () => { throw new Error('should not download') } }), /캐시된 실행 패키지가 손상/)
  assert.ok(await fs.stat(path.join(runtime, 'dist/index.html')))
})

test('an actual escaping tar link rejects cleanly and removes the temporary download', async t => {
  const fixture = await runtimeFixture(t)
  const header = new tar.Header({ path: 'escape', type: 'SymbolicLink', linkpath: '../outside', size: 0 })
  header.encode()
  const bytes = gzipSync(Buffer.concat([header.block, Buffer.alloc(1024)])), checksum = createHash('sha256').update(bytes).digest('hex')
  await assert.rejects(prepareRuntime({ ...fixture, fetchImpl: async url => new Response(url.endsWith('SHA256SUMS') ? `${checksum}  ${fixture.filename}\n` : bytes) }), /링크가 패키지 밖/)
  assert.deepEqual(await fs.readdir(fixture.cacheDir), [])
})

test('legacy source server detection reports an active pid without stopping it', { skip: process.platform === 'win32' }, async t => {
  const dir = await directory(t), file = path.join(dir, 'mew.pid')
  await checkLegacyInstance(file)
  await fs.writeFile(file, '12345\n')
  await assert.rejects(checkLegacyInstance(file, () => true, async () => true), /기존 .\/mew 서버/)
  await checkLegacyInstance(file, () => true, async () => false)
  await checkLegacyInstance(file, () => false)
  assert.equal(await fs.readFile(file, 'utf8'), '12345\n')
})

test('Windows packages restore workspace junctions after the cache directory moves', async t => {
  const fixture = await runtimeFixture(t, 'win32')
  const runtime = await prepareRuntime({ ...fixture, fetchImpl: async url => new Response(url.endsWith('SHA256SUMS') ? `${fixture.checksum}  ${fixture.filename}\n` : fixture.bytes) })
  assert.equal(await fs.readFile(path.join(runtime, 'node_modules/@mew/ui/fixture.txt'), 'utf8'), 'workspace')
  assert.equal(await fs.realpath(path.join(runtime, 'node_modules/@mew/ui')), await fs.realpath(path.join(runtime, 'packages/ui')))
  for (const name of ['bin/CON.txt', 'bin/a:stream', 'bin/a.', 'bin/a ']) assert.throws(() => safeArchiveEntry(name, { type: 'File', size: 0 }, 'win32'))
})

test('data lock rejects a running instance and reclaims stale locks', async t => {
  const dir = await directory(t), unlock = await acquireDataLock(dir)
  await assert.rejects(acquireDataLock(dir), /이미 실행 중/)
  await unlock()
  await fs.writeFile(path.join(dir, 'cli-host.lock'), JSON.stringify({ pid: 99999999, token: 'dead' }))
  const release = await acquireDataLock(dir, () => false)
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'cli-host.lock'), 'utf8')).pid, process.pid)
  await release()
  assert.equal((await fs.readdir(dir)).length, 0)
})

test('launcher passes current workspace and persistent data separately from cached app', async () => {
  const child = new EventEmitter()
  child.connected = true
  child.kill = () => queueMicrotask(() => child.emit('exit', 1, null))
  const messages = [], logs = [], opened = []
  child.send = message => {
    messages.push(message)
    queueMicrotask(() => {
      child.emit('message', { type: 'owner-created', email: message.email, password: 'fixture-only' })
      child.emit('message', { type: 'ready', url: 'http://127.0.0.1:7000' })
      child.emit('exit', 0, null)
    })
  }
  const options = { workspace: '/workspace', dataDir: '/persistent', port: 7000, ownerEmail: 'owner@example.test', open: true }
  const exitCode = await runHost('/cached/app', options, { log: value => logs.push(value), browser: value => opened.push(value), forkImpl: (file, args, config) => {
    assert.equal(file, path.join('/cached/app', 'server/cli-host.js'))
    assert.deepEqual(args, [])
    assert.equal(config.cwd, options.workspace)
    assert.equal(config.env.MEW_DATA_DIR, options.dataDir)
    assert.equal(config.env.MEW_BIND, '127.0.0.1')
    queueMicrotask(() => child.emit('message', { type: 'setup-needed' }))
    return child
  } })
  assert.equal(exitCode, 0)
  assert.deepEqual(messages, [{ type: 'setup-owner', email: options.ownerEmail }])
  assert.deepEqual(opened, ['http://127.0.0.1:7000'])
  assert.ok(logs.some(value => value.includes('fixture-only')))
  assert.equal(runtimeEnvironment('/cached/app', options, { PATH: '/usr/bin', MEW_WORKSPACE: '/old' }).MEW_WORKSPACE, options.workspace)
})
