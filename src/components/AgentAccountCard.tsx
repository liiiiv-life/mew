import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { fetchAgentRuntimeAccount, openServerBrowserTab, closeServerBrowserTab, type ServerBrowserTab } from '../api/client'
import { SUBSCRIPTION_URLS, type AccessIssue, type RuntimeAccount } from '../../shared/agent-access'
import { ServerDomBrowserTabs } from './server-dom-browser'
import { useI18n } from '../i18n'

const copy = {
  ko: { apiNote: 'API 사용 요금 별도', title: '연결 계정 · 구독', loading: '계정 확인 중…', refresh: '다시 확인', account: '계정', unknown: '확인할 수 없음', plan: '플랜', free: '무료', paid: '구독 중', signedOut: '로그인 필요', api: 'API 키 연결', subscribe: '구독하기', manage: '구독 관리', subscription_required: '구독이 필요합니다', quota_exhausted: '사용량 한도를 모두 사용했습니다', credits_exhausted: '사용 가능한 크레딧이 부족합니다', hint: '연결된 계정과 같은 계정인지 확인하세요.', paused: '대기 메시지를 이어 보내려면 새 메시지를 보내세요.', failed: '계정을 확인하지 못했습니다. 다시 시도하세요.', close: '채팅으로 돌아가기', browser: '구독 페이지', opening: '페이지 여는 중…' },
  en: { apiNote: 'API usage billed separately', title: 'Connected account · Plan', loading: 'Checking account…', refresh: 'Check again', account: 'Account', unknown: 'Unavailable', plan: 'Plan', free: 'Free', paid: 'Subscribed', signedOut: 'Sign in required', api: 'API key', subscribe: 'Subscribe', manage: 'Manage subscription', subscription_required: 'Subscription required', quota_exhausted: 'Usage limit reached', credits_exhausted: 'Insufficient credits', hint: 'Use the same account as your connected agent.', paused: 'Send a new message to resume the queue.', failed: 'Could not check the account. Try again.', close: 'Return to chat', browser: 'Subscription page', opening: 'Opening page…' },
  'zh-CN': { apiNote: 'API 用量单独计费', title: '已连接账户 · 订阅', loading: '正在检查账户…', refresh: '重新检查', account: '账户', unknown: '无法确认', plan: '套餐', free: '免费', paid: '已订阅', signedOut: '需要登录', api: 'API 密钥', subscribe: '订阅', manage: '管理订阅', subscription_required: '需要订阅', quota_exhausted: '用量已达上限', credits_exhausted: '额度不足', hint: '请使用与已连接代理相同的账户。', paused: '发送新消息以继续处理排队消息。', failed: '无法检查账户，请重试。', close: '返回聊天', browser: '订阅页面', opening: '正在打开页面…' },
  ja: { apiNote: 'API 利用料金は別途', title: '接続アカウント · 契約', loading: 'アカウント確認中…', refresh: '再確認', account: 'アカウント', unknown: '確認できません', plan: 'プラン', free: '無料', paid: '契約中', signedOut: 'ログインが必要です', api: 'API キー', subscribe: '契約する', manage: '契約を管理', subscription_required: '契約が必要です', quota_exhausted: '使用量の上限に達しました', credits_exhausted: 'クレジットが不足しています', hint: '接続中のエージェントと同じアカウントを使ってください。', paused: '新しいメッセージを送信して待機中のメッセージを再開してください。', failed: 'アカウントを確認できません。再試行してください。', close: 'チャットに戻る', browser: '契約ページ', opening: 'ページを開いています…' },
}
const button = 'rounded border border-edge-bright px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50'

