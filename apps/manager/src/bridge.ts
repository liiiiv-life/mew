import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { defaultSettings, type Action, type Credential, type Log, type Settings, type Snapshot, type Update } from './model'
export const native = isTauri()
export async function settings(): Promise<Settings> { return native ? invoke('get_settings') : { ...defaultSettings } }
export async function saveSettings(value: Settings): Promise<Settings> {
  if (!native) throw new Error('Windows 앱에서 설정을 저장할 수 있습니다.')
  return invoke('set_settings', { settings: value })
}
export async function run(action: Action): Promise<Snapshot | null> {
  if (!native) return { system: { platform: 'preview', supported: false, os: '브라우저 미리보기', build: '', architecture: '', virtualization: false, wslInstalled: false, wslVersion: '', distroInstalled: false, distroVersion: 0, distroRunning: false, managed: false, distributions: [], rebootRequired: false }, settings: defaultSettings, linux: null, httpOk: false, checkedAt: Date.now() }
  return invoke('run_operation', { action })
}
export async function logs(): Promise<Log[]> { return native ? invoke('get_logs') : [] }
export async function openMew(port: number) { if (native) await invoke('open_mew', { port }) }
export async function openFolder() { if (native) await invoke('open_folder', { kind: 'manager' }) }
export async function events(handlers: { log: (row: Log) => void; stage: (stage: string) => void; credential: (value: Credential) => void; update: (value: Update) => void; notice: (value: string) => void }): Promise<() => void> {
  if (!native) return () => {}
  const stops = await Promise.all([listen<Log>('manager-log', e => handlers.log(e.payload)), listen<string>('manager-stage', e => handlers.stage(e.payload)), listen<Credential>('manager-credential', e => handlers.credential(e.payload)), listen<Update>('manager-update', e => handlers.update(e.payload)), listen<string>('manager-notice', e => handlers.notice(e.payload))])
  return () => stops.forEach(stop => stop())
}
