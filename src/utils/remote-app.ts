import { configureRemotePortPreview } from './port-preview-remote.ts'
import { setBrowserStorageScope } from '@mew/ui/browser-storage-scope'
import { installHostedKeyboard } from '@mew/ui/virtual-keyboard'
import { DataChannelTransport, setRemoteTransport } from './remote-transport.ts'
import type { AuthStatus } from '../api/auth.ts'

let appPort: MessagePort | undefined
let localEmail: string | null = null
let reloading = false

/** The launcher owns the destination and central session; installed app code requests only an action. */
export function requestMewlinkLogin() {
  if (!appPort) throw new Error('Mewlink 연결에서 로그인해 주세요.')
  appPort.postMessage({ type: 'mewlink-login' })
}

export function requestMewlinkLogout() {
  if (!appPort) return false
  appPort.postMessage({ type: 'mewlink-logout' })
  return true
}

/** A fresh frame prevents the previous account's module caches and React state from carrying over. */
export function reloadRemoteAppForIdentity(email: string | null) {
  if (!appPort || email === localEmail) return false
  if (!reloading) { reloading = true; appPort.postMessage({ type: 'mew-app-reload' }) }
  return true
}

/** Installed app code only receives a frame-bound port, never the central session or launch token. */
export async function initializeRemoteApp() {
  setRemoteTransport(null)
  const token = /^\/__mew_ui\/([A-Za-z0-9_-]{20,64})\//.exec(location.pathname)?.[1]
  if (!token || parent === window) throw new Error('P2P 연결 페이지에서 mew를 다시 열어 주세요.')
  const channel = new MessageChannel()
  const context = await new Promise<{ instance: string; reconnecting?: boolean; initialAuth?: AuthStatus; previewDomain?: string; previewPort?: number; previewPath?: string }>((resolve, reject) => {
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('앱 연결 시간이 초과됐습니다. 다시 연결해 주세요.')) }, 10000)
    channel.port1.onmessage = ({ data }) => {
      if (data?.type === 'mew-app-disconnected') { clearTimeout(timer); channel.port1.close(); reject(new Error('기기 연결이 종료됐습니다. 다시 연결해 주세요.')); return }
      if (data?.type !== 'mew-app-context' || typeof data.instance !== 'string') return
      clearTimeout(timer); resolve(data)
    }
    parent.postMessage({ type: 'mew-app-ready', token }, location.origin, [channel.port2])
  })
  configureRemotePortPreview(context.previewDomain)
  if (Number.isInteger(context.previewPort) && context.previewPort! >= 1 && context.previewPort! <= 65535) {
    const address = new URL(location.href)
    address.searchParams.set('preview', String(context.previewPort))
    address.searchParams.set('previewPath', typeof context.previewPath === 'string' ? context.previewPath : '/')
    history.replaceState(null, '', address)
  }
  appPort = channel.port1
  const keyboard = installHostedKeyboard()
  let generation = 0
  const waiting = new Set<{ resolve(): void; reject(error: Error): void }>()
  const finishWaiting = (error?: Error) => { for (const waiter of waiting) { if (error) waiter.reject(error); else waiter.resolve() }; waiting.clear() }
  const wire = new EventTarget() as EventTarget & { readyState: string; bufferedAmount: number; send(data: string): void; close(): void }
  wire.readyState = 'open'; wire.bufferedAmount = 0
  wire.send = data => channel.port1.postMessage(data)
  wire.close = () => { if (wire.readyState === 'closed') return; wire.readyState = 'closed'; keyboard.dispose(); finishWaiting(new Error('기기 연결이 종료됐습니다. 다시 연결해 주세요.')); channel.port1.postMessage({ type: 'mew-app-close' }); channel.port1.close(); wire.dispatchEvent(new Event('close')) }
  channel.port1.onmessage = ({ data }) => {
    if (typeof data === 'string') wire.dispatchEvent(new MessageEvent('message', { data }))
    else if (data?.type === 'mew-keyboard-geometry') keyboard.update(data)
    else if (data?.type === 'mew-app-reconnecting' && !transport.suspended) { generation++; transport.suspendForReconnect() }
    else if (data?.type === 'mew-app-reconnected' && transport.suspended) { transport.resumeAfterReconnect(); finishWaiting(); window.dispatchEvent(new Event('online')) }
    else if (data?.type === 'mew-app-disconnected') { wire.close(); setRemoteTransport(null) }
  }
  channel.port1.start()
  const transport = new DataChannelTransport(wire as unknown as RTCDataChannel)
  if (context.reconnecting) transport.suspendForReconnect()
  setRemoteTransport(transport)
  window.addEventListener('pagehide', () => wire.close(), { once: true })
  try {
    const waitForConnection = () => transport.closed || wire.readyState !== 'open'
      ? Promise.reject(new Error('기기 연결이 종료됐습니다. 다시 연결해 주세요.'))
      : transport.suspended ? new Promise<void>((resolve, reject) => waiting.add({ resolve, reject })) : Promise.resolve()
    const readInitialStatus = async () => {
      while (true) {
        await waitForConnection()
        const attempt = generation
        try {
          const response = await transport.fetch('/api/auth/me')
          if (!response.ok) throw new Error('기기의 로그인 상태를 확인하지 못했습니다. 다시 연결해 주세요.')
          const status = await response.json() as AuthStatus
          if (transport.closed || wire.readyState !== 'open') throw new Error('기기 연결이 종료됐습니다. 다시 연결해 주세요.')
          if (generation === attempt && !transport.suspended) return status
        } catch (error) { if (transport.closed || wire.readyState !== 'open' || generation === attempt) throw error }
      }
    }
    const supplied = context.initialAuth
    const status = supplied && !transport.suspended && typeof supplied.authenticated === 'boolean' && (supplied.email === null || typeof supplied.email === 'string') && ['owner', 'manager', 'member', 'guest'].includes(supplied.role) && typeof supplied.mustChangePassword === 'boolean'
      ? supplied : await readInitialStatus()
    localEmail = status.authenticated && typeof status.email === 'string' ? status.email : null
    setBrowserStorageScope(localEmail ?? 'anonymous', context.instance)
    return status
  } catch (error) {
    channel.port1.postMessage({ type: 'mew-app-error', error: error instanceof Error ? error.message : '기기의 로그인 상태를 확인하지 못했습니다.' })
    throw error
  }
}
