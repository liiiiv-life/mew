import readline from 'node:readline'
import { relayMewcatRequest } from './mewcat-mcp-stdio.ts'

const socket = process.argv[2]
if (!socket) process.exit(1)
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', line => {
  let req: { id?: string | number }
  try { req = JSON.parse(line) } catch { return }
  if (req.id === undefined) return
  void relayMewcatRequest(socket, line).then(result => process.stdout.write(`${result}\n`)).catch(() => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: 'DEBUGGER_DISCONNECTED' } })}\n`))
})
