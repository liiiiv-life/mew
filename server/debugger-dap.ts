import type { Readable, Writable } from 'node:stream'

export interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  message?: string
  arguments?: Record<string, unknown>
  body?: Record<string, any>
}
const MAX_MESSAGE = 8 * 1024 * 1024
export class DapConnection {
  private buffer = Buffer.alloc(0)
  private sequence = 0
  private pending = new Map<number, { resolve: (body: Record<string, any>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
  private closed = false
  onEvent: (message: DapMessage) => void = () => {}
  onRequest: (message: DapMessage) => Promise<Record<string, unknown>> = async () => { throw new Error('지원하지 않는 디버거 요청') }
  onClose: (error: Error) => void = () => {}
  private input: Readable
  private output: Writable
  constructor(input: Readable, output: Writable) {
    this.input = input; this.output = output
    input.on('data', this.receive)
    input.on('error', this.fail)
    output.on('error', this.fail)
    input.on('end', this.end)
  }
  private end = () => this.fail(new Error('디버거 연결이 종료되었습니다'))
  private receive = (chunk: Buffer) => {
    if (this.closed) return
    this.buffer = Buffer.concat([this.buffer, chunk])
    try {
      while (this.buffer.length) {
        const end = this.buffer.indexOf('\r\n\r\n')
        if (end < 0) { if (this.buffer.length > 4096) throw new Error('DAP 헤더가 너무 큽니다'); break }
        const match = /^Content-Length:\s*(\d+)\s*$/im.exec(this.buffer.subarray(0, end).toString('ascii'))
        const length = match ? Number(match[1]) : NaN
        if (!Number.isSafeInteger(length) || length < 1 || length > MAX_MESSAGE) throw new Error('잘못된 DAP 메시지 길이')
        if (this.buffer.length < end + 4 + length) break
        const message: DapMessage = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString('utf8'))
        this.buffer = this.buffer.subarray(end + 4 + length)
        if (message.type === 'response') {
          const pending = this.pending.get(message.request_seq!)
          if (!pending) continue
          this.pending.delete(message.request_seq!); clearTimeout(pending.timer)
          if (message.success) pending.resolve(message.body ?? {})
          else pending.reject(new Error(message.message ?? `${message.command} 실패`))
        } else if (message.type === 'event') this.onEvent(message)
        else if (message.type === 'request') {
          void this.onRequest(message).then(body => this.send({ type: 'response', command: message.command, request_seq: message.seq, success: true, body }), error => this.send({ type: 'response', command: message.command, request_seq: message.seq, success: false, message: error instanceof Error ? error.message : '요청 실패' }))
        } else throw new Error('잘못된 DAP 메시지')
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error('DAP 파싱 실패')) }
  }
  private send(message: Omit<DapMessage, 'seq'>) {
    if (this.closed) return
    const body = Buffer.from(JSON.stringify({ ...message, seq: ++this.sequence }))
    this.output.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]))
  }
  request(command: string, args: Record<string, unknown> = {}, timeout = 15000): Promise<Record<string, any>> {
    if (this.closed) return Promise.reject(new Error('디버거 연결이 닫혔습니다'))
    const seq = this.sequence + 1
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`디버거 응답 시간 초과: ${command}`)) }, timeout)
      this.pending.set(seq, { resolve, reject, timer })
      this.send({ type: 'request', command, arguments: args })
    })
  }
  private fail = (error: Error) => {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear(); this.buffer = Buffer.alloc(0)
    this.input.off('data', this.receive)
    this.onClose(error)
  }
  dispose() { this.fail(new Error('디버거 연결을 닫았습니다')); this.input.destroy(); if ((this.output as unknown) !== this.input) this.output.destroy() }
}
