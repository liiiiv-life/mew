import { mewFetch } from '../utils/remote-transport.ts'
import { useEffect, useId, useRef, useState } from 'react'
import { Settings, Xmark, PageEdit, RefreshDouble } from 'iconoir-react'
import { DialogFrame, HoverTipLayer, SelectField } from '@mew/ui'
import { useI18n } from '../i18n'
import { guidanceOptions, type GuidanceKey, type GuidanceSnapshot } from '../../shared/agent-guidance'
import type { BranchGuidanceSettings } from '../../shared/branch-guidance'
import { BranchGuidanceFields } from './agent-branch-guidance'
import { GuidanceRow } from './agent-guidance-row'

const copy = {
  ko: { title: '에이전트 기본 지침', scope: '모든 프로젝트에 공통으로 적용됩니다. 변경 내용은 다음 요청부터 반영됩니다.', file: '파일 보기', close: '닫기', reload: '다시 불러오기', loading: '불러오는 중…', saving: '저장 중…', saved: '저장했습니다.', error: '지침을 불러오지 못했습니다. 다시 시도하세요.', custom: '직접 편집한 지침', inherit: '별도 지정 안 함', commit: '커밋 방식', always: '매 변경 완료 후 커밋', requested: '요청할 때만 커밋', mew: 'mew 언어 설정에 따름', language: '응답 언어', debugger: '디버거 활용', enabled: '활성화', disabled: '비활성화', subagents: '서브에이전트 위임', automatic: '필요할 때 자동 위임', explicit: '요청할 때만 위임', never: '사용 안 함', detail: '답변 길이', concise: '간결하게', detailed: '자세하게', customHint: '직접 편집한 항목에서 다른 값을 선택하면 해당 지침을 바꿉니다.' },
  en: { title: 'Agent instructions', scope: 'Shared by all projects. Changes apply from the next request.', file: 'View file', close: 'Close', reload: 'Reload', loading: 'Loading…', saving: 'Saving…', saved: 'Saved.', error: 'Could not load instructions. Try again.', custom: 'Custom instructions', inherit: 'Not specified', commit: 'Git commits', always: 'Commit after each completed change', requested: 'Commit only when requested', mew: 'Follow mew language settings', language: 'Response language', debugger: 'Debugger use', enabled: 'Enabled', disabled: 'Disabled', subagents: 'Subagent delegation', automatic: 'Delegate when useful', explicit: 'Delegate only when requested', never: 'Do not use', detail: 'Response length', concise: 'Concise', detailed: 'Detailed', customHint: 'Choosing another value replaces the custom instructions for that setting.' },
  ja: { title: 'エージェントの基本指針', scope: 'すべてのプロジェクトに共通です。変更は次のリクエストから適用されます。', file: 'ファイルを表示', close: '閉じる', reload: '再読み込み', loading: '読み込み中…', saving: '保存中…', saved: '保存しました。', error: '指針を読み込めませんでした。再試行してください。', custom: '直接編集した指針', inherit: '指定なし', commit: 'コミット方法', always: '変更完了ごとにコミット', requested: '依頼時のみコミット', mew: 'mewの言語設定に従う', language: '応答言語', debugger: 'デバッガーの活用', enabled: '有効', disabled: '無効', subagents: 'サブエージェントへの委任', automatic: '必要に応じて自動で委任', explicit: '依頼時のみ委任', never: '使用しない', detail: '回答の長さ', concise: '簡潔に', detailed: '詳しく', customHint: '別の値を選ぶと、その項目の直接編集した指針が置き換わります。' },
  'zh-CN': { title: '代理默认指引', scope: '适用于所有项目。更改从下一次请求开始生效。', file: '查看文件', close: '关闭', reload: '重新加载', loading: '加载中…', saving: '保存中…', saved: '已保存。', error: '无法加载指引，请重试。', custom: '自定义指引', inherit: '不指定', commit: '提交方式', always: '每次完成更改后提交', requested: '仅在请求时提交', mew: '跟随 mew 语言设置', language: '回复语言', debugger: '调试器使用', enabled: '启用', disabled: '禁用', subagents: '子代理委派', automatic: '需要时自动委派', explicit: '仅在请求时委派', never: '不使用', detail: '回复长度', concise: '简洁', detailed: '详细', customHint: '选择其他值将替换该项的自定义指引。' },
}
const button = 'inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded px-2 text-xs text-ink-secondary hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 pointer-coarse:min-h-11'
const generalCopy = { ko: '일반', en: 'General', ja: '一般', 'zh-CN': '常规' }
const managedCommitCopy = {
  ko: '자동 처리에 커밋이 포함됩니다. 수동 모드에서 바꿀 수 있습니다.',
  en: 'Automation includes commits. Change this setting in manual mode.',
  ja: '自動処理にコミットを含みます。手動モードで変更できます。',
  'zh-CN': '自动处理包含提交，可在手动模式下更改此设置。',
}

