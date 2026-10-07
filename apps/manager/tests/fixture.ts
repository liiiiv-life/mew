import { defaultSettings, type Snapshot } from '../src/model.ts'
export const fixture: Snapshot = {
  system: { platform: 'windows', supported: true, os: 'Windows 11 Pro', build: '26100', architecture: 'AMD64', virtualization: true, wslInstalled: true, wslVersion: 'WSL 2.6.1', distroInstalled: true, distroVersion: 2, distroRunning: true, managed: true, distributions: [{ name: 'Mew', version: 2 }, { name: 'Ubuntu', version: 2 }], rebootRequired: false },
  settings: { ...defaultSettings, ownerEmail: 'owner@example.test' },
  linux: { installed: true, built: true, running: true, port: 5000, workspace: defaultSettings.workspace, commit: 'a1b2c3d4', branch: 'main', dirty: false, tools: { node: 'v24.14.0', npm: '11.11.0', git: 'git version 2.43.0', tmux: 'tmux 3.4', python: 'Python 3.12.3' }, paths: { data: '/home/mew/.local/share/mew', config: '/home/mew/.config/mew/config.env' } },
  httpOk: true, checkedAt: 1791342000000,
}
