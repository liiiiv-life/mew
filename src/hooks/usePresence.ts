import { writeBrowserStorage } from '@mew/ui/browser-storage'
import { useEffect, useRef, useState } from 'react'
import { forgetSavedProject } from '../api/client'
import { identityColor } from '../utils/collabColor'

// 서버는 경로 문자열 단위로만 세므로 프로젝트를 접두어로 붙여 프로젝트끼리 섞이지 않게 한다
function qualify(project: string, path: string | null): string | null {
  return path ? `${project}:${path}` : null
}

// 서버 presence 소켓 연결 관리.
// - 지금 포커스 중인 문서 경로(focusedPath) 하나와 내 커서 색(authEmail 기반, useCollab과 동일 규칙)을
//   서버에 알린다 — 열어만 둔 탭은 세지 않는다.
// - 서버가 보내는 participants(경로별 포커스 세션들의 색상 목록)와 tree(파일시스템 변경 — watcher)
//   메시지를 받는다.
export function usePresence(
  project: string,
  focusedPath: string | null,
  authEmail: string | null,
  onTreeChange: (signal?: { project?: string; version?: number; parents?: string[] }) => void,
  onWorkspaceChange?: (initialProject?: string) => void,
): Record<string, string[]> {
  const [participants, setParticipants] = useState<Record<string, string[]>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const focusedPathRef = useRef<string | null>(null)
  // 연결 이펙트를 재실행하지 않고도 항상 최신 값을 쓰기 위한 ref들
  const onTreeChangeRef = useRef(onTreeChange)
  onTreeChangeRef.current = onTreeChange
  const onWorkspaceChangeRef = useRef(onWorkspaceChange)
  onWorkspaceChangeRef.current = onWorkspaceChange
  const colorRef = useRef(identityColor(authEmail))
  colorRef.current = identityColor(authEmail)
  // 프로젝트를 옮기면 접두어가 달라진다 — 소켓은 그대로 두고 보낼/거를 접두어만 바꾼다
  const projectRef = useRef(project)
  projectRef.current = project

  useEffect(() => {
    focusedPathRef.current = focusedPath
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'focus', path: qualify(project, focusedPath), color: colorRef.current }))
    }
  }, [project, focusedPath])

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (cancelled) return
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${protocol}//${location.host}/api/presence`)
      wsRef.current = ws
      ws.onopen = () => {
        ws?.send(
          JSON.stringify({ type: 'focus', path: qualify(projectRef.current, focusedPathRef.current), color: colorRef.current }),
        )
      }
      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        try {
          const msg = JSON.parse(event.data) as { type?: string; participants?: Record<string, string[]>; project?: string; version?: number; parents?: string[] }
          if (msg.type === 'participants' && msg.participants) {
            // 내 프로젝트 것만 남기고 접두어를 벗겨 UI가 기존처럼 rel 경로로 쓰게 한다
            const prefix = `${projectRef.current}:`
            const mine: Record<string, string[]> = {}
            for (const [key, colors] of Object.entries(msg.participants)) {
              if (key.startsWith(prefix)) mine[key.slice(prefix.length)] = colors
            }
            setParticipants(mine)
          } else if (msg.type === 'tree') onTreeChangeRef.current({ project: msg.project, version: msg.version, parents: msg.parents })
          // 채팅·댓글이 바뀌었다는 **내용 없는 신호** — 받은 쪽이 REST로 다시 읽는다(신호는 게스트에게도
          // 가므로 경로·본문을 싣지 않는다). 창은 소켓을 따로 열지 않고 window 이벤트로 받는다
          else if (msg.type === 'chat' || msg.type === 'comments') {
            window.dispatchEvent(new CustomEvent('mew:signal', { detail: { type: msg.type } }))
          }
          // 루트 프로젝트가 바뀌었다. App이 루트별 탭·본문 캐시를 갈아끼우고 트리만 다시 읽는다.
          else if (msg.type === 'workspace') {
            if (msg.project) writeBrowserStorage('mew:project', msg.project)
            else forgetSavedProject()
            onWorkspaceChangeRef.current?.(msg.project)
          }
        } catch {
          // 잘못된 메시지는 무시
        }
      }
      ws.onclose = () => {
        if (!cancelled) retryTimer = setTimeout(connect, 3000)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
    }
  }, [])

  return participants
}
