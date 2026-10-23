export function installMacCapture(options: {
  target: string
  arch?: string
  run?: (command: string, args: string[], options: object) => { status: number | null; error?: Error }
  exists?: (file: string) => boolean
  rename?: (from: string, to: string) => void
  remove?: (file: string) => void
  log?: (message: string) => void
}): void
