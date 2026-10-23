import { spawnSync } from 'node:child_process'
import { renameSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'

/** Local source only; no downloaded native capture binary or runtime service. */
export function installMacCapture({ target, arch = process.arch, run = spawnSync, exists = existsSync, rename = renameSync, remove = file => rmSync(file, { force: true }), log = console.log }) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Mac 원격 캡처는 Apple Silicon 또는 Intel 64비트가 필요합니다.')
  const output = path.join(target, 'capture-macos.dylib'), temporary = `${output}.tmp`
  remove(temporary)
  const execute = (command, args) => {
    const result = run(command, args, { cwd: target, stdio: 'inherit', timeout: 120_000 })
    if (result.error || result.status !== 0) throw new Error('Mac 캡처 모듈을 준비하지 못했습니다. xcode-select --install로 Command Line Tools를 설치·업데이트한 뒤 다시 연결해 주세요.')
  }
  log('Preparing native Mac screen capture with Apple Command Line Tools...')
  try {
    execute('/usr/bin/xcrun', ['--sdk', 'macosx', 'clang', '-dynamiclib', '-fobjc-arc', '-fblocks', '-O2', '-fvisibility=hidden',
      '-arch', arch === 'arm64' ? 'arm64' : 'x86_64', '-mmacosx-version-min=12.3', '-Wall', '-Wextra', '-Werror',
      path.join(target, 'capture-macos.m'), '-o', temporary,
      '-framework', 'ScreenCaptureKit', '-framework', 'AppKit', '-framework', 'Foundation', '-framework', 'CoreGraphics', '-framework', 'CoreMedia', '-framework', 'CoreVideo'])
    if (!exists(temporary)) throw new Error('Mac 캡처 모듈 파일이 생성되지 않았습니다. 준비 내역을 확인해 주세요.')
    execute('/usr/bin/codesign', ['--force', '--sign', '-', temporary])
    execute('/usr/bin/codesign', ['--verify', '--strict', temporary])
    rename(temporary, output)
  } finally { remove(temporary) }
}
