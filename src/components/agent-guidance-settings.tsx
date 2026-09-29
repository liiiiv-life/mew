import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Settings, Xmark, PageEdit } from 'iconoir-react'
import { SelectField, useOverlayDismiss } from '@mew/ui'
import { useI18n } from '../i18n'
import { guidanceOptions, type GuidanceKey, type GuidanceSnapshot } from '../../shared/agent-guidance'

const copy = {
  ko: { title: '에이전트 기본 지침', scope: '모든 프로젝트에 공통으로 적용됩니다. 변경 내용은 다음 요청부터 반영됩니다.', file: '파일 보기', close: '닫기', reload: '다시 불러오기', loading: '불러오는 중…', saving: '저장 중…', saved: '저장했습니다.', error: '지침을 불러오지 못했습니다. 다시 시도하세요.', custom: '직접 편집한 지침', inherit: '별도 지정 안 함', commit: '커밋 방식', always: '매 변경 완료 후 커밋', requested: '요청할 때만 커밋', language: '응답 언어', subagents: '서브에이전트 위임', automatic: '필요할 때 자동 위임', explicit: '요청할 때만 위임', never: '사용 안 함', detail: '답변 길이', concise: '간결하게', detailed: '자세하게', customHint: '직접 편집한 항목에서 다른 값을 선택하면 해당 지침을 바꿉니다.' },
  en: { title: 'Agent instructions', scope: 'Shared by all projects. Changes apply from the next request.', file: 'View file', close: 'Close', reload: 'Reload', loading: 'Loading…', saving: 'Saving…', saved: 'Saved.', error: 'Could not load instructions. Try again.', custom: 'Custom instructions', inherit: 'Not specified', commit: 'Git commits', always: 'Commit after each completed change', requested: 'Commit only when requested', language: 'Response language', subagents: 'Subagent delegation', automatic: 'Delegate when useful', explicit: 'Delegate only when requested', never: 'Do not use', detail: 'Response length', concise: 'Concise', detailed: 'Detailed', customHint: 'Choosing another value replaces the custom instructions for that setting.' },
  ja: { title: 'エージェントの基本指針', scope: 'すべてのプロジェクトに共通です。変更は次のリクエストから適用されます。', file: 'ファイルを表示', close: '閉じる', reload: '再読み込み', loading: '読み込み中…', saving: '保存中…', saved: '保存しました。', error: '指針を読み込めませんでした。再試行してください。', custom: '直接編集した指針', inherit: '指定なし', commit: 'コミット方法', always: '変更完了ごとにコミット', requested: '依頼時のみコミット', language: '応答言語', subagents: 'サブエージェントへの委任', automatic: '必要に応じて自動で委任', explicit: '依頼時のみ委任', never: '使用しない', detail: '回答の長さ', concise: '簡潔に', detailed: '詳しく', customHint: '別の値を選ぶと、その項目の直接編集した指針が置き換わります。' },
  'zh-CN': { title: '代理默认指引', scope: '适用于所有项目。更改从下一次请求开始生效。', file: '查看文件', close: '关闭', reload: '重新加载', loading: '加载中…', saving: '保存中…', saved: '已保存。', error: '无法加载指引，请重试。', custom: '自定义指引', inherit: '不指定', commit: '提交方式', always: '每次完成更改后提交', requested: '仅在请求时提交', language: '回复语言', subagents: '子代理委派', automatic: '需要时自动委派', explicit: '仅在请求时委派', never: '不使用', detail: '回复长度', concise: '简洁', detailed: '详细', customHint: '选择其他值将替换该项的自定义指引。' },
}
const button = 'inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded px-2.5 text-sm text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'

async function request(init?: RequestInit): Promise<GuidanceSnapshot> {
  const response = await fetch('/api/fs/agent-guidance', { cache: 'no-store', ...init })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body
}

