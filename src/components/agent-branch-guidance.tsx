import { useId, useState, type ReactNode } from 'react'
import { SelectField } from '@mew/ui'
import { useI18n } from '../i18n'
import { branchGuidanceValidationError, defaultBranchGuidance, BRANCH_NAME_MAX_LENGTH, BRANCH_PREFIX_MAX_LENGTH, type BranchGuidanceSettings, type BranchGuidanceSnapshot } from '../../shared/branch-guidance'
import { GuidanceRow } from './agent-guidance-row'

const copy = {
  ko: {
    workflow: 'Git 자동 처리', manual: '기존 커밋 설정 사용', local: '로컬 병합까지 자동 (권장)', remote: '원격 반영까지 자동',
    manualHint: '커밋 방식 설정을 따르고 병합·push는 요청할 때 수행합니다.',
    localHint: '작업 커밋·검증·로컬 병합까지 맡깁니다. 원격 push는 요청할 때 수행합니다.',
    remoteHint: '작업 커밋·검증·병합과 기존 원격 저장소 반영까지 맡깁니다.',
    cleanupAuto: '정리를 켜면 통합을 확인한 작업 브랜치와 임시 worktree도 정리합니다.',
    strategy: '브랜치 전략', github: 'GitHub Flow (권장)', gitflow: 'Git Flow', trunk: 'Trunk 기반', inherit: '프로젝트 지침에 따름', custom: '직접 편집한 지침',
    githubHint: '작업별 짧은 브랜치를 만들고 검증·검토 후 기본 브랜치에 통합합니다.', gitflowHint: '기능은 개발 브랜치에서, 긴급 수정은 기본 브랜치에서 분기합니다. 버전별 릴리스 관리에 적합합니다.', trunkHint: '작업을 작게 나누어 1~2일 안에 기본 브랜치로 통합하는 흐름입니다.',
    customHint: '전략을 선택해 저장하면 직접 편집한 브랜치 지침을 바꿉니다.', details: '브랜치 세부 설정', base: '기본 브랜치', auto: '자동 감지', development: '개발 브랜치', prefix: '작업 브랜치 접두사', folder: '작업 폴더', autoWorktree: '필요할 때 worktree', alwaysWorktree: '항상 worktree', neverWorktree: '현재 폴더', merge: '병합 방식', cleanup: '통합 후 로컬 브랜치 정리', keep: '병합과 정리는 승인된 경우에만 수행합니다. 커밋 방식은 위 설정을 따릅니다.', save: 'Git 설정 저장', invalid: '브랜치 이름이나 접두사를 확인하세요. 공백·명령문 없이 Git에서 쓸 수 있는 이름을 입력하세요.',
  },
  en: {
    workflow: 'Git automation', manual: 'Use existing commit setting', local: 'Automate through local merge (recommended)', remote: 'Automate through remote sync',
    manualHint: 'Commits follow the commit setting. Merge and push only when requested.',
    localHint: 'Delegate task commits, checks and local integration. Push only when requested.',
    remoteHint: 'Delegate task commits, checks, integration and synchronization with the configured remote.',
    cleanupAuto: 'Enabling cleanup also removes verified integrated task branches and temporary worktrees.',
    strategy: 'Branch strategy', github: 'GitHub Flow (recommended)', gitflow: 'Git Flow', trunk: 'Trunk-based', inherit: 'Follow project instructions', custom: 'Custom instructions',
    githubHint: 'Use a short-lived branch per task, then integrate after checks and review.', gitflowHint: 'Branch features from development and hotfixes from the default branch. Suits versioned releases.', trunkHint: 'Keep tasks small and integrate into the default branch within one or two days.',
    customHint: 'Selecting and saving a strategy replaces the custom branch instructions.', details: 'Branch details', base: 'Default branch', auto: 'Detect automatically', development: 'Development branch', prefix: 'Task branch prefix', folder: 'Working directory', autoWorktree: 'Worktree when needed', alwaysWorktree: 'Always use a worktree', neverWorktree: 'Current directory', merge: 'Merge method', cleanup: 'Clean up local branch after integration', keep: 'Merging and cleanup require authorization. Commits follow the setting above.', save: 'Save Git settings', invalid: 'Check the branch names and prefix. Use valid Git names without spaces or commands.',
  },
  ja: {
    workflow: 'Gitの自動処理', manual: '既存のコミット設定を使用', local: 'ローカル統合まで自動（推奨）', remote: 'リモート反映まで自動',
    manualHint: 'コミット方法の設定に従い、マージとpushは依頼時に行います。',
    localHint: '作業コミット・検証・ローカル統合まで任せます。pushは依頼時に行います。',
    remoteHint: '作業コミット・検証・統合と設定済みリモートへの反映まで任せます。',
    cleanupAuto: '整理を有効にすると、統合を確認した作業ブランチと一時worktreeも整理します。',
    strategy: 'ブランチ戦略', github: 'GitHub Flow（推奨）', gitflow: 'Git Flow', trunk: 'トランクベース', inherit: 'プロジェクトの指針に従う', custom: '直接編集した指針',
    githubHint: '作業ごとに短命のブランチを作成し、検証・レビュー後に既定のブランチへ統合します。', gitflowHint: '機能は開発ブランチ、緊急修正は既定のブランチから分岐します。バージョン別のリリース管理に適しています。', trunkHint: '作業を小さく分け、1〜2日以内に既定のブランチへ統合する運用です。',
    customHint: '戦略を選んで保存すると、直接編集したブランチ指針が置き換わります。', details: 'ブランチの詳細設定', base: '既定のブランチ', auto: '自動検出', development: '開発ブランチ', prefix: '作業ブランチの接頭辞', folder: '作業フォルダー', autoWorktree: '必要に応じてworktree', alwaysWorktree: '常にworktree', neverWorktree: '現在のフォルダー', merge: 'マージ方法', cleanup: '統合後にローカルブランチを整理', keep: 'マージと整理には承認が必要です。コミットは上記の設定に従います。', save: 'Git設定を保存', invalid: 'ブランチ名と接頭辞を確認してください。空白やコマンドを含まない有効なGit名を入力してください。',
  },
  'zh-CN': {
    workflow: 'Git 自动处理', manual: '使用现有提交设置', local: '自动完成本地合并（推荐）', remote: '自动完成远程同步',
    manualHint: '提交遵循提交方式设置，合并和push仅在请求时进行。',
    localHint: '委托任务提交、验证和本地合并，仅在请求时push。',
    remoteHint: '委托任务提交、验证、合并及向已配置远程仓库同步。',
    cleanupAuto: '启用清理后，还会删除确认已合入的任务分支和临时worktree。',
    strategy: '分支策略', github: 'GitHub Flow（推荐）', gitflow: 'Git Flow', trunk: '主干开发', inherit: '遵循项目指引', custom: '自定义指引',
    githubHint: '为每项任务创建短期分支，验证和评审后合入默认分支。', gitflowHint: '功能从开发分支创建，紧急修复从默认分支创建。适用于按版本管理发布。', trunkHint: '将任务拆小，在一到两天内合入默认分支。',
    customHint: '选择并保存策略将替换自定义分支指引。', details: '分支详细设置', base: '默认分支', auto: '自动检测', development: '开发分支', prefix: '任务分支前缀', folder: '工作目录', autoWorktree: '需要时使用worktree', alwaysWorktree: '始终使用worktree', neverWorktree: '当前目录', merge: '合并方式', cleanup: '合入后清理本地分支', keep: '合并和清理须经授权。提交遵循上方设置。', save: '保存 Git 设置', invalid: '请检查分支名称和前缀，输入不含空格或命令的有效Git名称。',
  },
}
const inputClass = 'min-h-8 w-full min-w-0 rounded border border-edge-strong bg-surface px-2.5 text-xs text-ink placeholder:text-ink-secondary focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60 pointer-coarse:min-h-11'

