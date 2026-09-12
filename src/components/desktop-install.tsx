import { useCallback, useEffect, useRef, useState } from 'react'
import { SessionTerminalPopup } from './SessionTerminalPopup.tsx'

type InstallStatus = { session: string; terminal: boolean; state: 'idle' | 'running' | 'succeeded' | 'failed' | 'interrupted'; exitCode: number | null }
const notes = {
  idle: '보조 앱을 설치합니다.',
  running: '설치 중 · 창을 닫아도 계속 진행됩니다.',
  succeeded: '설치 완료 · 닫고 다시 연결을 눌러 주세요.',
  failed: '설치 실패 · 터미널의 오류를 확인해 주세요.',
  interrupted: '설치가 중단됐습니다. 다시 설치해 주세요.',
}

/** Closing the viewer only detaches from installation; the tmux job remains available. */
export function useDesktopInstall(enabled: boolean) {
  const [job, setJob] = useState<InstallStatus | null>(null)
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef(false), version = useRef(0)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const current = version.current
    const response = await fetch('/api/remote-desktop/install', { cache: 'no-store', signal })
    if (!response.ok) throw new Error('설치 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    const value: InstallStatus = await response.json()
    if (current === version.current && !signal?.aborted) { setJob(value); setError('') }
    return value
  }, [])
  useEffect(() => {
    if (!enabled && !open) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      let keepPolling = true
      try { const value = await refresh(abort.signal); keepPolling = open || value.state === 'running' }
      catch (error) { if (!abort.signal.aborted) setError((error as Error).message) }
      if (!abort.signal.aborted && keepPolling) timer = setTimeout(poll, 1500)
    }
    void poll()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [enabled, open, refresh])
  const start = async () => {
    if (pending.current) return
    pending.current = true; version.current++; setBusy(true); setError('')
    try {
      const response = await fetch('/api/remote-desktop/install', { method: 'POST' })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || '설치 터미널을 열지 못했습니다.')
      version.current++; setJob(value); setOpen(true)
    } catch (error) { setError((error as Error).message); throw error }
    finally { pending.current = false; setBusy(false) }
  }
  return {
    open, busy, error,
    actions: <>
      {job?.terminal && <button disabled={busy} onClick={() => setOpen(true)}>설치 터미널 열기</button>}
      {job?.state !== 'running' && <button disabled={busy} onClick={() => { void start().catch(() => {}) }}>{busy ? '설치 준비 중…' : job && job.state !== 'idle' ? '다시 설치' : '보조 앱 설치'}</button>}
    </>,
    popup: open && job && <SessionTerminalPopup
      title="원격 데스크톱 보조 앱 설치" subtitle="npm run desktop:install"
      session={job.session} running={job.terminal} zIndex={1700}
      statusNote={error || notes[job.state] + (job.state === 'failed' && job.exitCode !== null ? ` (종료 코드 ${job.exitCode})` : '')}
      statusTone={error || job.state === 'failed' || job.state === 'interrupted' ? 'danger' : job.state === 'succeeded' ? 'success' : 'muted'}
      onRun={start} onClose={() => setOpen(false)} onChanged={() => { void refresh().catch(error => setError(error.message)) }}
    />,
  }
}
