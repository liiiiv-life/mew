// An isolated DAP fixture; it never launches a project process.
let buffer = Buffer.alloc(0), sequence = 0, launched, configured = false, value = 1, lastBreakpoints = []
const features = process.argv.includes('--features'), memory = Buffer.from([1, 2, 3, 4, 65, 66, 67, 68])
const caps = { supportsConfigurationDoneRequest: true, ...(features ? {
  supportsConditionalBreakpoints: true, supportsHitConditionalBreakpoints: true, supportsLogPoints: true, supportsFunctionBreakpoints: true,
  supportsDataBreakpoints: true, supportsInstructionBreakpoints: true, supportsBreakpointLocationsRequest: true,
  supportsSetVariable: true, supportsSetExpression: true, supportsReadMemoryRequest: true, supportsWriteMemoryRequest: true, supportsDisassembleRequest: true,
  supportsModulesRequest: true, supportsLoadedSourcesRequest: true, supportsExceptionInfoRequest: true, supportsCompletionsRequest: true,
  supportsRestartRequest: true, supportsRestartFrame: true, supportsStepInTargetsRequest: true, supportsGotoTargetsRequest: true, supportsSteppingGranularity: true, supportsStepBack: true,
  supportsValueFormattingOptions: true, supportsCancelRequest: true, supportsSingleThreadExecutionRequests: true,
  exceptionBreakpointFilters: [{ filter: 'all', label: 'All exceptions' }],
} : {}) }
function send(message) { const body = Buffer.from(JSON.stringify({ seq: ++sequence, ...message })); process.stdout.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])) }
function response(request, body = {}) { send({ type: 'response', request_seq: request.seq, command: request.command, success: true, body }) }
function stopped() { send({ type: 'event', event: 'stopped', body: { threadId: 1, reason: 'breakpoint', allThreadsStopped: true, hitBreakpointIds: [lastBreakpoints[0]?.id ?? 1] } }) }
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
      case 'initialize': response(request, caps); send({ type: 'event', event: 'initialized' }); break
      case 'launch': case 'attach': launched = request; if (configured) { response(request); stopped() } break
      case 'setBreakpoints': lastBreakpoints = (args.breakpoints ?? []).map((b, index) => ({ ...b, id: index + 1, verified: true, source: args.source })); response(request, { breakpoints: lastBreakpoints }); break
      case 'configurationDone': configured = true; response(request); if (launched) { response(launched); stopped() } if (lastBreakpoints.length > 1) send({ type: 'event', event: 'breakpoint', body: { reason: 'changed', breakpoint: { id: 1, verified: true, message: 'updated breakpoint' } } }); break
      case 'stackTrace': response(request, { stackFrames: args.startFrame ? [] : [{ id: args.threadId === 2 ? 2 : 1, name: 'fixture', line: 3, source: { path: launched?.arguments?.program ?? '/fixture/main.js' }, ...(features ? { instructionPointerReference: '0x1000', canRestart: true } : {}) }], totalFrames: 1 }); break
      case 'threads': response(request, { threads: [{ id: 1, name: 'main' }, ...(features ? [{ id: 2, name: 'worker' }] : [])] }); break
      case 'scopes': response(request, { scopes: [{ name: 'Locals', variablesReference: 10 }, ...(features ? [{ name: 'Registers', variablesReference: 11, expensive: true, presentationHint: 'registers' }] : [])] }); break
      case 'variables': response(request, { variables: args.variablesReference === 20 ? Array.from({ length: Math.max(0, Math.min(args.count ?? 100, 240 - (args.start ?? 0))) }, (_, i) => ({ name: String(i + (args.start ?? 0)), value: String(i + (args.start ?? 0)), variablesReference: 0 })) : [{ name: 'counter', value: args.format?.hex ? '0x' + value.toString(16) : String(value), variablesReference: 0, evaluateName: 'counter', ...(features ? { memoryReference: 'mem' } : {}) }, ...(features && args.variablesReference === 10 ? [{ name: 'numbers', value: 'Array(240)', variablesReference: 20, indexedVariables: 240, evaluateName: 'numbers' }] : [])] }); break
      case 'evaluate': if (args.expression === 'slow') { setTimeout(() => response(request, { result: 'old', variablesReference: 20 }), 120); break } response(request, { result: args.expression === 'numbers' ? 'Array(240)' : String(value), variablesReference: args.expression === 'numbers' ? 20 : 0 }); if (args.expression === 'disableMemory') send({ type: 'event', event: 'capabilities', body: { capabilities: { supportsReadMemoryRequest: false } } }); break
      case 'setVariable': case 'setExpression': value = Number(args.value); response(request, { value: String(value), variablesReference: 0 }); break
      case 'readMemory': response(request, { address: '0x1000', data: memory.subarray(args.offset ?? 0, (args.offset ?? 0) + args.count).toString('base64'), unreadableBytes: Math.max(0, args.count - memory.length) }); break
      case 'writeMemory': { const data = Buffer.from(args.data, 'base64'), written = data.copy(memory, args.offset ?? 0); response(request, { bytesWritten: written }); break }
      case 'disassemble': response(request, { instructions: [{ address: '0x1000', instruction: 'mov eax, 1', instructionBytes: 'b801000000' }] }); break
      case 'modules': response(request, { modules: [{ id: 1, name: 'fixture.so', symbolStatus: 'Symbols loaded' }], totalModules: 1 }); break
      case 'loadedSources': response(request, { sources: [{ name: 'virtual.c', sourceReference: 7 }] }); break
      case 'source': response(request, { content: 'int main() { return 0; }', mimeType: 'text/x-c' }); break
      case 'exceptionInfo': response(request, { exceptionId: 'FixtureError', breakMode: 'always', description: 'Fixture exception' }); break
      case 'completions': response(request, { targets: [{ label: 'counter', text: 'counter' }] }); break
      case 'dataBreakpointInfo': response(request, { dataId: 'counter-data', description: 'counter', accessTypes: ['write', 'readWrite'], canPersist: false }); break
      case 'breakpointLocations': response(request, { breakpoints: [{ line: args.line, column: 1 }, { line: args.line, column: 10 }] }); break
      case 'stepInTargets': case 'gotoTargets': response(request, { targets: [{ id: 9, label: 'fixture target' }] }); break
      case 'setFunctionBreakpoints': case 'setExceptionBreakpoints': case 'setDataBreakpoints': case 'setInstructionBreakpoints': response(request, { breakpoints: args.breakpoints?.map(b => ({ ...b, verified: true })) ?? [] }); break
      case 'cancel': response(request); send({ type: 'event', event: 'progressEnd', body: { progressId: args.progressId } }); break
      case 'continue': case 'next': case 'stepIn': case 'stepOut': case 'stepBack': case 'reverseContinue': case 'restart': case 'restartFrame': case 'goto': response(request); send({ type: 'event', event: 'continued' }); value += request.command === 'stepBack' ? -1 : 1; setTimeout(stopped, 20); break
      case 'pause': response(request); stopped(); break
      case 'disconnect': response(request); setTimeout(() => process.exit(0), 5); break
      default: send({ type: 'response', request_seq: request.seq, command: request.command, success: false, message: 'unsupported' })
    }
  }
})
