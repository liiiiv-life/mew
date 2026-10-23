import { spawnSync } from 'node:child_process'
import { renameSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'

// pkg-config emits POSIX escaped arguments; do not execute its output as a shell.
export function pkgArguments(value) {
  const values = []; let current = '', quote = '', escaped = false
  for (const char of value.trim()) {
    if (escaped) { current += char; escaped = false }
    else if (char === '\\' && quote !== "'") escaped = true
    else if (quote) { if (char === quote) quote = ''; else current += char }
    else if (char === '"' || char === "'") quote = char
    else if (/\s/.test(char)) { if (current) values.push(current); current = '' }
    else current += char
  }
  if (quote || escaped) throw new Error('잘못된 pkg-config 출력입니다.')
  if (current) values.push(current)
  return values
}
export function installPosixVideo({ target, platform = process.platform, arch = process.arch, run = spawnSync, exists = existsSync, rename = renameSync, remove = file => rmSync(file, { force: true }), log = console.log }) {
  const mac = platform === 'darwin', output = path.join(target, mac ? 'gpu-macos.dylib' : 'gpu-linux.so'), temporary = `${output}.tmp`
  remove(temporary)
  const execute = (command, args, options = {}) => {
    const result = run(command, args, { cwd: target, stdio: 'inherit', timeout: 120_000, ...options })
    if (result.error || result.status !== 0) throw new Error(mac ? 'Mac 네이티브 영상 모듈 준비에 실패했습니다. Apple Command Line Tools와 macOS 13 이상이 필요합니다.' : 'Linux 네이티브 영상 모듈 준비에 실패했습니다. C++ 컴파일러·pkg-config·GStreamer 개발 라이브러리·X11/Xrandr 개발 라이브러리를 확인해 주세요.')
    return result
  }
  log('[3/3] Preparing native hardware H.264 video module...')
  try {
    if (mac) {
      if (!['x64', 'arm64'].includes(arch)) throw new Error('Mac 64비트 CPU가 필요합니다.')
      execute('/usr/bin/xcrun', ['--sdk', 'macosx', 'clang', '-dynamiclib', '-fobjc-arc', '-fblocks', '-O2', '-fvisibility=hidden', '-arch', arch === 'x64' ? 'x86_64' : 'arm64', '-mmacosx-version-min=13.0', '-Wall', '-Wextra', '-Werror', path.join(target, 'gpu-macos.m'), '-o', temporary,
        '-framework', 'ScreenCaptureKit', '-framework', 'VideoToolbox', '-framework', 'Metal', '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'Foundation', '-framework', 'CoreMedia', '-framework', 'CoreVideo', '-framework', 'UserNotifications'])
      execute('/usr/bin/codesign', ['--force', '--sign', '-', temporary])
      execute('/usr/bin/codesign', ['--verify', '--strict', temporary])
      execute('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'dev.liiiiv.mew.desktop', path.join(target, 'MewDesktop.app')])
      execute('/usr/bin/codesign', ['--verify', '--strict', path.join(target, 'MewDesktop.app')])
    } else {
      execute('pkg-config', ['--atleast-version=1.24', 'gstreamer-1.0'])
      const flags = execute('pkg-config', ['--cflags', '--libs', 'gstreamer-app-1.0', 'gstreamer-video-1.0', 'x11', 'xrandr'], { stdio: 'pipe', encoding: 'utf8' })
      execute('c++', ['-shared', '-fPIC', '-std=c++17', '-O2', '-fvisibility=hidden', '-Wall', '-Wextra', '-Werror', path.join(target, 'gpu-linux.cpp'), '-o', temporary, ...pkgArguments(flags.stdout)])
    }
    if (!exists(temporary)) throw new Error('네이티브 GPU 모듈 파일이 생성되지 않았습니다.')
    rename(temporary, output)
  } finally { remove(temporary) }
}
