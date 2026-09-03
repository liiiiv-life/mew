import test from 'node:test'
import assert from 'node:assert/strict'
import { browserProfileKey, normalizeRemoteBrowserUrl, parseBrowserClientMessage } from './browserRuntime.ts'

test('서버 브라우저 주소는 http(s)만 받고 scheme 없는 localhost도 정규화한다', () => {
  assert.equal(normalizeRemoteBrowserUrl('localhost:3100'), 'http://localhost:3100/')
  assert.equal(normalizeRemoteBrowserUrl('https://google.com/search?q=mew'), 'https://google.com/search?q=mew')
  assert.throws(() => normalizeRemoteBrowserUrl('file:///etc/passwd'), /http 또는 https/)
  assert.throws(() => normalizeRemoteBrowserUrl('javascript:alert(1)'), /http 또는 https/)
})

test('계정 프로필 키는 이메일을 노출하지 않고 대소문자에 흔들리지 않는다', () => {
  assert.equal(browserProfileKey('Owner@Example.com'), browserProfileKey(' owner@example.com '))
  assert.match(browserProfileKey('owner@example.com'), /^[a-f0-9]{24}$/)
  assert.ok(!browserProfileKey('owner@example.com').includes('owner'))
})

test('브라우저 WS 입력은 탭·뷰포트·좌표 범위를 검증한다', () => {
  assert.deepEqual(parseBrowserClientMessage(JSON.stringify({ type: 'hello', tabId: 'tab_1', url: 'localhost:3100', width: 900.4, height: 700 })), {
    type: 'hello', tabId: 'tab_1', url: 'http://localhost:3100/', width: 900, height: 700,
  })
  assert.equal(parseBrowserClientMessage(JSON.stringify({ type: 'hello', tabId: '../bad', url: 'https://example.com', width: 900, height: 700 })), null)
  assert.equal(parseBrowserClientMessage(JSON.stringify({ type: 'navigate', url: 'file:///tmp/a' })), null)
  assert.deepEqual(parseBrowserClientMessage(JSON.stringify({ type: 'wheel', x: 20, y: 30, deltaX: 0, deltaY: 99 })), {
    type: 'wheel', x: 20, y: 30, deltaX: 0, deltaY: 99,
  })
})
