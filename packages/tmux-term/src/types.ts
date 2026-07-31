export interface TmuxSession {
  name: string
  createdAt: number
  attached: boolean
  windows: number
}

/** 호스트 앱이 주입하는 서버 연동 — 패널은 fetch 경로·인증을 모른다 */
export interface TmuxPanelApi {
  fetchSessions: () => Promise<TmuxSession[]>
  createSession: (name: string) => Promise<unknown>
  killSession: (name: string) => Promise<unknown>
  renameSession: (name: string, newName: string) => Promise<unknown>
}
