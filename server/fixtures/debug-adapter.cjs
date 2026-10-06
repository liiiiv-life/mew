// An isolated DAP fixture; it never launches a project process.
let buffer = Buffer.alloc(0), sequence = 0, launched, configured = false, value = 1, lastBreakpoints = []
function send(message) { const body = Buffer.from(JSON.stringify({ seq: ++sequence, ...message })); process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])) }
function response(request, body = {}) { send({ type: 'response', request_seq: request.seq, command: request.command, success: true, body }) }
function stopped() { send({ type: 'event', event: 'stopped', body: { threadId: 1, reason: 'breakpoint' } }) }
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (buffer.length) {
    const end = buffer.indexOf('\r\n\r\n')
    if (end < 0) break
    const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())[1])
    if (buffer.length < end + 4 + length) break
    const request = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
    buffer = buffer.subarray(end + 4 + length)
    const args = request.arguments ?? {}
    switch (request.command) {
      case 'initialize': response(request, { supportsConfigurationDoneRequest: true }); send({ type: 'event', event: 'initialized' }); break
      case 'launch': case 'attach': launched = request; if (configured) { response(request); stopped() } break
      case 'setBreakpoints': lastBreakpoints = (args.breakpoints ?? []).map((b, index) => ({ ...b, id: index + 1, verified: true, source: args.source })); response(request, { breakpoints: lastBreakpoints }); break
      case 'configurationDone': configured = true; response(request); if (launched) { response(launched); stopped() } if (lastBreakpoints.length > 1) send({ type: 'event', event: 'breakpoint', body: { reason: 'changed', breakpoint: { id: 1, verified: true, message: 'updated breakpoint' } } }); break
      case 'stackTrace': response(request, { stackFrames: [{ id: 1, name: 'fixture', line: 3, source: { path: '/fixture/main.js' } }] }); break
      case 'threads': response(request, { threads: [{ id: 1, name: 'main' }] }); break
      case 'scopes': response(request, { scopes: [{ name: 'Locals', variablesReference: 10 }] }); break
      case 'variables': response(request, { variables: [{ name: 'counter', value: String(value), variablesReference: 0, evaluateName: 'counter' }] }); break
      case 'evaluate': response(request, { result: String(value), variablesReference: 0 }); break
      case 'continue': case 'next': case 'stepIn': case 'stepOut': response(request); send({ type: 'event', event: 'continued' }); ++value; setTimeout(stopped, 20); break
      case 'pause': response(request); stopped(); break
      case 'disconnect': response(request); setTimeout(() => process.exit(0), 5); break
      default: send({ type: 'response', request_seq: request.seq, command: request.command, success: false, message: 'unsupported' })
    }
  }
})
