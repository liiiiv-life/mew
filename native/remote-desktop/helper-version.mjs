import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// One manifest owns both installation copies and readiness. Dependencies are locked.
export const HELPER_FILES = ['permissions-host.mjs', 'capture-macos.m', 'capture-macos.h', 'capture-macos.mjs', 'install-macos.mjs', 'capture-gdi.mjs', 'cursor-windows.mjs', 'capture-windows.mjs', 'capture-worker.mjs', 'native-capture.mjs', 'capture-start.mjs', 'native-stream.mjs', 'cursor-protocol.mjs', 'relay-adaptation.mjs', 'LICENSE', 'package.json', 'package-lock.json', 'helper-version.mjs', 'install-runtime.mjs', 'windows-session.ps1', 'main.mjs', 'parent-channel.mjs', 'preload.cjs', 'app.html', 'sender.mjs', 'direct-sender.mjs', 'relay-sender.mjs', 'relay-protocol.mjs', 'host-wire.mjs', 'protocol.mjs', 'keys.mjs', 'input-native.mjs', 'input-portal.mjs']
HELPER_FILES.push('native-host.mjs', 'native-direct.mjs', 'gpu-worker.mjs', 'gpu-windows.mjs', 'gpu-windows.cpp', 'install-windows-gpu.ps1', 'cursor-png.mjs', 'clipboard-windows.mjs')
HELPER_FILES.push('virtual-display-client.h', 'virtual-display-protocol.h')
HELPER_FILES.push('connection-notice.mjs', 'notification-windows.mjs', 'notification-windows.cpp')
HELPER_FILES.push('host-permissions.mjs')
HELPER_FILES.push('runtime-support.mjs')
HELPER_FILES.push('native-platform.mjs', 'gpu-posix.mjs', 'gpu-posix-worker.mjs', 'gpu-posix.h', 'gpu-macos.m', 'gpu-linux.cpp', 'install-posix-video.mjs', 'install-native-runtime.mjs', 'permissions-native.mjs')
HELPER_FILES.push('native-connectivity.mjs', 'nat-port-map.mjs', 'nat-upnp.mjs', 'prepare-windows-network.ps1')
HELPER_FILES.push('network-support.mjs', 'windows-network.mjs')
HELPER_FILES.push('host-shutdown.mjs')
HELPER_FILES.push('video-settings.mjs', 'video-pacer.mjs', 'video-adaptation.mjs')
export function helperVersion(directory) {
  const hash = createHash('sha256')
  for (const file of HELPER_FILES) hash.update(file).update('\0').update(readFileSync(path.join(directory, file)))
  return hash.digest('hex')
}
export function markHelperReady(directory) {
  const marker = path.join(directory, '.mew-ready')
  writeFileSync(`${marker}.tmp`, helperVersion(directory) + '\n', { mode: 0o600 })
  renameSync(`${marker}.tmp`, marker)
  writeFileSync(path.join(directory, '.mew-dependencies'), dependencyVersion(directory), { mode: 0o600 })
}
function dependencyVersion(directory) {
  return createHash('sha256').update(process.platform).update(process.arch).update(readFileSync(path.join(directory, 'package-lock.json'))).digest('hex')
}
export function dependenciesCurrent(directory) {
  try { return readFileSync(path.join(directory, '.mew-dependencies'), 'utf8') === dependencyVersion(directory) && ['koffi', 'dbus-next', 'node-datachannel'].every(name => existsSync(path.join(directory, 'node_modules', name, 'package.json'))) }
  catch { return false }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'files') console.log(JSON.stringify(HELPER_FILES))
  else if (process.argv[2] === 'mark') markHelperReady(path.dirname(fileURLToPath(import.meta.url)))
  else if (process.argv[2] === 'dependencies') console.log(dependenciesCurrent(path.dirname(fileURLToPath(import.meta.url))) ? 'true' : 'false')
}
