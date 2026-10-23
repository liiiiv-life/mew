import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error Native helper JavaScript runs outside the server.
import { installPosixVideo, pkgArguments } from '../native/remote-desktop/install-posix-video.mjs'
// @ts-expect-error Native helper JavaScript runs outside the server.
import { installNativeRuntime } from '../native/remote-desktop/install-native-runtime.mjs'

test('native POSIX video install atomically publishes only after compile/sign checks and never executes pkg-config as a shell', () => {
  for (const platform of ['linux', 'darwin']) {
    const commands: { command: string; args: string[] }[] = [], published: string[][] = []
    const target = "/fixture/Mew's $(literal) helper"
    const options = { target, platform, log() {}, exists: () => true, remove() {}, rename: (a: string, b: string) => published.push([a, b]),
      run: (command: string, args: string[]) => { commands.push({ command, args }); return { status: 0, stdout: '-I/fixture/include\\ with\\ space -lgstapp-1.0' } } }
    installPosixVideo(options)
    assert.equal(published.length, 1)
    assert.equal(commands.some(call => ['sh', 'bash'].includes(call.command)), false)
    assert.equal(commands.some(call => call.args.some(arg => arg.includes('electron') || arg.includes('x264enc'))), false)
    if (platform === 'linux') assert.ok(commands.at(-1)!.args.includes('-I/fixture/include with space'))
    else assert.ok(commands.some(call => call.command === '/usr/bin/codesign' && call.args.at(-1) === path.join(target, 'MewDesktop.app')))
    published.length = 0
    let call = 0
    assert.throws(() => installPosixVideo({ ...options, run: () => ({ status: ++call === 2 ? 1 : 0 }) }))
    assert.equal(published.length, 0)
  }
  assert.deepEqual(pkgArguments("-I'/a b' -lva -L/a\\ b"), ['-I/a b', '-lva', '-L/a b'])
  assert.throws(() => pkgArguments("-I'unclosed"))
})

test('native Mac/Linux runtime copies the current Node and its license, checks native bindings and gives Mac a stable app identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-native-runtime-'))
  try {
    for (const platform of ['linux', 'darwin']) {
      const calls: { command: string; args: string[] }[] = []
      installNativeRuntime({ target: root, platform, log() {}, run: (command: string, args: string[]) => { calls.push({ command, args }); return { status: 0 } } })
      const binary = path.join(root, platform === 'darwin' ? 'MewDesktop.app/Contents/MacOS/MewDesktop' : 'runtime/node')
      assert.ok((await fs.stat(binary)).mode & 0o111)
      assert.equal(calls.some(call => call.args.some(arg => /electron|install\.js/.test(arg))), false)
      assert.ok(calls.some(call => call.args.some(arg => arg.includes('node-datachannel'))))
      assert.ok(await fs.stat(path.join(root, platform === 'darwin' ? 'MewDesktop.app/Contents/Resources/Node.LICENSE' : 'runtime/Node.LICENSE')))
      if (platform === 'darwin') {
        const info = await fs.readFile(path.join(root, 'MewDesktop.app/Contents/Info.plist'), 'utf8')
        assert.match(info, /dev\.liiiiv\.mew\.desktop/)
        assert.match(info, /<key>NSLocalNetworkUsageDescription<\/key><string>[^<]*temporary UDP mappings/)
      }
    }
    assert.throws(() => installNativeRuntime({ target: root, platform: 'linux', log() {}, run: () => ({ status: 1 }) }), /구성 요소/)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
