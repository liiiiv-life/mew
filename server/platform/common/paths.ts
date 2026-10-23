import path from 'node:path'
export function withinPath(root: string, candidate: string, platform = process.platform): boolean {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const relative = paths.relative(root, candidate)
  return relative === '' || relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative)
}
export function validWindowsRelativePath(value: string): boolean {
  return value.split(/[\\/]/).every(segment => segment === '' || segment === '.' || segment === '..' ||
    !/[<>:"|?*]/.test(segment) && !Array.from(segment).some(character => character.charCodeAt(0) < 32) && !/[. ]$/.test(segment) && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment))
}
