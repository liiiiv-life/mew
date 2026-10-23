// Session-local MCP transport. No credentials or user runtime configuration are modified.
import path from 'node:path'
import { connectPrivateIpc } from './platform/ipc.ts'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

export async function relayMewcatRequest(socketPath: string, line: string, directory = path.dirname(socketPath)): Promise<string> {
  const socket = await connectPrivateIpc(socketPath, directory)
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => socket.destroy(new Error('MEWCAT_TIMEOUT')), 65_000)
    socket.setEncoding('utf8')
    socket.write(`${line}\n`)
    socket.on('data', chunk => {
      buffer += chunk
      if (buffer.length > 2_000_000) { socket.destroy(new Error('MEWCAT_INVALID_RESPONSE')); return }
      const end = buffer.indexOf('\n')
      if (end < 0) return
      resolve(buffer.slice(0, end))
      socket.end()
    })
    socket.on('error', reject)
    socket.on('close', () => { clearTimeout(timer); reject(new Error('MEWCAT_DISCONNECTED')) })
    socket.resume()
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const socketPath = process.argv[2]
  if (!socketPath) process.exit(1)
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  input.on('line', line => {
    let request: { id?: string | number }
    try { request = JSON.parse(line) } catch { return }
    if (request.id === undefined) return
    void relayMewcatRequest(socketPath, line, process.argv[3]).then(response => process.stdout.write(`${response}\n`)).catch(() => {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'MEWCAT_DISCONNECTED' } })}\n`)
    })
  })
}
