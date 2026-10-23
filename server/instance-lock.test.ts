import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lockInstance } from './instance-lock.ts'

test('server entrypoints share one data lease and reclaim a dead server', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-instance-lock-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const unlock = lockInstance(directory)
  assert.throws(() => lockInstance(directory), /이미 실행 중/)
  unlock()
  fs.writeFileSync(path.join(directory, 'server.lock'), JSON.stringify({ pid: 99999999, token: 'dead' }))
  const release = lockInstance(directory, () => false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'server.lock'), 'utf8')).pid, process.pid)
  release()
  assert.deepEqual(fs.readdirSync(directory), [])
})

test('a release callback cannot remove a newer lease', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-instance-lock-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const release = lockInstance(directory)
  fs.writeFileSync(path.join(directory, 'server.lock'), JSON.stringify({ pid: process.pid, token: 'replacement' }))
  release()
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'server.lock'), 'utf8')).token, 'replacement')
})
