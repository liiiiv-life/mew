import { GIT_LOGIN_EVENT, GIT_CONNECTION_CHANGED, type GitLoginRequest } from '../api/git-auth-request'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useEffect, useId, useRef, useState } from 'react'
import { copyText, DialogFrame, HoverTipLayer } from '@mew/ui'
import { Check, Copy, Computer, Github, LinkSlash, OpenNewWindow, Refresh, Xmark, XmarkCircle } from 'iconoir-react'
import { disconnectGitHub, fetchGitHubAuth, openGitHubLoginBrowser, startGitHubLogin, stopGitHubLogin } from '../api/client'
import { githubLoginPending, type GitHubAuthStatus } from '../../shared/github-auth'
import { ServerDomBrowserTabs } from './server-dom-browser'

const iconButton = 'flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'

const button = 'inline-flex h-7 items-center justify-center gap-1.5 rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'

export function GitHubAccount({ project, request }: { project: string; request?: GitLoginRequest }) {
  useUiLocale()
  const [status, setStatus] = useState<GitHubAuthStatus | null>(null)
  const [open, setOpen] = useState(!!request)
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
  const finish = useRef(request?.finish)
  const completed = useRef<string | undefined>(undefined)
  const close = () => { finish.current?.(false); finish.current = undefined; setOpen(false) }

  useEffect(() => {
    const changed = () => setReload(value => value + 1)
    window.addEventListener(GIT_CONNECTION_CHANGED, changed)
    return () => { window.removeEventListener(GIT_CONNECTION_CHANGED, changed); finish.current?.(false) }
  }, [])
  useEffect(() => {
    if (status?.login && finish.current) { const done = finish.current; finish.current = undefined; setOpen(false); done(true) }
  }, [status?.login])
  useEffect(() => {
    if (job?.state === 'complete' && completed.current !== job.id) { completed.current = job.id; window.dispatchEvent(new Event(GIT_CONNECTION_CHANGED)) }
  }, [job?.id, job?.state])

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

  const action = async (kind: 'start' | 'stop' | 'browser' | 'disconnect') => {
    if (busy) return
    version.current += 1
    setBusy(true); setError(null); setCopied(false)
    try {
      if (kind === 'disconnect') {
        await disconnectGitHub(project)
        setStatus(null); setStreamUrl(null)
        window.dispatchEvent(new Event(GIT_CONNECTION_CHANGED))
      } else if (kind === 'start') {
        const result = await startGitHubLogin(project)
        setStreamUrl(null)
        setStatus(previous => ({ available: true, login: null, environmentToken: false, busy: false, ...previous, job: result.job }))
      } else if (job && kind === 'stop') {
        await stopGitHubLogin(project, job.id)
        setStreamUrl(null)
      } else if (job && kind === 'browser') {
        const page = await openGitHubLoginBrowser(project, job.id)
        setStreamUrl(page.streamUrl)
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false); setReload(value => value + 1) }
  }

  const label = loading ? uiText("GitHub 확인 중…") : status?.login ? `GitHub · ${status.login}` : active ? uiText("GitHub 로그인 중…") : uiText("GitHub 로그인")
  return <>
    {!request && <div className="flex min-w-0 max-w-36 items-center">
      <button type="button" className={`${button} max-w-full truncate`} onClick={() => setOpen(true)} aria-haspopup="dialog" title={label}>{label}</button>
    </div>}
    {open && <DialogFrame labelledBy={titleId} onClose={close} className={streamUrl && active ? 'flex h-[85dvh] max-w-4xl flex-col' : 'flex max-w-sm max-h-[90dvh] flex-col'}>
      <HoverTipLayer className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <h2 id={titleId} className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink"><Github width={16} height={16} aria-hidden="true" />{uiText("GitHub 로그인")}</h2>
        <button type="button" className={iconButton} onClick={close} aria-label={uiText("닫기")} data-tip={uiText("닫기")}><Xmark width={16} height={16} aria-hidden="true" /></button>
      </div>
      <div className="shrink-0 space-y-2 px-3 py-2.5 text-xs text-ink">
        {loading ? <p role="status">{uiText("로그인 상태를 확인하는 중…")}</p> : status?.login && !active ? <p role="status"><strong className="break-all">{status.login}</strong> {uiText(" 계정으로 연결되었습니다.")}</p> : status?.busy ? <p role="status">{uiText("다른 사용자가 GitHub 로그인 중입니다.")}</p> : !active && <p>{uiText("GitHub에 로그인해 저장소에 연결하세요.")}</p>}
        {status?.available === false && <p>{uiText("서버에 MEW_GITHUB_CLIENT_ID를 설정하고 앱의 Device flow를 활성화하세요.")}</p>}
        {active && <p role="status" className="text-xs text-ink-secondary">{job?.state === 'starting' ? uiText("승인 코드를 준비하는 중…") : job?.state === 'configuring' ? uiText("Git 연결을 마무리하는 중…") : uiText("아래 코드를 GitHub 승인 화면에 입력하세요.")}</p>}
        {job?.code && <div className="flex flex-wrap items-center gap-1.5">
          <code className="select-all rounded border border-edge bg-surface-deep px-2 py-1 font-mono text-base font-semibold tracking-wide tabular-nums">{job.code}</code>
          <button type="button" className={iconButton} aria-label={copied ? uiText("복사됨") : uiText("코드 복사")} data-tip={copied ? uiText("복사됨") : uiText("코드 복사")} onClick={() => { void copyText(job.code!).then(ok => { setCopied(ok); if (!ok) setError(uiText("코드를 복사하지 못했습니다. 코드를 선택해 직접 복사하세요.")) }) }}>{copied ? <Check width={14} height={14} aria-hidden="true" /> : <Copy width={14} height={14} aria-hidden="true" />}<span role="status" className="sr-only">{copied ? uiText("복사됨") : ""}</span></button>
          <a className={iconButton} aria-label={uiText("GitHub에서 승인")} data-tip={uiText("GitHub에서 승인")} href="https://github.com/login/device" target="_blank" rel="noopener noreferrer"><OpenNewWindow width={14} height={14} aria-hidden="true" /></a>
          {!streamUrl && <button type="button" className={`${button} border border-edge-strong`} disabled={busy} onClick={() => void action('browser')}><Computer width={14} height={14} aria-hidden="true" />{busy ? uiText("여는 중…") : uiText("로그인 계속하기")}</button>}
        </div>}
        {(error || loadError || job?.error) && <p role="alert" className="select-text break-words text-xs text-danger">{error || loadError || job?.error}</p>}
        {job?.state === 'complete' && !status?.login && <p role="status" className="text-xs text-ink-secondary">{uiText("승인은 완료됐지만 계정을 확인하지 못했습니다. 새로고침해 주세요.")}</p>}
      </div>
      {streamUrl && active && job && <ServerDomBrowserTabs key={streamUrl} streamUrl={streamUrl} reopen={async () => (await openGitHubLoginBrowser(project, job.id)).streamUrl} />}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-edge px-3 py-2">
          {active ? <button type="button" className={iconButton} aria-label={uiText("로그인 취소")} data-tip={uiText("로그인 취소")} disabled={busy || job?.state === 'configuring'} onClick={() => void action('stop')}><XmarkCircle width={14} height={14} aria-hidden="true" /></button> : <>
            <button type="button" className={iconButton} aria-label={uiText("새로고침")} data-tip={uiText("새로고침")} disabled={loading || busy} onClick={() => { setError(null); setLoading(true); setReload(value => value + 1) }}><Refresh width={14} height={14} aria-hidden="true" /></button>
            {status?.login && <button type="button" className={iconButton} aria-label={uiText("연결 해제")} data-tip={uiText("연결 해제")} disabled={busy} onClick={() => void action('disconnect')}><LinkSlash width={14} height={14} aria-hidden="true" /></button>}
            {!status?.login && <button type="button" className="inline-flex h-7 items-center justify-center gap-1.5 rounded bg-accent px-2 text-xs font-medium text-ink-on-accent hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40" disabled={loading || busy || !status || !status.available || status.busy || status.environmentToken} onClick={() => void action('start')}><Github width={14} height={14} aria-hidden="true" />{busy ? uiText("시작 중…") : job?.state === 'failed' ? uiText("다시 로그인") : uiText("GitHub 로그인")}</button>}
          </>}
        </div>
      </HoverTipLayer>
    </DialogFrame>}
  </>
}


/** Always mounted for file commits too, even when the Git panel is closed. */
export function GitLoginDialog() {
  const [request, setRequest] = useState<GitLoginRequest | null>(null)
  useEffect(() => {
    const open = (event: Event) => {
      event.preventDefault()
      const next = (event as CustomEvent<GitLoginRequest>).detail
      setRequest({ ...next, finish: connected => { next.finish(connected); setRequest(null) } })
    }
    window.addEventListener(GIT_LOGIN_EVENT, open)
    return () => window.removeEventListener(GIT_LOGIN_EVENT, open)
  }, [])
  return request && <GitHubAccount project={request.project} request={request} />
}
