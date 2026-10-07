// App이 직접 소유하는 보조 패널의 닫기 등록표.
//
// 모달·팝업은 각 컴포넌트가 useOverlayDismiss를 부르지만, 보조 패널은 열린 상태가 App에 모여 있다.
// 빠뜨린 패널이 모바일 뒤로가기에서 이탈하지 않도록 이 훅 한 곳에서 전부 등록한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import type { MobileForeground, WorkspacePanelId } from '../utils/mobile-panel-stack'

interface PanelDismissal {
  open: boolean
  close: () => void
  /** 패널은 유지하면서 검색 취소 등 콘텐츠의 Esc 동작만 처리한다 */
  onEscape?: (event: KeyboardEvent) => void
  closeOnBack?: () => boolean
}

export type WorkspacePanelDismissals = Record<WorkspacePanelId, PanelDismissal>

/** A panel supplies a stable route key and restores its own lightweight screen state. */
export interface WorkspaceNavigationScreen {
  key: string
  restore: () => void
}

interface NavigationEntry {
  panel: MobileForeground
  screen?: WorkspaceNavigationScreen
}

const BUBBLE = { escapePhase: 'bubble' as const }

export function useWorkspacePanelDismissals(
  panels: WorkspacePanelDismissals,
  foreground: WorkspacePanelId | null,
  navigation?: {
    enabled: boolean
    scope: string
    show: (panel: MobileForeground) => void
    screens?: Partial<Record<MobileForeground, WorkspaceNavigationScreen>>
  },
): () => boolean {
  // 패널마다 별도 오버레이를 등록하지 않는다. 화면 z-index와 같은 foreground 하나만 등록해야
  // 모바일 뒤로가기도 사용자가 실제로 보고 있는 창부터 닫힌다. 새 패널은 공통 ID와 등록표에
  // 추가하는 것만으로 이 경로에 자동 합류한다.
  const currentPanel = foreground ?? 'editor'
  const screen = navigation?.screens?.[currentPanel]
  const current = useMemo<NavigationEntry>(() => ({ panel: currentPanel, screen }), [currentPanel, screen])
  const previous = useRef({ scope: navigation?.scope, current })
  const historyRef = useRef<NavigationEntry[]>([])
  const closingFromBack = useRef(false)
  const [history, setHistory] = useState<NavigationEntry[]>([])
  useEffect(() => {
    const last = previous.current
    previous.current = { scope: navigation?.scope, current }
    if (!navigation?.enabled || last.scope !== navigation.scope) {
      closingFromBack.current = false
      historyRef.current = []
      setHistory((entries) => entries.length ? [] : entries)
    } else if (last.current.panel !== current.panel || last.current.screen?.key !== current.screen?.key) {
      if (closingFromBack.current) {
        closingFromBack.current = false
        return
      }
      historyRef.current = [...historyRef.current, last.current].slice(-20)
      setHistory(historyRef.current)
    }
  }, [current, navigation?.enabled, navigation?.scope])

  const goBack = () => {
    if (!navigation?.enabled || previous.current.scope !== navigation.scope) return false
    const target = historyRef.current.at(-1)
    if (!target) return false
    // Restore both parts in one React update; restoring must not create another visit.
    previous.current = { scope: navigation.scope, current: target }
    historyRef.current = historyRef.current.slice(0, -1)
    setHistory(historyRef.current)
    target.screen?.restore()
    navigation.show(target.panel)
    return true
  }

  const panel = foreground ? panels[foreground] : null
  const canGoBack = !!navigation?.enabled && history.length > 0
  const onBack = () => {
    if (panel?.closeOnBack?.() === false) return false
    if (goBack()) return false
    closingFromBack.current = !!panel?.open
    return true
  }
  useOverlayDismiss(panel?.open ? panel.close : canGoBack ? () => {} : false, {
    ...BUBBLE,
    closeOnEscape: event => {
      if (!event.defaultPrevented && !event.isComposing) panel?.onEscape?.(event)
      return false
    },
    closeOnBack: onBack,
  })
  return goBack
}
