import { uiText } from '@mew/ui/i18n-core'
import { useCallback, useEffect, useState } from 'react'
import { SessionTerminalPopup } from './SessionTerminalPopup.tsx'

type InstallStatus = { session: string; terminal: boolean; state: 'idle' | 'running' | 'succeeded' | 'failed' | 'interrupted'; exitCode: number | null }
const notes = {
  get idle() { return uiText("원격 데스크톱을 준비합니다.") },
  get running() { return uiText("준비 중 · 창을 닫아도 계속 진행됩니다.") },
  get succeeded() { return uiText("준비 완료 · 데스크톱에 자동으로 연결합니다.") },
  get failed() { return uiText("준비 실패 · 터미널의 오류를 확인한 뒤 다시 연결해 주세요.") },
  get interrupted() { return uiText("준비가 중단됐습니다. 다시 연결해 주세요.") },
}

/** Closing the viewer only detaches from installation; the tmux job remains available. */
export function useDesktopInstall(enabled: boolean, retry: () => void) {
  const [job, setJob] = useState<InstallStatus | null>(null)
  const [open, setOpen] = useState(false), [error, setError] = useState('')
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/remote-desktop/install', { cache: 'no-store', signal })
    if (!response.ok) throw new Error(uiText("설치 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."))
    const value: InstallStatus = await response.json()
    if (!signal?.aborted) { setJob(value); setError('') }
    return value
  }, [])
  useEffect(() => {
    if (!enabled && !open) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      let keepPolling = true
      try { const value = await refresh(abort.signal); keepPolling = enabled || open || value.state === 'running' }
      catch (error) { if (!abort.signal.aborted) setError((error as Error).message) }
      if (!abort.signal.aborted && keepPolling) timer = setTimeout(poll, 1500)
    }
    void poll()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [enabled, open, refresh])
  return {
    open, error,
    actions: <>
      {job?.terminal && <button onClick={() => setOpen(true)}>{uiText("준비 내역 보기")}</button>}
    </>,
    popup: open && job && <SessionTerminalPopup
      title={uiText("원격 데스크톱 준비")} subtitle={uiText("필요한 파일을 자동으로 준비합니다")}
      session={job.session} running={job.terminal} zIndex={1700}
      statusNote={error || notes[job.state] + (job.state === 'failed' && job.exitCode !== null ? uiText(" (종료 코드 {p0})", { p0: job.exitCode }) : '')}
      statusTone={error || job.state === 'failed' || job.state === 'interrupted' ? 'danger' : job.state === 'succeeded' ? 'success' : 'muted'}
      onRun={async () => { setOpen(false); retry() }} onClose={() => setOpen(false)} onChanged={() => { void refresh().catch(error => setError(error.message)) }}
    />,
  }
}
