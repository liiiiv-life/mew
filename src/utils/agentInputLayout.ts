/** 설정·저장 행(28px) + 첨부·예약·전송(24+6+24+6+32px) + 상하 패딩(16px) + 상단 테두리(1px). */
export const MIN_AGENT_INPUT_HEIGHT = 28 + 24 + 6 + 24 + 6 + 32 + 16 + 1

/** 입력칸을 끝까지 키워도 대화가 사라지지 않게 남겨 두는 최소 높이. */
export const MIN_AGENT_CONVERSATION_HEIGHT = 48

/** 대기·예약 메시지 인라인 편집칸의 세 줄 최소 높이와 과도한 확장 방지 상한. */
export const MIN_AGENT_QUEUE_EDIT_HEIGHT = 64
export const DEFAULT_AGENT_QUEUE_EDIT_HEIGHT = 72
const MAX_AGENT_QUEUE_EDIT_HEIGHT = 360

/** 패널 안에 기본 입력줄과 최소 대화 영역을 남기는 큐 편집칸 상한. */
export function agentQueueEditMaxHeight(panelHeight: number) {
  const available = panelHeight
    - MIN_AGENT_INPUT_HEIGHT
    - MIN_AGENT_CONVERSATION_HEIGHT
    - 48
  return Math.max(MIN_AGENT_QUEUE_EDIT_HEIGHT, Math.min(MAX_AGENT_QUEUE_EDIT_HEIGHT, Math.floor(available)))
}

/** 위쪽 손잡이를 끌 때 위로 간 거리만큼 높이를 늘리고 허용 범위 안으로 고정한다. */
export function resizedHeightFromTop(
  startHeight: number,
  startY: number,
  currentY: number,
  minHeight: number,
  maxHeight: number,
) {
  return Math.min(maxHeight, Math.max(minHeight, startHeight + startY - currentY))
}

/**
 * 입력칸 밖에서 이미 차지한 영역을 뺀 실제 가용 높이만 입력칸에 준다.
 * fixedContentHeight에는 세션 도구줄과 대기·예약 메시지 영역이 들어간다.
 */
export function agentInputMaxHeight(
  panelHeight: number,
  viewportBottomInset = 0,
  fixedContentHeight = 32,
  minInputHeight = MIN_AGENT_INPUT_HEIGHT,
) {
  const available = panelHeight
    - viewportBottomInset
    - fixedContentHeight
    - MIN_AGENT_CONVERSATION_HEIGHT
  return Math.max(minInputHeight, Math.floor(available))
}
