import type { Page } from 'playwright-core'
import type { LiveResource } from '../shared/live-updates.ts'

/** Browser fixtures model push notifications without a production HTTP server. */
export async function installLiveFixture(page: Page, read: (resource: LiveResource) => Promise<Record<string, unknown>> | Record<string, unknown>) {
  await page.routeWebSocket('**/api/live/ws', socket => {
    const clients = new Map<string, { resource: LiveResource; previous?: string; revision: number; reading: boolean; error?: string }>()
    let closed = false
    const poll = async (id: string, client: NonNullable<ReturnType<typeof clients.get>>) => {
      if (closed || client.reading || clients.get(id) !== client) return
      client.reading = true
      try {
        const value = await read(client.resource), serialized = JSON.stringify(value)
        if (!closed && clients.get(id) === client && (serialized !== client.previous || client.error)) {
          socket.send(JSON.stringify({ type: 'snapshot', id, revision: ++client.revision, value }))
          client.previous = serialized; client.error = undefined
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!closed && clients.get(id) === client && client.error !== message) { client.error = message; socket.send(JSON.stringify({ type: 'error', id, message })) }
      } finally { client.reading = false }
    }
    const timer = setInterval(() => { for (const [id, client] of clients) void poll(id, client) }, 200)
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw))
      if (message.type === 'unsubscribe') clients.delete(message.id)
      else if (message.type === 'subscribe') {
        const client = { resource: message.resource, revision: 0, reading: false }
        clients.set(message.id, client); void poll(message.id, client)
      }
    })
    socket.onClose(() => { closed = true; clients.clear(); clearInterval(timer) })
  })
}
