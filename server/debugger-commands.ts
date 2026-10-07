import type { DebugSnapshot } from '../shared/debugger.ts'

export interface DebugCommandContext {
  state: DebugSnapshot['state']
  capabilities: Record<string, unknown>
  frames: Set<number>
  variables: Set<number>
  sources: Set<number>
}
const capabilities: Record<string, string> = {
  restart: 'supportsRestartRequest', restartFrame: 'supportsRestartFrame', stepBack: 'supportsStepBack', reverseContinue: 'supportsStepBack',
  stepInTargets: 'supportsStepInTargetsRequest', goto: 'supportsGotoTargetsRequest', gotoTargets: 'supportsGotoTargetsRequest',
  setVariable: 'supportsSetVariable', setExpression: 'supportsSetExpression', readMemory: 'supportsReadMemoryRequest', writeMemory: 'supportsWriteMemoryRequest',
  disassemble: 'supportsDisassembleRequest', modules: 'supportsModulesRequest', loadedSources: 'supportsLoadedSourcesRequest',
  exceptionInfo: 'supportsExceptionInfoRequest', completions: 'supportsCompletionsRequest', dataBreakpointInfo: 'supportsDataBreakpoints',
  breakpointLocations: 'supportsBreakpointLocationsRequest', cancel: 'supportsCancelRequest',
}
const fields: Record<string, string[]> = {
  threads: [], continue: ['threadId', 'singleThread'], pause: ['threadId'], next: ['threadId', 'singleThread', 'granularity'],
  stepIn: ['threadId', 'singleThread', 'granularity', 'targetId'], stepOut: ['threadId', 'singleThread', 'granularity'],
  stepBack: ['threadId', 'singleThread', 'granularity'], reverseContinue: ['threadId', 'singleThread'],
  scopes: ['frameId'], variables: ['variablesReference', 'start', 'count', 'filter', 'format'],
  evaluate: ['expression', 'frameId', 'context', 'format'], setVariable: ['variablesReference', 'name', 'value', 'format'],
  setExpression: ['expression', 'value', 'frameId', 'format'], stackTrace: ['threadId', 'startFrame', 'levels', 'format'],
  restart: [], restartFrame: ['frameId'], stepInTargets: ['frameId'], goto: ['threadId', 'targetId'], gotoTargets: ['source', 'line', 'column'],
  readMemory: ['memoryReference', 'offset', 'count'], writeMemory: ['memoryReference', 'offset', 'data', 'allowPartial'],
  disassemble: ['memoryReference', 'offset', 'instructionOffset', 'instructionCount', 'resolveSymbols'],
  modules: ['startModule', 'moduleCount'], loadedSources: [], source: ['source', 'sourceReference'], exceptionInfo: ['threadId'],
  completions: ['text', 'column', 'line', 'frameId'], dataBreakpointInfo: ['variablesReference', 'name', 'frameId', 'asAddress', 'bytes'],
  breakpointLocations: ['source', 'line', 'column', 'endLine', 'endColumn'], cancel: ['progressId'],
}
const runningCommands = new Set(['threads', 'pause', 'restart', 'modules', 'loadedSources', 'source', 'breakpointLocations', 'cancel'])
export function validateDebugCommand(command: string, input: Record<string, unknown>, ctx: DebugCommandContext) {
  const keys = Object.hasOwn(fields, command) ? fields[command] : undefined
  if (!keys || Object.keys(input).some(key => !keys.includes(key))) throw new Error('지원하지 않는 디버거 명령 또는 인수')
  if (!runningCommands.has(command) && ctx.state !== 'stopped') throw new Error('중단된 세션에서만 사용할 수 있습니다')
  const capability = capabilities[command]
  if (capability && ctx.capabilities[capability] !== true) throw new Error(`어댑터가 지원하지 않습니다: ${command}`)
  const args = { ...input }
  const integer = (key: string, min = 0, max = Number.MAX_SAFE_INTEGER, required = false) => {
    const value = args[key]
    if (value === undefined && !required) return
    if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`잘못된 ${key}`)
  }
  const text = (key: string, max = 4096, required = false) => {
    if (args[key] === undefined && !required) return
    if (typeof args[key] !== 'string' || (required && !args[key]) || String(args[key]).length > max || String(args[key]).includes('\0')) throw new Error(`잘못된 ${key}`)
  }
  integer('threadId'); integer('frameId'); integer('variablesReference', 1); integer('targetId'); integer('sourceReference')
  if (args.frameId !== undefined && !ctx.frames.has(Number(args.frameId))) throw new Error('만료되거나 다른 스레드의 프레임입니다')
  if (args.variablesReference !== undefined && !ctx.variables.has(Number(args.variablesReference))) throw new Error('만료되거나 다른 연결의 변수 참조입니다')
  if (args.sourceReference !== undefined && Number(args.sourceReference) > 0 && !ctx.sources.has(Number(args.sourceReference))) throw new Error('알 수 없는 소스 참조입니다')
  if (['scopes', 'restartFrame', 'stepInTargets'].includes(command)) integer('frameId', 0, Number.MAX_SAFE_INTEGER, true)
  if (['variables', 'setVariable'].includes(command)) integer('variablesReference', 1, Number.MAX_SAFE_INTEGER, true)
  if (['evaluate', 'setExpression'].includes(command)) text('expression', 4096, true)
  if (['setVariable', 'setExpression'].includes(command)) { text('value', 4096); if (typeof args.value !== 'string') throw new Error('값을 입력하세요') }
  if (command === 'setVariable') text('name', 2048, true)
  if (command === 'evaluate' && args.context !== undefined && !['watch', 'repl', 'hover', 'clipboard', 'variables'].includes(String(args.context))) throw new Error('잘못된 평가 범위')
  if (command === 'evaluate' && args.context === 'hover' && ctx.capabilities.supportsEvaluateForHovers !== true) throw new Error('호버 평가를 지원하지 않습니다')
  if (args.singleThread !== undefined && (typeof args.singleThread !== 'boolean' || args.singleThread && ctx.capabilities.supportsSingleThreadExecutionRequests !== true)) throw new Error('스레드별 실행을 지원하지 않습니다')
  if (args.granularity !== undefined && (!['statement', 'line', 'instruction'].includes(String(args.granularity)) || ctx.capabilities.supportsSteppingGranularity !== true)) throw new Error('지원하지 않는 단계 단위')
  integer('start', 0); integer('count', 1, command === 'readMemory' ? 4096 : 200, command === 'readMemory')
  if (command === 'variables') { args.start ??= 0; args.count ??= 200 }
  if (args.filter !== undefined && !['indexed', 'named'].includes(String(args.filter))) throw new Error('잘못된 변수 필터')
  integer('startFrame'); integer('levels', 1, 200); integer('startModule'); integer('moduleCount', 1, 200)
  if (command === 'stackTrace') { args.startFrame ??= 0; args.levels ??= 40 }
  if (command === 'modules') { args.startModule ??= 0; args.moduleCount ??= 200 }
  if (args.format !== undefined) {
    const format = args.format as Record<string, unknown>
    if (!format || typeof format !== 'object' || Array.isArray(format) || Object.keys(format).some(key => key !== 'hex') || typeof format.hex !== 'boolean' || ctx.capabilities.supportsValueFormattingOptions !== true) throw new Error('값 표시 형식을 지원하지 않습니다')
  }
  if (['readMemory', 'writeMemory', 'disassemble'].includes(command)) { text('memoryReference', 4096, true); integer('offset', -Number.MAX_SAFE_INTEGER) }
  if (command === 'writeMemory') {
    text('data', 5464, true)
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(String(args.data)) || Buffer.from(String(args.data), 'base64').length > 4096) throw new Error('4096바이트 이하 Base64 데이터가 필요합니다')
    if (args.allowPartial !== undefined && typeof args.allowPartial !== 'boolean') throw new Error('잘못된 부분 쓰기 옵션')
  }
  if (command === 'disassemble') { integer('instructionOffset', -Number.MAX_SAFE_INTEGER); integer('instructionCount', 1, 256, true); if (args.resolveSymbols !== undefined && typeof args.resolveSymbols !== 'boolean') throw new Error('잘못된 심볼 옵션') }
  if (args.source !== undefined) {
    const source = args.source as Record<string, unknown>
    if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some(key => !['path', 'name', 'sourceReference'].includes(key))) throw new Error('잘못된 소스')
    if (source.path !== undefined && (typeof source.path !== 'string' || !source.path || source.path.length > 4096 || source.path.includes('\0'))) throw new Error('잘못된 소스 경로')
    if (source.sourceReference !== undefined && (!Number.isSafeInteger(source.sourceReference) || !ctx.sources.has(Number(source.sourceReference)))) throw new Error('알 수 없는 소스 참조입니다')
  }
  for (const key of ['line', 'column', 'endLine', 'endColumn']) integer(key, 1)
  if (['gotoTargets', 'breakpointLocations'].includes(command)) { integer('line', 1, Number.MAX_SAFE_INTEGER, true); if (!args.source) throw new Error('소스를 선택하세요') }
  if (command === 'goto') integer('targetId', 0, Number.MAX_SAFE_INTEGER, true)
  if (command === 'source') integer('sourceReference', 1, Number.MAX_SAFE_INTEGER, true)
  if (command === 'completions') { text('text', 4096); integer('column', 1, 4097, true); if (typeof args.text !== 'string') throw new Error('입력 문자열이 필요합니다') }
  if (command === 'dataBreakpointInfo') { text('name', 2048, true); integer('bytes', 1, 4096); if (args.asAddress !== undefined && (typeof args.asAddress !== 'boolean' || args.asAddress && ctx.capabilities.supportsDataBreakpointBytes !== true)) throw new Error('주소 중단점을 지원하지 않습니다') }
  if (command === 'cancel') text('progressId', 128, true)
  return args
}
