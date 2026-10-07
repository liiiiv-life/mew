import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
// 모바일 소프트 키보드 잠금 — 켜 두면 터미널이나 입력칸을 눌러도 키보드가 올라오지 않는다.
// 출력을 읽거나 명령어 버튼만 누를 때 화면 절반을 키보드가 먹지 않게 하는 장치다.
//
// 기기 설정에 가까우므로 세션이 아니라 브라우저 하나에 하나만 둔다(초안 drafts와 달리 세션별이 아니다).
// 터미널 탭을 옮기면 TmuxTerminal이 key={session}으로 새로 마운트되므로, state로만 들고 있으면
// 탭을 옮길 때마다 풀린다 — 그래서 localStorage에 남긴다.
const LOCK_KEY = 'mew:tmux-keyboard-lock'

export function readKeyboardLock(): boolean {
  try {
    return scopedBrowserStorage().getItem(LOCK_KEY) === '1'
  } catch {
    return false
  }
}

export function writeKeyboardLock(locked: boolean): void {
  try {
    if (locked) scopedBrowserStorage().setItem(LOCK_KEY, '1')
    else scopedBrowserStorage().removeItem(LOCK_KEY)
  } catch {
    // 사파리 프라이빗 모드 등 저장 실패는 무시 — 이번 화면에서만 유지된다
  }
}
