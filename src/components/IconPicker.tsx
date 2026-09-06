// 아이콘 고르는 칸 — 프로젝트 아이콘(ProjectPicker)과 터미널 명령어 버튼(TermButtonBar)이 **같은 것**을
// 쓴다. 목록도 표기도 하나다(utils/projectIcons.ts): `i:{키}`(라인 아이콘) · 이모지 문자 · `svg:{마크업}`.
// 그리는 쪽도 하나다(ProjectIcon) — 그래서 두 자리의 아이콘이 언제나 같은 모양·같은 색으로 보인다.
//
// 저장은 부르는 쪽 몫이다: 프로젝트 아이콘은 고르는 즉시 서버로 가고(즉시 반영), 명령어 버튼은
// 편집 창의 저장 버튼까지 기다린다. 그래서 여기서는 값만 올려보내고 오류 표시도 하지 않는다.
import { useState } from 'react'
import { ICON_GROUPS, ICON_PREFIX, iconValue, splitSvgIcon, svgIconValue } from '../utils/projectIcons'
import { ProjectIcon } from './ProjectIcon'
import { useI18n } from '../i18n'

export function IconPicker({
  value,
  disabled = false,
  onChange,
}: {
  /** 지금 값 — 빈 문자열이면 아이콘 없음 */
  value: string
  disabled?: boolean
  /** 고른 값을 넘긴다 — 빈 문자열이면 "없음" */
  onChange: (icon: string) => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  // 이모지·SVG 칸은 지금 값에서 꺼내 시작한다 — 넣어둔 것을 고쳐서 다시 저장할 수 있게
  const [emojiDraft, setEmojiDraft] = useState(() =>
    value && !value.startsWith(ICON_PREFIX) && !splitSvgIcon(value) ? value : '',
  )
  const [svgDraft, setSvgDraft] = useState(() => splitSvgIcon(value)?.markup ?? '')
  const [fileError, setFileError] = useState<string | null>(null)

  // 아이콘이 수백 개라 그냥 늘어놓으면 못 찾는다 — 키(영문)나 그룹 이름으로 걸러 보여준다
  const needle = query.trim().toLowerCase()
  const shownGroups = ICON_GROUPS.map((group) => ({
    label: group.label,
    entries: Object.entries(group.icons).filter(
      ([key]) => !needle || key.includes(needle) || group.label.includes(needle),
    ),
  })).filter((group) => group.entries.length > 0)

  async function handleSvgFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 change가 오도록 비워둔다
    if (!file) return
    setFileError(null)
    try {
      setSvgDraft(await file.text())
    } catch {
      setFileError(t('icon.fileReadFailed'))
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('icon.searchPlaceholder')}
          className="min-w-0 flex-1 rounded border border-edge-strong bg-surface px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
        />
        <button
          type="button"
          onClick={() => onChange('')}
          disabled={disabled}
          className={`shrink-0 rounded border px-2 py-1 text-xs disabled:opacity-40 ${
            value === '' ? 'border-accent bg-surface text-ink' : 'border-edge-strong text-ink-secondary hover:bg-surface-raised'
          }`}
        >
          {t('icon.none')}
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto pr-1">
        {shownGroups.map((group) => (
          <div key={group.label} className="mb-2">
            <div className="mb-1 text-[11px] text-ink-muted">{group.label}</div>
            <div className="grid grid-cols-8 gap-1">
              {group.entries.map(([key, Icon]) => (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(iconValue(key))}
                  className={`flex h-8 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink disabled:opacity-40 ${
                    value === iconValue(key) ? 'bg-surface-raised text-ink ring-1 ring-accent' : ''
                  }`}
                  title={key}
                  aria-label={key}
                >
                  <Icon width={18} height={18} strokeWidth={1.5} />
                </button>
              ))}
            </div>
          </div>
        ))}
        {shownGroups.length === 0 && (
          <div className="py-4 text-center text-[11px] text-ink-muted">{t('icon.noMatches')}</div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={emojiDraft}
          onChange={(e) => setEmojiDraft(e.target.value)}
          placeholder={t('icon.emojiPlaceholder')}
          maxLength={16}
          className="min-w-0 flex-1 rounded border border-edge-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
        />
        <button
          type="button"
          onClick={() => onChange(emojiDraft.trim())}
          disabled={disabled || !emojiDraft.trim()}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
        >
          {t('icon.apply')}
        </button>
      </div>

      {/* 목록에 없는 아이콘(로고 등)은 SVG 코드를 직접 넣는다 — 스크립트·외부 참조가 들어 있으면 서버가 거부한다.
          색은 저장하되 그리지 않는다: 모양만 떠서 다른 아이콘과 같은 테마 색으로 칠한다(ProjectIcon.tsx) */}
      <div className="mt-3 border-t border-edge pt-3">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[11px] text-ink-muted">{t('icon.pasteSvg')}</div>
          <label className="cursor-pointer rounded border border-edge-strong px-2 py-0.5 text-[11px] text-ink-secondary hover:bg-surface-raised">
            {t('icon.chooseFile')}
            <input type="file" accept=".svg,image/svg+xml" className="hidden" onChange={handleSvgFile} />
          </label>
        </div>
        <textarea
          value={svgDraft}
          onChange={(e) => setSvgDraft(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder={t('icon.svgPlaceholder')}
          className="w-full resize-y rounded border border-edge-strong bg-surface px-2 py-1.5 font-mono text-[11px] text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
        />
        <div className="mt-2 flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-edge text-ink">
            {svgDraft.trim().startsWith('<svg') && <ProjectIcon icon={svgIconValue(svgDraft.trim())} size={26} />}
          </span>
          <span className="min-w-0 text-[11px] text-ink-muted">{t('icon.svgColorNote')}</span>
          <button
            type="button"
            onClick={() => onChange(svgIconValue(svgDraft.trim()))}
            disabled={disabled || !svgDraft.trim()}
            className="ml-auto shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
          >
            {t('icon.apply')}
          </button>
        </div>
        {fileError && <div className="mt-1 text-[11px] text-danger">{fileError}</div>}
      </div>
    </div>
  )
}
