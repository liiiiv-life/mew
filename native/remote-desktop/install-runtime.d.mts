export function installDesktopRuntime(options: {
  target: string
  platform?: string
  run?: (command: string, args: string[], options: object) => { status: number | null; error?: Error }
  exists?: (file: string) => boolean
  read?: (file: string) => string
  log?: (message: string) => void
}): number
