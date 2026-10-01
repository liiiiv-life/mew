/** 모바일에서 작업 영역을 덮는 App 소유 보조창. DOM 순서와 초기 쌓임 순서도 이 목록을 따른다. */
export const WORKSPACE_PANEL_IDS = [
  'sidebar',
  'chat',
  'agent',
  'terminal',
  'browser',
  'git',
  'android',
  'features',
  'memo',
] as const

export type WorkspacePanelId = (typeof WORKSPACE_PANEL_IDS)[number]
/** 에디터는 보조 패널 스택 밖에 있으므로 모바일 전면 상태에 별도 값으로 기록한다. */
export type MobileForeground = WorkspacePanelId | 'editor'

export type MobilePanelSelection<Panel extends string> = {
  open: boolean
  stack: Panel[]
}

/** 이미 열린 패널도 중복 없이 스택 맨 위로 옮긴다. */
export function bringMobilePanelToFront<Panel extends string>(stack: readonly Panel[], target: Panel): Panel[] {
  return [...stack.filter((panel) => panel !== target), target]
}

/** 어느 경로로 닫혀도 다음 패널이 자연스럽게 전면이 되도록 스택에서 제거한다. */
export function closeMobilePanel<Panel extends string>(stack: readonly Panel[], target: Panel): Panel[] {
  return stack.filter((panel) => panel !== target)
}

/** 새로고침 뒤에도 열려 있던 창들 가운데 마지막 전면 창을 다시 맨 위에 둔다. */
export function restoreMobilePanelStack(
  open: Record<WorkspacePanelId, boolean>,
  foreground: MobileForeground | null,
): WorkspacePanelId[] {
  if (foreground === 'editor') return []
  const stack = WORKSPACE_PANEL_IDS.filter((panel) => open[panel])
  return foreground && open[foreground] ? bringMobilePanelToFront(stack, foreground) : stack
}

/**
 * 모바일 보조창 선택 규칙.
 * 닫힌 창은 열어 전면에, 뒤에 열린 창은 닫지 않고 전면에, 전면 창은 다시 선택할 때 닫는다.
 */
export function selectMobilePanel<Panel extends string>(
  stack: readonly Panel[],
  target: Panel,
  targetOpen: boolean,
): MobilePanelSelection<Panel> {
  if (targetOpen && stack.at(-1) === target) {
    return { open: false, stack: closeMobilePanel(stack, target) }
  }
  return { open: true, stack: bringMobilePanelToFront(stack, target) }
}