async function request(init?: RequestInit): Promise<GuidanceSnapshot> {
  const response = await mewFetch('/api/fs/agent-guidance', { cache: 'no-store', ...init })
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
  const titleId = useId()
  const [data, setData] = useState<GuidanceSnapshot | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [busy, setBusy] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const pending = useRef(false), generation = useRef(0)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const parkFocus = () => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && panel?.contains(focused) && focused !== closeButton.current) {
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
  const load = async () => {
    const version = ++generation.current
    parkFocus()
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await request()
      if (generation.current === version) {
        setData(next)
        setReloadVersion(current => current + 1)
        window.dispatchEvent(new CustomEvent('mew:external-file-updated', { detail: { path: next.path, content: next.content } }))
      }
    }
    catch (cause) { if (generation.current === version) setError(`${text.error} ${cause instanceof Error ? cause.message : ''}`) }
    finally { if (generation.current === version) setBusy(false) }
  }
  useEffect(() => {
    void load()
    const requests = generation
    return () => { requests.current++ }
    // The shared file is read on every open, regardless of the active project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function update(key: GuidanceKey | 'branch', value: string | BranchGuidanceSettings) {
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
  const managedCommit = data && data.settings.commit !== 'custom' && !data.branch.custom && data.branch.value.strategy !== 'inherit' && data.branch.value.workflow !== 'manual'
  const guidanceField = (key: GuidanceKey) => data && <GuidanceRow key={key} label={text[key]} hint={key === 'commit' && (managedCommit ? managedCommitCopy[locale] : data.settings.commit === 'custom' ? text.customHint : undefined)}>
    <SelectField compact portalContainer={panel} label={text[key]} value={data.settings[key]} disabled={busy || !!error || (key === 'commit' && !!managedCommit)} onChange={value => void update(key, value)}
      options={[
        ...(data.settings[key] === 'custom' ? [{ value: 'custom', label: text.custom, disabled: true }] : []),
        ...Object.keys(guidanceOptions[key]).map(value => ({ value, label: labels[value] })),
      ]} />
  </GuidanceRow>
  return <DialogFrame labelledBy={titleId} onClose={close} busy={saving} size="settings" className="flex flex-col text-ink">
    <div ref={setPanel} data-cmd-overlay className="flex min-h-0 flex-1 flex-col">
      <HoverTipLayer className="contents" portalTarget={panel}>
        <header className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
          <h2 id={titleId} className="flex-1 text-sm font-semibold">{text.title}</h2>
          <button ref={closeButton} type="button" className={`${button} w-8 px-0 pointer-coarse:w-11`} aria-label={text.close} data-tip={text.close} aria-disabled={saving} onClick={close}><Xmark width={18} height={18} aria-hidden /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-busy={busy}>
          <p className="mb-3 text-xs leading-5 text-ink-secondary">{text.scope}</p>
          {data && <section role="group" aria-label={generalCopy[locale]}>
            <h3 className="mb-1 text-xs font-semibold">{generalCopy[locale]}</h3>
            {(Object.keys(guidanceOptions) as GuidanceKey[]).filter(key => key !== 'commit').map(guidanceField)}
          </section>}
          {data && Object.entries(data.settings).some(([key, value]) => key !== 'commit' && value === 'custom') && <p className="mt-1 text-xs leading-4 text-ink-secondary">{text.customHint}</p>}
          {data && <section role="group" aria-label="Git" className="mt-3 border-t border-edge pt-3">
            <h3 className="mb-1 text-xs font-semibold">Git</h3>
            <BranchGuidanceFields key={reloadVersion} branch={data.branch} disabled={busy || !!error} portalContainer={panel} onSave={value => void update('branch', value)} commitField={guidanceField('commit')} />
          </section>}
          {error && <p role="alert" className="mt-2 select-text text-sm text-danger">{error}</p>}
        </div>
        <footer className="flex shrink-0 items-center gap-2 border-t border-edge px-3 py-1.5">
          <button type="button" className={button} disabled={busy || !data} onClick={() => { if (data) { onClose(); onOpenFile(data.path) } }}><PageEdit width={16} height={16} aria-hidden />{text.file}</button>
          <p role="status" className="min-w-0 flex-1 text-right text-xs text-ink-secondary">{busy ? saving ? text.saving : text.loading : notice}</p>
          <button type="button" className={`${button} w-8 px-0 pointer-coarse:w-11`} aria-label={text.reload} data-tip={text.reload} disabled={busy} onClick={() => void load()}><RefreshDouble width={16} height={16} aria-hidden /></button>
        </footer>
      </HoverTipLayer>
    </div>
  </DialogFrame>
}