export function AgentAccountCard({ runtime, issue = null, queued = false, embedded = false }: { runtime: string; issue?: AccessIssue | null; queued?: boolean; embedded?: boolean }) {
  const { locale } = useI18n()
  const c = copy[locale]
  const [account, setAccount] = useState<RuntimeAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [browser, setBrowser] = useState<string | null>(null)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let alive = true
    setLoading(true); setError(false); setAccount(null)
    void fetchAgentRuntimeAccount(runtime).then((result) => { if (alive) setAccount(result.account) })
      .catch(() => { if (alive) setError(true) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [runtime, revision, issue])
  const problem = issue ?? account?.issue
  const url = account ? account.subscriptionUrl : SUBSCRIPTION_URLS[runtime]
  const unsubscribed = account?.subscription === 'free'
  const planLabel = unsubscribed && (!account?.plan || account.plan.toLowerCase() === 'free')
    ? c.free
    : `${account?.plan ?? c.unknown}${unsubscribed ? ` · ${c.free}` : account?.subscription === 'paid' ? ` · ${c.paid}` : ''}`
  const content = <div className="space-y-2 py-2" aria-live="polite" aria-busy={loading}>
    {loading ? <p>{c.loading}</p> : <>
      <p className="break-words">{c.account}: <strong className="font-medium text-ink">{account?.authentication === 'signed_out' ? c.signedOut : account?.account ?? (account?.authentication === 'api_key' ? c.api : c.unknown)}</strong></p>
      <p className="break-words">{c.plan}: {planLabel}</p>
      {error && <p role="alert">{c.failed}</p>}
      {account?.authentication === 'api_key' && <p className="text-xs">{c.apiNote}</p>}
    </>}
    {problem && queued && <p>{c.paused}</p>}
    <div className="flex flex-wrap gap-2">
      {url && <button type="button" className={button + ' text-accent'} onClick={() => setBrowser(url)}>{unsubscribed || problem === 'subscription_required' ? c.subscribe : c.manage}</button>}
      <button type="button" className={button} disabled={loading} onClick={refresh}>{c.refresh}</button>
    </div>
  </div>
  return <section className={embedded ? 'mt-3 border-t border-edge pt-3 text-sm text-ink-secondary' : 'shrink-0 border-b border-edge px-3 py-2 text-sm text-ink-secondary'} aria-label={c.title}>
    {embedded ? <>
      <h3 className="font-medium text-ink">{c.title}</h3>
      {problem && <p className="pt-2 text-danger" role="alert">{c[problem]}</p>}
      {content}
    </> : <details key={`${runtime}:${problem ?? ''}:${unsubscribed}`} open={!!problem || unsubscribed}>
      <summary className="cursor-pointer py-1 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{problem ? c[problem] : c.title}</summary>
      {content}
    </details>}
    {browser && <SubscriptionBrowser url={browser} onClose={() => { setBrowser(null); refresh() }} />}
  </section>
}

function SubscriptionBrowser({ url, onClose }: { url: string; onClose: () => void }) {
  const { locale } = useI18n()
  const c = copy[locale]
  const [page, setPage] = useState<ServerBrowserTab | null>(null)
  const [error, setError] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const tabs = useRef(new Set<string>())
  useOverlayDismiss(onClose)
  useEffect(() => {
    let alive = true
    const previousFocus = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const ownedTabs = tabs.current
    const id = crypto.randomUUID()
    ownedTabs.add(id)
    void openServerBrowserTab(id, url).then((value) => {
      if (alive) setPage(value)
      else void closeServerBrowserTab(id).catch(() => {})
    }).catch(() => { if (alive) setError(true) })
    return () => {
      alive = false
      for (const tab of ownedTabs) void closeServerBrowserTab(tab).catch(() => {})
      previousFocus?.focus()
    }
  }, [url])
  return createPortal(<div ref={dialogRef} role="dialog" aria-modal="true" aria-label={c.browser} className="fixed inset-0 z-[70] flex flex-col bg-surface-deep text-ink" onKeyDown={(event) => {
    if (event.key !== 'Tab') return
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? [])
    const first = nodes[0], last = nodes.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }}>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-edge p-3">
      <span className="min-w-0 break-all text-sm">{new URL(url).host}</span>
      <button ref={closeRef} type="button" className={button} onClick={onClose}>{c.close}</button>
    </div>
    <p className="shrink-0 px-3 py-2 text-xs text-ink-secondary">{c.hint}</p>
    {page ? <ServerDomBrowserTabs streamUrl={page.streamUrl} reopen={async () => (await openServerBrowserTab(page.id, url)).streamUrl} onPopup={(id) => tabs.current.add(id)} />
      : <p className="p-4 text-sm" role={error ? 'alert' : 'status'}>{error ? c.failed : c.opening}</p>}
  </div>, document.body)
}
