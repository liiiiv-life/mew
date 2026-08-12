const ROUTER_ID = 'router'

/**
 * 입력줄에서 맨 앞의 `@셋이름`을 떼어 낸다 — 붙어 있으면 라우터를 건너뛰고 그 셋이 바로 받는다.
 *
 * 이름에 공백이 있을 수 있어 정규식으로 끊지 않고 **목록과 맞춰 보고** 자른다
 * (`@문서 정리`가 '문서'로 잘리면 엉뚱한 셋에 가거나 지목 자체가 무시된다).
 */
export function parseAssignment(
  text: string,
  sets: { id: string; name: string }[],
): { setId: string | null; text: string } {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('@')) return { setId: null, text: text.trim() }
  // 긴 이름부터 본다 — '문서'와 '문서 정리'가 같이 있으면 긴 쪽이 맞다
  const candidates = [...sets].filter((s) => s.id !== ROUTER_ID).sort((a, b) => b.name.length - a.name.length)
  for (const set of candidates) {
    const token = `@${set.name}`
    if (trimmed.startsWith(token)) return { setId: set.id, text: trimmed.slice(token.length).trim() }
  }
  return { setId: null, text: text.trim() }
}
