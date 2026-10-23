import type { Doc } from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { AuthStatus } from '../api/auth.ts'
import type { DesktopConnector } from '../utils/desktop-connection.ts'

export interface AppTransport {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  socket(url: string, protocols?: string | string[]): WebSocket
  close(): void
}

export interface CollaborationSession {
  ydoc: Doc
  awareness: Awareness
  synced: boolean
  connected: boolean
}

export interface CollaborationProvider {
  open(
    identity: { project: string; path: string; authEmail: string | null },
    onState: (session: CollaborationSession) => void,
  ): { close(): void }
  close(): void
}

export interface AppRuntime {
  kind?: 'live' | 'demo'
  transport?: AppTransport
  collaboration?: CollaborationProvider
  initialAuth?: AuthStatus
  basePath?: string
  controls?: { label: string; reset(): void }
  onLoggedOut?(): void
  resourceUrl?(url: string): string
  prepareResourceUrl?(url: string, signal?: AbortSignal): Promise<string>
  releaseResourceUrl?(url: string): void
  desktopConnection?: DesktopConnector
}

let runtime: AppRuntime = {}

/** Select the execution environment before loading the application entrypoint. */
export function configureAppRuntime(next: AppRuntime): void {
  const previous = runtime
  runtime = next
  if (previous.transport !== next.transport) previous.transport?.close()
  if (previous.collaboration !== next.collaboration) previous.collaboration?.close()
}

export function getAppRuntime(): AppRuntime {
  return runtime
}

/** DOM resource consumers need the same environment boundary as fetch callers. */
export function appResourceUrl(url: string): string {
  return runtime.resourceUrl?.(url) ?? url
}

/** Expensive downloads are prepared only after an explicit user action. */
export async function prepareAppResourceUrl(url: string, signal?: AbortSignal): Promise<string> {
  return runtime.prepareResourceUrl?.(url, signal) ?? url
}

/** Keep application navigation inside the entrypoint selected by its host. */
export function normalizeWorkspaceLocation(): void {
  if (location.pathname.startsWith('/__mew_ui/')) return
  const path = runtime.basePath ?? '/'
  if (location.pathname !== path) history.replaceState(null, '', path)
}
