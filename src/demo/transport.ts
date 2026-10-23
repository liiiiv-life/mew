import type { AppTransport } from '../runtime/app-runtime.ts'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'
import { demoJson, type DemoHttpContext } from './http.ts'
import { handleDemoFiles } from './http-files.ts'
import { handleDemoGit } from './http-git.ts'
import { handleDemoSettings } from './http-settings.ts'
import { handleDemoDatabase } from './http-database.ts'
import { handleDemoMewpet } from './http-mewpet.ts'
import { handleDemoProjects } from './http-projects.ts'
import { handleDemoFeatures } from './http-features.ts'
import { handleDemoTasks } from './http-tasks.ts'
import { handleDemoHost } from './http-host.ts'
import { handleDemoDebugger } from './http-debugger.ts'
import { handleDemoAdmin } from './http-admin.ts'

type SocketFactory = ((url: string, protocols?: string | string[]) => WebSocket) & { close?: () => void }
const handlers = [handleDemoProjects, handleDemoFeatures, handleDemoTasks, handleDemoFiles, handleDemoGit, handleDemoHost, handleDemoDebugger, handleDemoAdmin, handleDemoSettings, handleDemoDatabase, handleDemoMewpet]

/** Local HTTP adapter. An unimplemented operation can never fall through to a real server. */
export async function demoFetch(store: DemoWorkspaceStore, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const origin = globalThis.location?.origin ?? 'https://demo.mew.test'
  const request = new Request(input instanceof Request ? input : new URL(String(input), origin), init)
  if (request.signal.aborted) throw new DOMException('요청을 취소했습니다.', 'AbortError')
  const url = new URL(request.url)
  if (url.origin !== origin || !url.pathname.startsWith('/api/')) return demoJson({ error: '데모 작업 공간 밖으로 요청할 수 없습니다.', code: 'DEMO_REQUEST_BLOCKED' }, 403)
  try {
    let body: Record<string, unknown> = {}
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Content-Type')?.includes('application/json')) {
      const value: unknown = await request.clone().json()
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DemoError('요청 내용을 확인해 주세요.')
      body = value as Record<string, unknown>
    }
    const project = typeof body.project === 'string' ? body.project : url.searchParams.get('project') ?? '.workspace'
    const context: DemoHttpContext = { store, request, url, body, project }
    for (const handler of handlers) {
      const response = await handler(context)
      if (request.signal.aborted) throw new DOMException('요청을 취소했습니다.', 'AbortError')
      if (response) return response
    }
    return demoJson({ error: '이 기능은 데모에서 지원하지 않습니다.', code: 'DEMO_UNSUPPORTED' }, 501)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof DemoError) return demoJson({ error: error.message, code: 'DEMO_OPERATION_FAILED' }, error.status)
    if (error instanceof SyntaxError) return demoJson({ error: '요청 내용을 확인해 주세요.', code: 'DEMO_INVALID_REQUEST' }, 400)
    throw error
  }
}

export function createDemoTransport(store: DemoWorkspaceStore, sockets?: SocketFactory): AppTransport {
  let closed = false
  return {
    fetch(input, init) {
      if (closed) return Promise.reject(new Error('데모 세션이 종료됐습니다.'))
      return demoFetch(store, input, init)
    },
    socket(url, protocols) {
      if (closed) throw new Error('데모 세션이 종료됐습니다.')
      if (!sockets) throw new Error('이 데모 소켓은 지원하지 않습니다.')
      return sockets(url, protocols)
    },
    close() { if (closed) return; closed = true; sockets?.close?.(); store.close() },
  }
}
