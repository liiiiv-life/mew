// 홈 탭에 세우는 위젯 목록 — 사용자가 넣고 빼고 순서를 바꾼다.
//
// 플러그인 런타임이 아니라 **정적 등록표**다. 위젯 하나를 더하는 일은 여기 한 줄을 더하는 것이고,
// 사용자가 고른 배치(순서·숨김)만 브라우저에 남는다. 나중에 등록표에 새 위젯이 생기면 이미 배치를
// 저장해 둔 사람에게도 뜬다 — 저장분에 없는 아이디는 "아직 못 본 위젯"으로 보고 뒤에 붙이기 때문이다.
import type { ReactNode } from 'react'
import type { ProjectInfo, TodoItem, TodoStatus, TodoType } from '../../api/client'
import { DueCalendar } from './DueCalendar'
import { TodoTracker } from './TodoTracker'

export interface HomeWidgetContext {
  items: TodoItem[]
  projects: ProjectInfo[]
  loading: boolean
  onCreate: (input: { text: string; type: TodoType; due: string | null; projects: string[] }) => void
  onUpdate: (
    item: TodoItem,
    change: {
      text?: string
      type?: TodoType
      status?: TodoStatus
      done?: boolean
      due?: string | null
      projects?: string[]
    },
  ) => void
  onDelete: (item: TodoItem) => void
}

export interface HomeWidget {
  id: string
  title: string
  render: (ctx: HomeWidgetContext) => ReactNode
}

export const HOME_WIDGETS: HomeWidget[] = [
  { id: 'todos', title: '할 일', render: (c) => <TodoTracker {...c} /> },
  { id: 'calendar', title: '달력', render: (c) => <DueCalendar items={c.items} onUpdate={c.onUpdate} /> },
]

export interface HomeLayout {
  /** 세우는 순서 */
  order: string[]
  /** 끈 위젯 — 등록표에 있어도 화면에 세우지 않는다 */
  hidden: string[]
}

const KEY = 'mew:home-widgets'

function isKnown(id: unknown): id is string {
  return typeof id === 'string' && HOME_WIDGETS.some((w) => w.id === id)
}

export function loadHomeLayout(): HomeLayout {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<HomeLayout>) : null
    return {
      order: Array.isArray(parsed?.order) ? parsed.order.filter(isKnown) : [],
      hidden: Array.isArray(parsed?.hidden) ? parsed.hidden.filter(isKnown) : [],
    }
  } catch {
    return { order: [], hidden: [] }
  }
}

export function saveHomeLayout(layout: HomeLayout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout))
  } catch {
    // 사생활 보호 모드 등 — 이번 세션 화면에는 지장이 없다
  }
}

/** 저장된 순서 + 아직 자리를 못 받은 위젯(뒤에 붙는다). 숨김은 뺀다 */
export function visibleWidgets(layout: HomeLayout): HomeWidget[] {
  return orderedWidgets(layout).filter((w) => !layout.hidden.includes(w.id))
}

/** 설정 줄에 그릴 전체 목록 — 숨긴 것까지 저장된 순서대로 */
export function orderedWidgets(layout: HomeLayout): HomeWidget[] {
  const known = new Map(HOME_WIDGETS.map((w) => [w.id, w]))
  const placed = layout.order.map((id) => known.get(id)!).filter(Boolean)
  const rest = HOME_WIDGETS.filter((w) => !layout.order.includes(w.id))
  return [...placed, ...rest]
}

/** 위젯 하나를 한 칸 옮긴 배치 — 순서는 항상 전체 목록으로 저장한다(빈 order를 남기지 않는다) */
export function movedLayout(layout: HomeLayout, id: string, delta: -1 | 1): HomeLayout {
  const order = orderedWidgets(layout).map((w) => w.id)
  const from = order.indexOf(id)
  const to = from + delta
  if (from === -1 || to < 0 || to >= order.length) return layout
  order.splice(to, 0, ...order.splice(from, 1))
  return { ...layout, order }
}

export function toggledLayout(layout: HomeLayout, id: string): HomeLayout {
  const hidden = layout.hidden.includes(id) ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id]
  return { order: orderedWidgets(layout).map((w) => w.id), hidden }
}
