export const LIVE_WS_PATH = '/api/live/ws'

export type LiveResource =
  | { kind: 'features'; workspace: string }
  | { kind: 'git'; project: string; path: string }
  | { kind: 'git-diff'; project: string; path: string; file: string }
  | { kind: 'debugger'; workspace: string }
  | { kind: 'debugger-browser'; workspace: string }

export type LiveMessage =
  | { type: 'snapshot'; id: string; revision: number; value: Record<string, unknown> }
  | { type: 'patch'; id: string; revision: number; base: number; value: Record<string, unknown>; removed: string[] }
  | { type: 'error'; id: string; message: string }
