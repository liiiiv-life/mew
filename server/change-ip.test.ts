import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { changedFromIp, recordChangeIp, requestIp } from './change-ip.ts'

test('IP attribution matches saved content and rejects other clients and external edits', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-ip-'))
  const file = path.join(directory, 'file.txt')
  try {
    fs.writeFileSync(file, 'first')
    assert.equal(changedFromIp(file, 'client-a'), false)
    recordChangeIp(file, 'client-a', 'first')
    assert.equal(changedFromIp(file, 'client-a'), true)
    assert.equal(changedFromIp(file, 'client-b'), false)
    fs.writeFileSync(file, 'external')
    assert.equal(changedFromIp(file, 'client-a'), false)
    recordChangeIp(file, 'client-b', 'external')
    assert.equal(changedFromIp(file, 'client-b'), true)
    fs.unlinkSync(file)
    assert.equal(changedFromIp(file, 'client-b'), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
test('forwarded IP is accepted only from loopback and IPv4 socket addresses normalize', () => {
  const request = (address: string, headers: Record<string, string>) => ({ socket: { remoteAddress: address }, headers }) as IncomingMessage
  assert.equal(requestIp(request('::1', { 'cf-connecting-ip': '192.0.2.1' })), '192.0.2.1')
  assert.equal(requestIp(request('::ffff:192.0.2.2', { 'cf-connecting-ip': 'spoofed' })), '192.0.2.2')
  assert.equal(requestIp(request('127.0.0.1', { 'x-forwarded-for': '192.0.2.3, proxy' })), '192.0.2.3')
})
