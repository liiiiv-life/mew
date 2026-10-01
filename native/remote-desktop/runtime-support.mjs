import os from 'node:os'

/** Native GPU modules target macOS 13 (Darwin 22), Linux x64/arm64. */
export function runtimeSupportError({ platform = process.platform, arch = process.arch, release = os.release() } = {}) {
  if (['darwin', 'linux'].includes(platform) && !['x64', 'arm64'].includes(arch)) return 'Mac·Linux 원격 데스크톱은 64비트 x64 또는 arm64 환경이 필요합니다.'
  const major = /^(\d+)\./.exec(release)?.[1]
  if (platform === 'darwin' && major && Number(major) < 22) return '현재 원격 데스크톱 보조앱은 macOS 13(Ventura) 이상이 필요합니다.'
}
