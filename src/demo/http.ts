import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'

export interface DemoHttpContext {
  store: DemoWorkspaceStore
  request: Request
  url: URL
  body: Record<string, unknown>
  project: string
}
export type DemoHttpHandler = (context: DemoHttpContext) => Response | undefined | Promise<Response | undefined>
export const demoJson = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
export function stringField(body: Record<string, unknown>, key: string, fallback = ''): string {
  const value = body[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string') throw new DemoError(`${key} 값을 확인해 주세요.`)
  return value
}
export function stringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new DemoError(`${key} 목록을 확인해 주세요.`)
  return value as string[]
}
export function requireMethod(request: Request, ...methods: string[]): void {
  if (!methods.includes(request.method)) throw new DemoError('데모에서 지원하지 않는 요청 방식입니다.', 405)
}
