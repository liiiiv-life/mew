import type { Socket } from 'node:net'
declare const auth: {
  keyFile(directory: string): string
  secret(directory: string, create?: boolean): string
  proof(key: string, role: string, endpoint: string, nonce: string): string
  equal(actual: unknown, expected: string): boolean
  accept(socket: Socket, endpoint: string, key: string, ready: (socket: Socket) => void): Promise<void>
  connect(endpoint: string, directory: string): Promise<Socket>
}
export = auth
