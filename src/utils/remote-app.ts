import { setBrowserStorageScope } from '@mew/ui/browser-storage-scope'
import { DataChannelTransport, setRemoteTransport } from './remote-transport.ts'

/** Installed app code only receives a frame-bound port, never the central session or launch token. */
export async function initializeRemoteApp() {
  setRemoteTransport(null)
  const token = /^\/__mew_ui\/([A-Za-z0-9_-]{20,64})\//.exec(location.pathname)?.[1]
  if (!token || parent === window) throw new Error('P2P 연결 페이지에서 mew를 다시 열어 주세요.')
  const channel = new MessageChannel()
  const context = await new Promise<{ account: string; instance: string }>((resolve, reject) => {
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('앱 연결 시간이 초과됐습니다. 다시 연결해 주세요.')) }, 10000)
    channel.port1.onmessage = ({ data }) => {
      if (data?.type !== 'mew-app-context' || typeof data.account !== 'string' || typeof data.instance !== 'string') return
      clearTimeout(timer); resolve(data)
    }
    parent.postMessage({ type: 'mew-app-ready', token }, location.origin, [channel.port2])
  })
  setBrowserStorageScope(context.account, context.instance)
  const wire = new EventTarget() as EventTarget & { readyState: string; bufferedAmount: number; send(data: string): void; close(): void }
  wire.readyState = 'open'; wire.bufferedAmount = 0
  wire.send = data => channel.port1.postMessage(data)
  wire.close = () => { if (wire.readyState === 'closed') return; wire.readyState = 'closed'; channel.port1.postMessage({ type: 'mew-app-close' }); channel.port1.close(); wire.dispatchEvent(new Event('close')) }
  channel.port1.onmessage = ({ data }) => {
    if (typeof data === 'string') wire.dispatchEvent(new MessageEvent('message', { data }))
    else if (data?.type === 'mew-app-disconnected') { wire.close(); setRemoteTransport(null) }
  }
  channel.port1.start()
  setRemoteTransport(new DataChannelTransport(wire as unknown as RTCDataChannel))
  window.addEventListener('pagehide', () => wire.close(), { once: true })
}
