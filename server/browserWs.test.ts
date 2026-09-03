import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { WebSocket } from 'ws'
import { attachBrowserWebSocket, BROWSER_WS_PATH } from './browserWs.ts'
import { disposeAllBrowserRuntimes } from './browserRuntime.ts'

function rejectedStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers })
    socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
    socket.once('open', () => { socket.close(); reject(new Error('연결이 거부되지 않았습니다')) })
    socket.once('error', () => { /* unexpected-response가 상태를 돌려준다 */ })
  })
}

test('서버 브라우저 WS는 manager 계정과 같은 origin만 연결한다', async (t) => {
  const server = http.createServer()
  attachBrowserWebSocket(server, { account: (request) => request.headers.authorization === 'manager' ? 'manager@example.com' : null })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  const url = `ws://127.0.0.1:${port}${BROWSER_WS_PATH}`
  const origin = `http://127.0.0.1:${port}`
  t.after(() => { disposeAllBrowserRuntimes(); server.close() })

  assert.equal(await rejectedStatus(url, { Origin: origin }), 401)
  assert.equal(await rejectedStatus(url, { Origin: 'https://evil.example', Authorization: 'manager' }), 403)

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: origin, Authorization: 'manager' } })
    socket.once('open', () => { socket.close(); resolve() })
    socket.once('error', reject)
  })
})
