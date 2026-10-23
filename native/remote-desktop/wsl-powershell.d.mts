export function wslPowerShell(options?: {
  env?: Record<string, string | undefined>
  readMounts?: () => string
  readInterop?: (file: string) => string
  executable?: (file: string) => boolean
}): string
