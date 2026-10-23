import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { androidCommands, defaultSdkRoot, isSystemImageInstalled, systemImageArchitecture } from './androidEnv.ts'

test('uses the platform default Android SDK location', () => {
  assert.equal(defaultSdkRoot('linux', '/home/mew'), '/home/mew/Android/Sdk')
  assert.equal(defaultSdkRoot('darwin', '/Users/mew'), '/Users/mew/Library/Android/sdk')
})

test('selects a system image matching the host CPU', () => {
  assert.equal(systemImageArchitecture('arm64'), 'arm64-v8a')
  assert.equal(systemImageArchitecture('x64'), 'x86_64')
})

test('recognizes only a fully installed system image package', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-android-sdk-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const packageId = 'system-images;android-36;google_apis;x86_64'
  const packageDir = path.join(root, 'system-images', 'android-36', 'google_apis', 'x86_64')

  fs.mkdirSync(packageDir, { recursive: true })
  assert.equal(isSystemImageInstalled(root, packageId), false)

  fs.writeFileSync(path.join(packageDir, 'package.xml'), '<localPackage />')
  assert.equal(isSystemImageInstalled(root, packageId), true)
})

test('builds fixed Android actions with hidden, distinct tmux sessions', () => {
  const commands = androidCommands('/opt/android-sdk', 'x64')
  assert.deepEqual(commands.map((item) => item.id), ['licenses', 'install-image', 'create-avd', 'start-emulator'])
  assert.match(commands.find((item) => item.id === 'install-image')?.command ?? '', /system-images;android-36;google_apis;x86_64/)
  assert.equal(new Set(commands.map((item) => item.session)).size, commands.length)
  for (const command of commands) assert.match(command.session, /^mewcmd-[a-z0-9]+$/)
})
