export type Settings = { distro: string; installPath: string; workspace: string; port: number; ownerEmail: string }
export const defaultSettings: Settings = { distro: 'Mew', installPath: '/home/mew/apps/mew', workspace: '/home/mew/workspace', port: 5000, ownerEmail: '' }
export type Snapshot = {
  system: { platform: string; supported: boolean; os: string; build: string; architecture: string; virtualization: boolean; wslInstalled: boolean; wslVersion: string; distroInstalled: boolean; distroVersion: number; distroRunning: boolean; managed: boolean; distributions: { name: string; version: number }[]; rebootRequired: boolean }
  settings: Settings
  linux: null | { installed: boolean; built: boolean; running: boolean; port: number; workspace: string; commit: string; branch: string; dirty: boolean; tools: Record<string, string>; paths: Record<string, string> }
  httpOk: boolean
  checkedAt: number
  lastOperation?: null | { action: string; status: string; time: number; updateFailed?: boolean }
}
export type Update = { ahead: number; behind: number; latest: string; commits: string[] }
export type Log = { time: number; kind: string; text: string }
export type Credential = { email: string; password: string }
export type Action = 'inspect' | 'install' | 'start' | 'stop' | 'restart' | 'check-update' | 'update' | 'update-wsl' | 'desktop-setup'
export type Page = 'overview' | 'environment' | 'updates' | 'logs' | 'settings'
export function stateOf(snapshot: Snapshot | null) {
  if (!snapshot) return { label: '상태 확인 중', tone: 'neutral', title: '작업 공간을\n준비하고 있어요.', action: null }
  if (snapshot.system.rebootRequired) return { label: '재부팅 필요', tone: 'warning', title: '한 번만 재부팅하면,\n이어서 설치할 수 있어요.', action: null }
  if (!snapshot.system.supported || !snapshot.system.virtualization || (snapshot.system.distroInstalled && (!snapshot.system.managed || snapshot.system.distroVersion !== 2))) return { label: '환경 확인 필요', tone: 'warning', title: 'Windows 환경을\n먼저 확인해 주세요.', action: null }
  if (!snapshot.linux?.installed || !snapshot.linux.built) return { label: '설치 준비', tone: 'accent', title: '나의 작업 공간,\nWindows에서도 mew.', action: 'install' as Action }
  if (snapshot.linux.running && snapshot.httpOk) return { label: '실행 중', tone: 'success', title: '작업 공간이\n준비됐어요.', action: 'open' as const }
  if (snapshot.linux.running) return { label: '접속 확인 필요', tone: 'warning', title: '서버는 실행 중이에요.\n연결을 확인해 주세요.', action: 'restart' as Action }
  return { label: '서버 중지됨', tone: 'neutral', title: '다시 시작하면,\n바로 이어서 작업해요.', action: 'start' as Action }
}
export function canUpdate(snapshot: Snapshot | null, update: Update | null) { return Boolean(snapshot?.system.managed && snapshot.linux?.installed && snapshot.linux.branch === 'main' && update && update.behind > 0 && update.ahead === 0 && !snapshot.linux.dirty) }
export function canRetryUpdate(snapshot: Snapshot | null) { return Boolean(snapshot?.system.managed && snapshot.linux?.installed && snapshot.linux.branch === 'main' && !snapshot.linux.dirty && (snapshot.lastOperation?.updateFailed || (snapshot.lastOperation?.action === 'update' && snapshot.lastOperation.status === 'failed'))) }
export const stages = ['wsl', 'ubuntu', 'packages', 'node', 'clone', 'build', 'account', 'health'] as const
export const stageNames: Record<string, string> = { wsl: 'WSL 준비', ubuntu: 'Ubuntu 다운로드·등록', packages: 'Linux 도구 준비', 'packages-ready': 'Linux 도구 준비 완료', node: 'Node.js 준비', clone: 'mew 내려받기', build: '의존성 설치·빌드', account: '관리자 계정 준비', health: '서버 접속 확인', reboot: '재부팅 후 이어서 진행', start: '서버 시작', stop: '서버 중지', restart: '서버 재시작', update: 'mew 업데이트', 'check-update': '업데이트 확인', 'desktop-setup': '원격 데스크톱 준비' }
