// App이 직접 소유하는 보조 패널의 닫기 등록표.
//
// 모달·팝업은 각 컴포넌트가 useOverlayDismiss를 부르지만, 보조 패널은 열린 상태가 App에 모여 있다.
// 빠뜨린 패널이 Esc·모바일 뒤로가기에서 이탈하지 않도록 이 훅 한 곳에서 전부 등록한다.
import { useEffect, useRef, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import type { MobileForeground, WorkspacePanelId } from '../utils/mobile-panel-stack'

interface PanelDismissal {
  open: boolean
  close: () => void
  /** 패널 안의 검색 등에서 Esc를 먼저 쓸 때 false를 돌려 패널을 유지한다 */
  closeOnEscape?: (event: KeyboardEvent) => boolean
  closeOnBack?: () => boolean
}

export type WorkspacePanelDismissals = Record<WorkspacePanelId, PanelDismissal>

const BUBBLE = { escapePhase: 'bubble' as const }

export function useWorkspacePanelDismissals(
  panels: WorkspacePanelDismissals,
  foreground: WorkspacePanelId | null,
  navigation?: {
    enabled: boolean
    scope: string
    show: (panel: MobileForeground) => void
  },
): void {
  // 패널마다 별도 오버레이를 등록하지 않는다. 화면 z-index와 같은 foreground 하나만 등록해야
  // Esc·모바일 뒤로가기도 사용자가 실제로 보고 있는 창부터 닫힌다. 새 패널은 공통 ID와 등록표에
  // 추가하는 것만으로 이 경로에 자동 합류한다.
  const current: MobileForeground = foreground ?? 'editor'
  const previous = useRef({ scope: navigation?.scope, current })
  const [history, setHistory] = useState<MobileForeground[]>([])
  useEffect(() => {
    const last = previous.current
    previous.current = { scope: navigation?.scope, current }
    if (!navigation?.enabled || last.scope !== navigation.scope) {
      setHistory((entries) => entries.length ? [] : entries)
    } else if (last.current !== current) {
      setHistory((entries) => [...entries, last.current].slice(-20))
    }
  }, [current, navigation?.enabled, navigation?.scope])

  const panel = foreground ? panels[foreground] : null
  const canGoBack = !!navigation?.enabled && history.length > 0
  const onBack = () => {
    if (panel?.closeOnBack?.() === false) return false
    if (!canGoBack) return true
    const target = history.at(-1)!
    // Restoring a panel consumes history; it must not append the panel we left.
    previous.current = { scope: navigation?.scope, current: target }
    setHistory((entries) => entries.slice(0, -1))
    navigation!.show(target)
    return false
  }
  useOverlayDismiss(panel?.open ? panel.close : canGoBack ? () => {} : false, {
    ...BUBBLE,
    closeOnEscape: panel?.closeOnEscape ?? (() => !!panel?.open),
    closeOnBack: onBack,
  })
}
