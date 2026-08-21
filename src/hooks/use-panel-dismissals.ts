// App이 직접 소유하는 보조 패널의 닫기 등록표.
//
// 모달·팝업은 각 컴포넌트가 useOverlayDismiss를 부르지만, 보조 패널은 열린 상태가 App에 모여 있다.
// 빠뜨린 패널이 Esc·모바일 뒤로가기에서 이탈하지 않도록 이 훅 한 곳에서 전부 등록한다.
import { useOverlayDismiss } from '@mew/ui'

interface PanelDismissal {
  open: boolean
  close: () => void
  /** 패널 안의 검색 등에서 Esc를 먼저 쓸 때 false를 돌려 패널을 유지한다 */
  closeOnEscape?: (event: KeyboardEvent) => boolean
}

interface TerminalDismissal extends PanelDismissal {
  /** 터미널 안의 vim 등이 Esc를 쓸 때는 패널을 닫지 않는다. 뒤로가기는 언제나 닫는다. */
  closeOnEscape: (event: KeyboardEvent) => boolean
}

export interface WorkspacePanelDismissals {
  sidebar: PanelDismissal
  chat: PanelDismissal
  agent: PanelDismissal
  agentSet: PanelDismissal
  terminal: TerminalDismissal
  browser: PanelDismissal
  android: PanelDismissal
}

const BUBBLE = { escapePhase: 'bubble' as const }

export function useWorkspacePanelDismissals(panels: WorkspacePanelDismissals): void {
  // 호출 순서는 모바일 DOM의 쌓임 순서와 같다. 처음부터 여러 패널이 복원돼도 마지막 패널이 맨 위다.
  // 이후에는 새로 열린 패널 하나만 스택 뒤에 추가되므로 실제로 마지막에 연 창이 우선한다.
  useOverlayDismiss(panels.sidebar.open && panels.sidebar.close, {
    ...BUBBLE,
    closeOnEscape: panels.sidebar.closeOnEscape,
  })
  useOverlayDismiss(panels.chat.open && panels.chat.close, BUBBLE)
  useOverlayDismiss(panels.agent.open && panels.agent.close, BUBBLE)
  useOverlayDismiss(panels.agentSet.open && panels.agentSet.close, BUBBLE)
  useOverlayDismiss(panels.terminal.open && panels.terminal.close, {
    ...BUBBLE,
    closeOnEscape: panels.terminal.closeOnEscape,
  })
  useOverlayDismiss(panels.browser.open && panels.browser.close, BUBBLE)
  useOverlayDismiss(panels.android.open && panels.android.close, BUBBLE)
}
