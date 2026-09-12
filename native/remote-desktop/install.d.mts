export function installDesktopHelper(options?: {
  platform?: string
  release?: string
  env?: Record<string, string | undefined>
  directory?: string
  run?: (command: string, args: string[], options: object) => { status: number | null; stdout?: string; error?: Error }
}): number
