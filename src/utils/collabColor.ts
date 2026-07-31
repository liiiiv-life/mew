// 협업 커서·presence 점 색상 — 이메일(또는 게스트 이름)마다 고정 색을 배정한다.
const PALETTE = [
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#0ea5e9', // sky
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
]

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function collabColorFor(identity: string): string {
  return PALETTE[hash(identity) % PALETTE.length]
}

const GUEST_NAME_KEY = 'mew:collab-guest-name'

// 로그인 없는 dev·게스트 세션에서도 같은 브라우저의 다른 탭끼리는 별개 참가자로 보여야 커서·presence
// 점 색이 세션마다 다르게 나온다 — 탭(세션)마다 고정되는 임시 이름을 sessionStorage에 둔다
export function guestName(): string {
  let name = sessionStorage.getItem(GUEST_NAME_KEY)
  if (!name) {
    name = `guest-${Math.random().toString(36).slice(2, 6)}`
    sessionStorage.setItem(GUEST_NAME_KEY, name)
  }
  return name
}

// 로그인 이메일이 있으면 이메일로, 없으면 세션 고정 게스트 이름으로 색을 정한다 — useCollab(커서)과
// usePresence(사이드바·탭 점) 둘 다 같은 사람은 항상 같은 색이 나오도록 이 함수 하나로 통일한다.
export function identityColor(authEmail: string | null): string {
  return collabColorFor(authEmail ?? guestName())
}
