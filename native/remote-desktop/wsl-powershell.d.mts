export function wslPowerShell(options?: {
  env?: Record<string, string | undefined>
  readMounts?: () => string
  executable?: (file: string) => boolean
}): string
