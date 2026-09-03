// Mew 브라우저 UI ↔ 서버 Chromium. 인증은 터미널과 같은 manager/owner 경계다.
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import {
  browserRuntimeFor,
  parseBrowserClientMessage,
  type BrowserClientMessage,
  type BrowserServerMessage,
} from './browserRuntime.ts'

export const BROWSER_WS_PATH = '/api/browser/ws'

function send(ws: WebSocket, message: BrowserServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
}

function messageError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function attachBrowserWebSocket(
  httpServer: HttpServer | Http2SecureServer,
  opts: { account: (req: IncomingMessage) => string | null },
): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  httpServer.on('upgrade', (req, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    if (url.pathname !== BROWSER_WS_PATH) return
    const origin = req.headers.origin
    if (origin) {
      let originHost = ''
      try { originHost = new URL(origin).host } catch { /* 아래에서 거부 */ }
      if (originHost !== req.headers.host) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
    }
    const account = opts.account(req)
    if (!account) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const runtime = browserRuntimeFor(account)
      let page: Awaited<ReturnType<typeof runtime.page>> | null = null
      let queue = Promise.resolve()

      const handle = async (message: BrowserClientMessage) => {
        if (message.type === 'hello') {
          if (page) runtime.viewerClosed(page, ws)
          page = await runtime.page(message.tabId, message.url)
          await page.addViewer(ws, message.width, message.height)
          return
        }
        if (message.type === 'close_tab') {
          await runtime.closeTab(message.tabId)
          return
        }
        if (!page) return
        if (message.type === 'navigate') await page.navigate(message.url)
        else if (message.type === 'resize') await page.resize(message.width, message.height)
        else if (message.type === 'history') await page.history(message.direction)
        else if (message.type === 'reload') await page.reload()
        else if (message.type === 'stop') await page.stop()
        else if (message.type === 'pointer') await page.pointer(message)
        else if (message.type === 'wheel') await page.wheel(message)
        else if (message.type === 'key') await page.key(message)
        else if (message.type === 'insert_text') await page.insertText(message.text)
        else if (message.type === 'dialog') await page.dialog(message.accept, message.promptText)
      }

      ws.on('message', (raw) => {
        const message = parseBrowserClientMessage(raw.toString())
        if (!message) return
        queue = queue.then(() => handle(message)).catch((error) => {
          send(ws, { type: 'fatal', message: messageError(error) })
          ws.close(1011, 'browser command failed')
        })
      })
      ws.on('close', () => { if (page) runtime.viewerClosed(page, ws) })

      let alive = true
      ws.on('pong', () => { alive = true })
      const keepAlive = setInterval(() => {
        if (!alive) ws.terminate()
        else if (ws.readyState === WebSocket.OPEN) { alive = false; ws.ping() }
      }, 30_000)
      keepAlive.unref?.()
      ws.on('close', () => clearInterval(keepAlive))
    })
  })
}
