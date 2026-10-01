export function linuxNetworkTool(name: string, executable?: (file: string) => boolean): string | undefined
export function nativeFirewallHint(options?: {
  platform?: string; executable?: string; release?: string
  execute?: (command: string, args: string[], options: Record<string, unknown>) => Promise<{ stdout: string | Buffer }>
  read?: (file: string, encoding: string) => Promise<string>
  tool?: (name: string) => string | undefined
}): Promise<string | undefined>
