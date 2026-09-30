export interface GitRemoteProgress {
  phase: 'connecting' | 'counting' | 'compressing' | 'writing' | 'receiving' | 'resolving' | 'waiting'
  percent?: number
  current?: number
  total?: number
}
export type GitRemoteEvent = { type: 'progress'; progress: GitRemoteProgress } | { type: 'complete' } | { type: 'error'; error: string }

/** Only structured counters leave the server; never forward Git output or credentials. */
export function gitProgressParser(emit: (progress: GitRemoteProgress) => void): (chunk: string) => void {
  let pending = '', previous = ''
  return chunk => {
    pending += chunk
    const lines = pending.split(/[\r\n]/)
    pending = lines.pop()!.slice(-4096)
    for (const line of lines) {
      const match = /^(?:remote:\s*)?(Counting objects|Compressing objects|Writing objects|Receiving objects|Resolving deltas):\s*(\d+)%\s*\((\d+)\/(\d+)\)/.exec(line.trim())
      if (!match) continue
      const phases: Record<string, GitRemoteProgress['phase']> = { 'Counting objects': 'counting', 'Compressing objects': 'compressing', 'Writing objects': 'writing', 'Receiving objects': 'receiving', 'Resolving deltas': 'resolving' }
      const progress = { phase: phases[match[1]], percent: Math.min(100, Number(match[2])), current: Number(match[3]), total: Number(match[4]) }
      const key = JSON.stringify([progress.phase, progress.percent, progress.total])
      if (key === previous) continue
      previous = key
      emit(progress)
      if (progress.phase === 'writing' && progress.percent === 100) emit({ phase: 'waiting' })
    }
  }
}
