/** 저장(24px) + 첨부·예약·전송(24+6+24+6+32px) + 컨테이너 상하 여백(16px). */
export const MIN_AGENT_INPUT_HEIGHT = 24 + 24 + 6 + 24 + 6 + 32 + 16

/** 입력칸을 끝까지 키워도 대화가 사라지지 않게 남겨 두는 최소 높이. */
export const MIN_AGENT_CONVERSATION_HEIGHT = 48

/**
 * 입력칸 밖에서 이미 차지한 영역을 뺀 실제 가용 높이만 입력칸에 준다.
 * fixedContentHeight에는 세션 도구줄과 대기·예약 메시지 영역이 들어간다.
 */
export function agentInputMaxHeight(
  panelHeight: number,
  viewportBottomInset = 0,
  fixedContentHeight = 32,
) {
  const available = panelHeight
    - viewportBottomInset
    - fixedContentHeight
    - MIN_AGENT_CONVERSATION_HEIGHT
  return Math.max(MIN_AGENT_INPUT_HEIGHT, Math.floor(available))
}
