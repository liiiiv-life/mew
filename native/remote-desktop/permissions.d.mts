export type PermissionStatus = { accessibility: boolean; screen: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' }
export type PermissionHostOptions = {
  target: string; profile: string; mode: 'check' | 'accessibility' | 'screen';
  env: Record<string, string | undefined>; signal?: AbortSignal; timeout: number
}
export function parsePermissionStatus(output: string): PermissionStatus
export function runPermissionHost(options: PermissionHostOptions, run?: (executable: string, args: string[], options: object) => Promise<{ stdout: string }>): Promise<PermissionStatus | null>
export function prepareDesktopPermissions(options?: {
  platform?: string; env?: Record<string, string | undefined>; directory?: string;
  run?: (options: PermissionHostOptions) => Promise<PermissionStatus | null>;
  loginUser?: () => Promise<boolean>; log?: (message: string) => void;
  now?: () => number; wait?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
  timeout?: number; signal?: AbortSignal
}): Promise<void>
