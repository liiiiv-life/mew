// 파일 열기 구간을 DevTools Performance/Performance API에서 한 요청 단위로 잇는다.
// 분석 데이터 전송은 하지 않는다. 브라우저가 제공하지 않는 환경(SSR·테스트)에서는 조용히 no-op이다.

export type FileOpenTrace = { id: string }

let sequence = 0

function performanceApi(): Performance | null {
  return typeof performance === 'undefined' || typeof performance.mark !== 'function' ? null : performance
}

function mark(trace: FileOpenTrace, phase: string) {
  const api = performanceApi()
  if (!api) return
  const name = `mew:file-open:${trace.id}:${phase}`
  try {
    api.mark(name)
    if (phase !== 'start') api.measure(`mew:file-open:${trace.id}:${phase}`, `mew:file-open:${trace.id}:start`, name)
  } catch {
    // 오래된 브라우저의 Performance 구현이나 mark 버퍼 제한이 파일 열기를 막아서는 안 된다.
  }
}

/** 새 파일 열기 흐름을 시작한다. id는 탭 상태에만 잠깐 남고 localStorage에는 저장하지 않는다. */
export function startFileOpen(): FileOpenTrace {
  sequence += 1
  const trace = { id: `${Date.now().toString(36)}-${sequence}` }
  mark(trace, 'start')
  return trace
}

/** start 이후의 구간을 남긴다: cache-ready, file-response, editor-ready, first-paint 등. */
export function markFileOpen(trace: FileOpenTrace | undefined, phase: string) {
  if (trace) mark(trace, phase)
}
