import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultSdkRoot, systemImageArchitecture } from './androidEnv.ts'

test('uses the platform default Android SDK location', () => {
  assert.equal(defaultSdkRoot('linux', '/home/mew'), '/home/mew/Android/Sdk')
  assert.equal(defaultSdkRoot('darwin', '/Users/mew'), '/Users/mew/Library/Android/sdk')
})

test('selects a system image matching the host CPU', () => {
  assert.equal(systemImageArchitecture('arm64'), 'arm64-v8a')
  assert.equal(systemImageArchitecture('x64'), 'x86_64')
})
