import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, chmodSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

/** Copy the already-running supported Node; never start capture during setup. */
export function installNativeRuntime({ target, platform = process.platform, run = spawnSync, copy = copyFileSync, mkdir = mkdirSync, chmod = chmodSync, write = writeFileSync, exists = existsSync, rename = renameSync, remove = file => rmSync(file, { force: true }), executable = process.execPath, log = console.log }) {
  const root = platform === 'darwin' ? path.join(target, 'MewDesktop.app', 'Contents') : path.join(target, 'runtime')
  const binary = platform === 'darwin' ? path.join(root, 'MacOS', 'MewDesktop') : path.join(root, 'node')
  mkdir(path.dirname(binary), { recursive: true })
  const temporary = `${binary}.${process.pid}.tmp`
  try { copy(executable, temporary); chmod(temporary, 0o755); rename(temporary, binary) }
  finally { remove(temporary) }
  const notices = platform === 'darwin' ? path.join(root, 'Resources') : root
  mkdir(notices, { recursive: true })
  const license = [path.join(path.dirname(executable), '../LICENSE'), path.join(path.dirname(executable), 'LICENSE'), path.join(path.dirname(executable), '../share/doc/node/LICENSE')].find(exists)
  if (license) copy(license, path.join(notices, 'Node.LICENSE'))
  else {
    const code = "import fs from 'node:fs'; const response = await fetch('https://raw.githubusercontent.com/nodejs/node/' + process.version + '/LICENSE', {redirect:'error', signal:AbortSignal.timeout(15000)}); if(!response.ok) throw new Error('Node license missing'); fs.writeFileSync(process.argv[1], await response.text());"
    const result = run(binary, ['--input-type=module', '-e', code, path.join(notices, 'Node.LICENSE')], { cwd: target, stdio: 'inherit', timeout: 20_000 })
    if (result.error || result.status !== 0) throw new Error('복사한 Node 버전의 라이선스를 준비하지 못했습니다.')
  }
  if (platform === 'darwin') write(path.join(root, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.liiiiv.mew.desktop</string><key>CFBundleName</key><string>Mew Desktop</string><key>CFBundleDisplayName</key><string>Mew Desktop</string><key>CFBundleExecutable</key><string>MewDesktop</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSLocalNetworkUsageDescription</key><string>Mew Desktop connects directly to your devices and requests temporary UDP mappings from your router for remote desktop access.</string><key>LSUIElement</key><true/></dict></plist>\n`)
  log('[2/3] Checking native Node, WebRTC and input bindings...')
  const probe = "import koffi from 'koffi'; import rtc from 'node-datachannel'; import dbus from 'dbus-next'; if (!koffi.load || !rtc.PeerConnection || !dbus.sessionBus) throw new Error('Native binding missing'); if(process.platform==='linux' && (process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE==='wayland')) await import('usocket'); rtc.cleanup();"
  const result = run(binary, ['--input-type=module', '-e', probe], { cwd: target, stdio: 'inherit', timeout: 30_000 })
  if (result.error || result.status !== 0) throw new Error('네이티브 Node·WebRTC 구성 요소를 준비하지 못했습니다. 설치 내역을 확인해 주세요.')
  return 0
}
