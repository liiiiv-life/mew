export function installDesktopHelper(options?: {
  platform?: string
  release?: string
  env?: Record<string, string | undefined>
  directory?: string
  resolvePowerShell?: (options: { env: Record<string, string | undefined> }) => string
  installRuntime?: (options: { target: string; platform: string }) => number
  installCapture?: (options: { target: string }) => void
  run?: (command: string, args: string[], options: object) => { status: number | null; stdout?: string; error?: Error }
}): number
