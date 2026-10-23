import net from 'node:net'
import fs from 'node:fs'
import * as posix from './posix/ipc.ts'
import * as windows from './windows/ipc.ts'
import auth from './common/ipc-auth.cjs'
import { protectDirectory } from './storage.ts'

const backend = process.platform === 'win32' ? windows : posix
export const ipcEndpoint = backend.ipcEndpoint
export const removeIpcEndpoint = backend.removeEndpoint

export function createPrivateIpcServer(endpoint: string, directory: string, ready: (socket: net.Socket) => void, authenticate = process.platform === 'win32'): net.Server {
  protectDirectory(directory)
  const key = authenticate ? auth.secret(directory, true) : ''
  let pending = 0
  return net.createServer(socket => {
    if (!authenticate) { ready(socket); return }
    if (pending >= 32) { socket.destroy(); return }
    pending++
    void auth.accept(socket, endpoint, key, ready).finally(() => { pending-- })
  })
}

export async function connectPrivateIpc(endpoint: string, directory: string, authenticate = process.platform === 'win32'): Promise<net.Socket> {
  if (authenticate) return auth.connect(endpoint, directory)
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    socket.once('error', reject)
    socket.once('connect', () => { socket.off('error', reject); socket.pause(); resolve(socket) })
  })
}

export async function listenPrivateIpc(server: net.Server, endpoint: string): Promise<void> {
  const listen = () => new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => { server.off('listening', listening); reject(error) }
    const listening = () => { server.off('error', failed); resolve() }
    server.once('error', failed); server.once('listening', listening); server.listen(endpoint)
  })
  try { await listen() } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    const alive = await new Promise<boolean>(resolve => {
      const probe = net.createConnection(endpoint)
      probe.once('connect', () => { probe.destroy(); resolve(true) })
      probe.once('error', () => { probe.destroy(); resolve(false) })
    })
    if (alive || process.platform === 'win32') throw new Error('PRIVATE_IPC_ALREADY_RUNNING')
    if (!fs.lstatSync(endpoint).isSocket()) throw new Error('PRIVATE_IPC_INVALID_PATH')
    removeIpcEndpoint(endpoint); await listen()
  }
  if (process.platform !== 'win32') fs.chmodSync(endpoint, 0o600)
}
