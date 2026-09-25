import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useEffect, useId, useRef, useState } from 'react'
import { copyText, DialogFrame } from '@mew/ui'
import { fetchGitHubAuth, openGitHubLoginBrowser, startGitHubLogin, stopGitHubLogin } from '../api/client'
import { githubLoginPending, type GitHubAuthStatus } from '../../shared/github-auth'
import { ServerDomBrowserTabs } from './server-dom-browser'

const button = 'rounded px-3 py-2 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'

export function GitHubAccount({ project }: { project: string }) {
  useUiLocale()
  const [status, setStatus] = useState<GitHubAuthStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [reload, setReload] = useState(0)
  const version = useRef(0)
  const titleId = useId()
  const active = githubLoginPending(status?.job ?? null)
  const job = status?.job

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const current = version.current
      let repeat = true
      let pollDelay = 1500
      try {
        const result = await fetchGitHubAuth(project)
        if (disposed || current !== version.current) return
        setStatus(result); setLoadError(null)
        repeat = result.busy || githubLoginPending(result.job)
        if (!githubLoginPending(result.job)) setStreamUrl(null)
      } catch (err) {
        if (!disposed && current === version.current) setLoadError(err instanceof Error ? err.message : String(err))
        repeat = active || !!status?.busy
        pollDelay = 5000
      } finally {
        if (!disposed && current === version.current) setLoading(false)
      }
      if (!disposed && repeat) timer = setTimeout(poll, pollDelay)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [project, reload, active, status?.busy])

  const action = async (kind: 'start' | 'stop' | 'browser') => {
    if (busy) return
    version.current += 1
    setBusy(true); setError(null); setCopied(false)
    try {
      if (kind === 'start') {
        const result = await startGitHubLogin(project)
        setStreamUrl(null)
        setStatus(previous => ({ available: true, login: null, environmentToken: false, busy: false, ...previous, job: result.job }))
      } else if (job && kind === 'stop') {
        await stopGitHubLogin(project, job.id)
        setStreamUrl(null)
      } else if (job) {
        const page = await openGitHubLoginBrowser(project, job.id)
        setStreamUrl(page.streamUrl)
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false); setReload(value => value + 1) }
  }

  const label = loading ? uiText("GitHub 확인 중…") : status?.login ? `GitHub · ${status.login}` : active ? uiText("GitHub 로그인 중…") : uiText("GitHub 로그인")
  return <>
    <div className="flex min-w-0 max-w-36 items-center">
      <button type="button" className={`${button} max-w-full truncate`} onClick={() => setOpen(true)} aria-haspopup="dialog" title={label}>{label}</button>
    </div>
    {open && <DialogFrame labelledBy={titleId} onClose={() => setOpen(false)} className={streamUrl && active ? 'flex h-[85dvh] max-w-4xl flex-col' : 'max-w-md max-h-[90dvh] overflow-y-auto'}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-2">
        <h2 id={titleId} className="text-sm font-semibold text-ink">{uiText("GitHub 로그인")}</h2>
        <button type="button" className={button} onClick={() => setOpen(false)}>{uiText("닫기")}</button>
      </div>
      <div className="shrink-0 space-y-3 p-4 text-sm text-ink">
        {loading ? <p role="status">{uiText("로그인 상태를 확인하는 중…")}</p> : status?.login && !active ? <p role="status"><strong className="break-all">{status.login}</strong> {uiText(" 계정으로 연결되었습니다.")}</p> : status?.busy ? <p role="status">{uiText("다른 사용자가 GitHub 로그인 중입니다.")}</p> : !active && <p>{uiText("GitHub에 로그인해 저장소에 연결하세요.")}</p>}
        <p className="text-xs text-ink-secondary">{uiText("연결한 GitHub 계정은 이 서버의 Git 작업에서 함께 사용합니다.")}</p>
        {status?.available === false && <p>{uiText("GitHub CLI(gh)를 서버에 설치한 뒤 새로고침하세요.")} <a className="text-accent underline" href="https://cli.github.com/" target="_blank" rel="noopener noreferrer">{uiText("설치 안내")}</a></p>}
        {status?.environmentToken && <p className="text-xs text-ink-secondary">{uiText("서버에 설정된 GitHub 토큰을 사용 중입니다.")}</p>}
        {active && <p role="status" className="text-xs text-ink-secondary">{job?.state === 'starting' ? uiText("승인 코드를 준비하는 중…") : job?.state === 'configuring' ? uiText("Git 연결을 마무리하는 중…") : uiText("아래 코드를 GitHub 승인 화면에 입력하세요.")}</p>}
        {job?.code && <div className="flex flex-wrap items-center gap-2">
          <code className="select-all font-mono text-lg tabular-nums">{job.code}</code>
          <button type="button" className={button} onClick={() => { void copyText(job.code!).then(ok => { setCopied(ok); if (!ok) setError(uiText("코드를 복사하지 못했습니다. 코드를 선택해 직접 복사하세요.")) }) }}>{copied ? uiText("복사됨") : uiText("코드 복사")}</button>
          {!streamUrl && <button type="button" className={`${button} border border-edge-strong`} disabled={busy} onClick={() => void action('browser')}>{busy ? uiText("여는 중…") : uiText("로그인 계속하기")}</button>}
        </div>}
        {(error || loadError || job?.error) && <p role="alert" className="select-text break-words text-xs text-danger">{error || loadError || job?.error}</p>}
        {job?.state === 'complete' && !status?.login && <p role="status" className="text-xs text-ink-secondary">{uiText("승인은 완료됐지만 계정을 확인하지 못했습니다. 새로고침해 주세요.")}</p>}
      </div>
      {streamUrl && active && job && <ServerDomBrowserTabs key={streamUrl} streamUrl={streamUrl} reopen={async () => (await openGitHubLoginBrowser(project, job.id)).streamUrl} />}
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge p-3">
          {active ? <button type="button" className={button} disabled={busy || job?.state === 'configuring'} onClick={() => void action('stop')}>{uiText("로그인 취소")}</button> : <>
            <button type="button" className={button} disabled={loading || busy} onClick={() => { setError(null); setLoading(true); setReload(value => value + 1) }}>{uiText("새로고침")}</button>
            {!status?.login && <button type="button" className="rounded bg-accent px-3 py-2 text-xs font-medium text-ink-on-accent hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40" disabled={loading || busy || !status || !status.available || status.busy || status.environmentToken} onClick={() => void action('start')}>{busy ? uiText("시작 중…") : job?.state === 'failed' ? uiText("다시 로그인") : uiText("GitHub 로그인")}</button>}
          </>}
        </div>
    </DialogFrame>}
  </>
}
