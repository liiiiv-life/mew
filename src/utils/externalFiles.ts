const PREFIX = '@fs:'

export function externalTabPath(absolutePath: string): string {
  return `${PREFIX}${absolutePath}`
}

export function isExternalTabPath(value: string): boolean {
  return value.startsWith(PREFIX)
}

export function externalAbsolutePath(value: string): string {
  return isExternalTabPath(value) ? value.slice(PREFIX.length) : value
}

export function externalFileName(value: string): string {
  const absolute = externalAbsolutePath(value)
  return absolute.split('/').filter(Boolean).pop() ?? absolute
}