export function AgentGuidanceButton({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const { locale } = useI18n(), text = copy[locale]
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" aria-label={text.title} title={text.title} data-tip={text.title} onClick={() => setOpen(true)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"><Settings width={14} height={14} aria-hidden /></button>
    {open && <AgentGuidanceSettings onClose={() => setOpen(false)} onOpenFile={onOpenFile} />}
  </>
}

export function AgentGuidanceSettings({ onClose, onOpenFile }: { onClose: () => void; onOpenFile: (path: string) => void }) {
  const { locale } = useI18n(), text = copy[locale]
  const [data, setData] = useState<GuidanceSnapshot | null>(null)
  const [busy, setBusy] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const dialog = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null)
  const pending = useRef(false), generation = useRef(0)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const parkFocus = () => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && dialog.current?.contains(focused) && focused !== closeButton.current) {
      restoreFocus.current = focused
      closeButton.current?.focus()
    }
  }
  useEffect(() => {
    if (busy) return
    const previous = restoreFocus.current
    restoreFocus.current = null
    if (document.activeElement === closeButton.current && previous?.isConnected && !previous.matches(':disabled')) previous.focus()
  }, [busy])
  const close = () => { if (!pending.current) onClose() }
  useOverlayDismiss(close)
  const load = async () => {
    const version = ++generation.current
    parkFocus()
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await request()
      if (generation.current === version) {
        setData(next)
        window.dispatchEvent(new CustomEvent('mew:external-file-updated', { detail: { path: next.path, content: next.content } }))
      }
    }
    catch (cause) { if (generation.current === version) setError(`${text.error} ${cause instanceof Error ? cause.message : ''}`) }
    finally { if (generation.current === version) setBusy(false) }
  }
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    void load()
    const requests = generation
    return () => { requests.current++; if (opener?.isConnected) opener.focus() }
    // The shared file is read on every open, regardless of the active project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function update(key: GuidanceKey, value: string) {
    if (!data || pending.current || busy) return
    pending.current = true
    parkFocus()
    setBusy(true); setSaving(true); setError(''); setNotice('')
    const version = ++generation.current
    try {
      const next = await request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value, revision: data.revision }) })
      window.dispatchEvent(new CustomEvent('mew:external-file-updated', { detail: { path: next.path, content: next.content } }))
      if (generation.current === version) { setData(next); setNotice(text.saved) }
    } catch (cause) { if (generation.current === version) setError(cause instanceof Error ? cause.message : text.error) }
    finally { pending.current = false; if (generation.current === version) { setBusy(false); setSaving(false) } }
  }
  const labels: Record<string, string> = { ...text, ko: '한국어', en: 'English', ja: '日本語', zh: '简体中文' }
  return createPortal(<div data-cmd-overlay className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-3" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={text.title} className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-surface text-ink shadow-xl" onKeyDown={event => {
      if (event.key !== 'Tab') return
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <h2 className="flex-1 text-sm font-semibold">{text.title}</h2>
        <button ref={closeButton} type="button" className={button} aria-label={text.close} aria-disabled={saving} onClick={close}><Xmark width={18} height={18} aria-hidden /></button>
      </header>
      <div className="overflow-y-auto px-4 py-3" aria-busy={busy}>
        <p className="mb-4 text-xs leading-relaxed text-ink-secondary">{text.scope}</p>
        {data && <div className="space-y-3">{(Object.keys(guidanceOptions) as GuidanceKey[]).map(key => <div key={key} className="flex flex-col gap-1.5 text-sm">
          <span>{text[key]}</span>
          <SelectField label={text[key]} value={data.settings[key]} disabled={busy || !!error} onChange={value => void update(key, value)}
            options={[
              ...(data.settings[key] === 'custom' ? [{ value: 'custom', label: text.custom, disabled: true }] : []),
              ...Object.keys(guidanceOptions[key]).map(value => ({ value, label: labels[value] })),
            ]} />
        </div>)}</div>}
        {data && Object.values(data.settings).includes('custom') && <p className="mt-3 text-xs leading-relaxed text-ink-secondary">{text.customHint}</p>}
        <p role="status" className="mt-3 min-h-5 text-xs text-ink-secondary">{busy ? saving ? text.saving : text.loading : notice}</p>
        {error && <p role="alert" className="mt-2 select-text text-sm text-danger">{error}</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-edge px-3 py-2">
        <button type="button" className={button} disabled={busy || !data} onClick={() => { if (data) { onClose(); onOpenFile(data.path) } }}><PageEdit width={16} height={16} aria-hidden />{text.file}</button>
        <button type="button" className={button} disabled={busy} onClick={() => void load()}>{text.reload}</button>
      </footer>
    </div>
  </div>, document.body)
}
