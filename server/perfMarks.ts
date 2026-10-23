type PerfFields = Record<string, string | number | boolean | null | undefined>

function enabled(): boolean {
  return process.env.MEW_PERF_LOG === '1'
}

export async function measure<T>(name: string, fields: PerfFields, run: () => Promise<T>): Promise<T> {
  if (!enabled()) return run()
  const started = process.hrtime.bigint()
  try {
    return await run()
  } finally {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000
    console.log(JSON.stringify({ type: 'mew.perf', name, durationMs, ...fields }))
  }
}

export function measureSync<T>(name: string, fields: PerfFields, run: () => T): T {
  if (!enabled()) return run()
  const started = process.hrtime.bigint()
  try {
    return run()
  } finally {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000
    console.log(JSON.stringify({ type: 'mew.perf', name, durationMs, ...fields }))
  }
}
