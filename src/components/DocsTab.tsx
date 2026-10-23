import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
// docs 탭 — 프로젝트 탭 줄 맨 왼쪽에 **하나만** 서는 고정 탭.
//
// docs는 프로젝트가 아니라 워크스페이스에 하나뿐인 특별 레포다(server/paths.ts). 그래서
// 프로젝트 목록(/api/projects)에 없고, 끌 수도 순서를 바꿀 수도 이름을 붙일 수도 없으며
// 프로젝트 격자 팝업에도 나오지 않는다. 아이콘은 정해진 것 하나(i:notes)를 그대로 쓴다.
//
// - 누르면: docs를 연다
// - 우클릭(모바일에선 꾹): 설정 창 — 폴더 가져오기/내보내기 (owner 전용)
import { ProjectIcon } from './ProjectIcon'
import { useLongPress } from '../hooks/useLongPress'

/** docs 탭 아이콘은 사용자가 바꿀 수 없다 — 옮기기 전 프로젝트 아이콘과 같은 것을 그대로 쓴다 */
const DOCS_ICON = 'i:notes'

export function DocsTab({
  active,
  canManage,
  onActivate,
  onOpenSettings,
}: {
  active: boolean
  /** 가져오기·내보내기는 owner 전용 — 아니면 꾹 눌러도 아무 일도 없다 */
  canManage: boolean
  onActivate: () => void
  onOpenSettings: () => void
}) {
  useUiLocale()
  const { pressProps, consumeClick } = useLongPress(() => {
    if (canManage) onOpenSettings()
  })

  return (
    <button
      type="button"
      {...pressProps}
      onClick={() => {
        // 꾹 눌러 설정 창을 연 뒤 손을 떼면 뒤따라 오는 click 한 번은 흘린다
        if (consumeClick()) return
        onActivate()
      }}
      className={`flex h-full shrink-0 select-none items-center border-r border-edge px-2.5 [-webkit-touch-callout:none] ${
        active ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
      }`}
      style={{ touchAction: 'manipulation' }}
      title={canManage ? uiText("docs — 꾹 누르거나 우클릭하면 가져오기/내보내기") : 'docs'}
    >
      <span className="flex h-5 w-5 items-center justify-center">
        <ProjectIcon icon={DOCS_ICON} size={17} />
      </span>
    </button>
  )
}
