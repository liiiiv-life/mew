// 홈 탭 — 탭 줄 **맨 왼쪽**, docs 탭보다도 앞에 서는 고정 탭.
//
// 홈은 프로젝트가 아니다. 프로젝트 하나를 보는 화면이 아니라 워크스페이스 전체를 보는 화면이라
// (할 일·달력) 프로젝트 목록에도, 격자 팝업에도 나오지 않는다.
//
// - 누르면: 홈 화면을 연다(편집 칸 대신 HomePanel이 뜬다)
// - 우클릭(모바일에선 꾹): 워크스페이스 바꾸기 — owner 전용
import { useLongPress } from '../hooks/useLongPress'
import { useI18n } from '../i18n'

export function HomeTab({
  active,
  canSwitchWorkspace,
  onActivate,
  onOpenSwitcher,
}: {
  active: boolean
  /** 워크스페이스 바꾸기는 owner 전용 — 아니면 꾹 눌러도 아무 일도 없다 */
  canSwitchWorkspace: boolean
  onActivate: () => void
  onOpenSwitcher: () => void
}) {
  const { t } = useI18n()
  const { pressProps, consumeClick } = useLongPress(() => {
    if (canSwitchWorkspace) onOpenSwitcher()
  })

  return (
    <button
      type="button"
      {...pressProps}
      onClick={() => {
        // 꾹 눌러 창을 연 뒤 손을 떼면 뒤따라 오는 click 한 번은 흘린다
        if (consumeClick()) return
        onActivate()
      }}
      className={`flex h-full shrink-0 select-none items-center border-r border-edge px-2.5 [-webkit-touch-callout:none] ${
        active ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
      }`}
      style={{ touchAction: 'manipulation' }}
      title={canSwitchWorkspace ? t('home.switchWorkspaceHint') : t('home.tab')}
      aria-label={t('home.tab')}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 10.5 9-7 9 7V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
      </svg>
    </button>
  )
}