export function BranchGuidanceFields({ branch, disabled, onSave, commitField, portalContainer }: { branch: BranchGuidanceSnapshot; disabled: boolean; onSave: (value: BranchGuidanceSettings) => void; commitField?: ReactNode; portalContainer?: HTMLElement | null }) {
  const { locale } = useI18n(), text = copy[locale]
  const fieldId = useId()
  const [draft, setDraft] = useState(branch.value)
  const [custom, setCustom] = useState(branch.custom)
  const [invalid, setInvalid] = useState(false)
  const saved = JSON.stringify(branch)
  const [baseline, setBaseline] = useState(saved)
  if (baseline !== saved) {
    setBaseline(saved)
    setDraft(branch.value); setCustom(branch.custom); setInvalid(false)
  }
  const change = (value: Partial<BranchGuidanceSettings>) => { setDraft(current => ({ ...current, ...value })); setInvalid(false) }
  const dirty = !custom && (branch.custom || JSON.stringify(draft) !== JSON.stringify(branch.value))
  const enabled = !custom && draft.strategy !== 'inherit'
  const saveButton = <button type="submit" disabled={disabled || !dirty} className="min-h-8 rounded border border-edge-strong px-2.5 text-xs text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 pointer-coarse:min-h-11">{text.save}</button>
  return <form onSubmit={event => {
    event.preventDefault()
    if (disabled || !dirty) return
    if (branchGuidanceValidationError(draft)) { setInvalid(true); return }
    onSave(draft)
  }}>
    <GuidanceRow label={text.strategy} hint={custom ? text.customHint : undefined}>
      <SelectField compact portalContainer={portalContainer} label={text.strategy} value={custom ? 'custom' : draft.strategy} disabled={disabled} onChange={strategy => {
        const valid = custom ? defaultBranchGuidance : branchGuidanceValidationError(draft) ? branch.value : draft
        setDraft({ ...valid, strategy: strategy as BranchGuidanceSettings['strategy'] })
        setCustom(false); setInvalid(false)
      }} options={[
        ...(custom ? [{ value: 'custom', label: text.custom, disabled: true }] : []),
        { value: 'github-flow', label: text.github }, { value: 'git-flow', label: text.gitflow }, { value: 'trunk', label: text.trunk }, { value: 'inherit', label: text.inherit },
      ]} />
    </GuidanceRow>
    {!enabled && commitField}
    {enabled && <>
      <GuidanceRow label={text.workflow} hint={draft.workflow === 'manual' ? text.manualHint : draft.workflow === 'local' ? text.localHint : text.remoteHint}>
        <SelectField compact portalContainer={portalContainer} label={text.workflow} value={draft.workflow} disabled={disabled} onChange={workflow => change({ workflow: workflow as BranchGuidanceSettings['workflow'] })}
          options={[{ value: 'manual', label: text.manual }, { value: 'local', label: text.local }, { value: 'remote', label: text.remote }]} />
      </GuidanceRow>
      {commitField}
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2">
        <details className="col-span-2 col-start-1 row-start-1">
          <summary tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined} onClick={event => { if (disabled) event.preventDefault() }} className="mr-32 min-h-8 cursor-pointer content-center rounded text-xs text-ink-secondary hover:text-ink focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11">{text.details}</summary>
          <div className="pb-1 pt-1">
            <p className="mb-2 text-xs leading-4 text-ink-secondary">{draft.strategy === 'git-flow' ? text.gitflowHint : draft.strategy === 'trunk' ? text.trunkHint : text.githubHint}</p>
            <GuidanceRow label={text.base} inputId={`${fieldId}-base`}><input id={`${fieldId}-base`} className={inputClass} value={draft.baseBranch} placeholder={text.auto} disabled={disabled} maxLength={BRANCH_NAME_MAX_LENGTH} autoComplete="off" spellCheck={false} onChange={event => change({ baseBranch: event.target.value })} /></GuidanceRow>
            {draft.strategy === 'git-flow' && <GuidanceRow label={text.development} inputId={`${fieldId}-development`}><input id={`${fieldId}-development`} className={inputClass} value={draft.developmentBranch} disabled={disabled} maxLength={BRANCH_NAME_MAX_LENGTH} autoComplete="off" spellCheck={false} onChange={event => change({ developmentBranch: event.target.value })} /></GuidanceRow>}
            <GuidanceRow label={text.prefix} inputId={`${fieldId}-prefix`}><input id={`${fieldId}-prefix`} className={inputClass} value={draft.branchPrefix} disabled={disabled} maxLength={BRANCH_PREFIX_MAX_LENGTH} autoComplete="off" spellCheck={false} onChange={event => change({ branchPrefix: event.target.value })} /></GuidanceRow>
            <GuidanceRow label={text.folder}><SelectField compact portalContainer={portalContainer} label={text.folder} value={draft.worktree} disabled={disabled} onChange={worktree => change({ worktree: worktree as BranchGuidanceSettings['worktree'] })} options={[{ value: 'auto', label: text.autoWorktree }, { value: 'always', label: text.alwaysWorktree }, { value: 'never', label: text.neverWorktree }]} /></GuidanceRow>
            <GuidanceRow label={text.merge}><SelectField compact portalContainer={portalContainer} label={text.merge} value={draft.mergeMethod} disabled={disabled} onChange={mergeMethod => change({ mergeMethod: mergeMethod as BranchGuidanceSettings['mergeMethod'] })} options={[{ value: 'squash', label: 'Squash' }, { value: 'merge', label: 'Merge commit' }, { value: 'rebase', label: 'Rebase' }]} /></GuidanceRow>
            <GuidanceRow label={text.cleanup} inputId={`${fieldId}-cleanup`} hint={draft.workflow === 'manual' ? text.keep : text.cleanupAuto}>
              <label htmlFor={`${fieldId}-cleanup`} className="flex min-h-8 cursor-pointer items-center pointer-coarse:min-h-11"><input id={`${fieldId}-cleanup`} type="checkbox" aria-label={text.cleanup} className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-2 focus-visible:outline-accent" checked={draft.cleanup} disabled={disabled} onChange={event => change({ cleanup: event.target.checked })} /></label>
            </GuidanceRow>
          </div>
        </details>
        <div className="col-start-2 row-start-1">{saveButton}</div>
      </div>
    </>}
    {invalid && <p role="alert" className="text-sm text-danger">{text.invalid}</p>}
    {!enabled && <div className="mt-1 flex justify-end">{saveButton}</div>}
  </form>
}
