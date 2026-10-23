import { openMewSocket } from './remote-transport.ts'
import { LIVE_WS_PATH, type LiveMessage, type LiveResource } from '../../shared/live-updates.ts'

type Listener = { value: (value: Record<string, unknown>) => void; error: (error: Error) => void }
type Channel = { id: string; resource: LiveResource; listeners: Set<Listener>; revision: number; value?: Record<string, unknown> }
const channels = new Map<string, Channel>()
let socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined, sequence = 0, retry = 1000
const send = (value: unknown) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)) }
function request(channel: Channel) {
  if (channel.id) send({ type: 'unsubscribe', id: channel.id })
  channel.id = `live_${++sequence}`; channel.revision = 0
  send({ type: 'subscribe', id: channel.id, resource: channel.resource })
}
function connect() {
  if (socket || !channels.size || document.hidden) return
  try { socket = openMewSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${LIVE_WS_PATH}`) }
  catch { schedule(); return }
  const current = socket
  current.onopen = () => { if (socket !== current) return; retry = 1000; for (const channel of channels.values()) request(channel) }
  current.onmessage = event => {
    if (socket !== current || typeof event.data !== 'string') return
    let message: LiveMessage
    try { message = JSON.parse(event.data) } catch { return }
    const channel = [...channels.values()].find(value => value.id === message.id)
    if (!channel) return
    if (message.type === 'error') { for (const listener of channel.listeners) listener.error(new Error(message.message)); return }
    if (message.type === 'patch') {
      if (!channel.value || channel.revision !== message.base) { request(channel); return }
      channel.value = { ...channel.value, ...message.value }
      for (const key of message.removed) delete channel.value[key]
    } else if (message.type === 'snapshot') channel.value = message.value
    else return
    channel.revision = message.revision
    for (const listener of channel.listeners) listener.value(structuredClone(channel.value!))
  }
  current.onerror = () => current.close()
  current.onclose = () => { if (socket !== current) return; socket = undefined; schedule() }
}
function schedule() {
  if (!channels.size || document.hidden || timer) return
  timer = setTimeout(() => { timer = undefined; connect() }, retry)
  retry = Math.min(retry * 2, 15_000)
}
function disconnect() {
  clearTimeout(timer); timer = undefined
  const previous = socket; socket = undefined; previous?.close()
}
function visibility() { if (document.hidden) disconnect(); else connect() }
function reconcile() { disconnect(); connect() }

/** All open panels share one socket; unmount, visibility and reconnect own its lifetime. */
export function subscribeLive<T>(resource: LiveResource, onValue: (value: T) => void, onError: (error: Error) => void = () => {}) {
  if (!channels.size) {
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('mew:permissions-changed', reconcile)
    window.addEventListener('mew:auth-expired', disconnect)
  }
  const key = JSON.stringify(resource)
  let channel = channels.get(key)
  const listener: Listener = { value: value => onValue(value as T), error: onError }
  if (!channel) { channel = { id: '', resource, revision: 0, listeners: new Set() }; channels.set(key, channel); if (socket?.readyState === WebSocket.OPEN) request(channel) }
  channel.listeners.add(listener)
  if (channel.value && channel.revision) listener.value(structuredClone(channel.value))
  connect()
  const current = channel
  return () => {
    current.listeners.delete(listener)
    if (!current.listeners.size) { send({ type: 'unsubscribe', id: current.id }); channels.delete(key) }
    if (!channels.size) {
      disconnect()
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('mew:permissions-changed', reconcile)
      window.removeEventListener('mew:auth-expired', disconnect)
    }
  }
}
