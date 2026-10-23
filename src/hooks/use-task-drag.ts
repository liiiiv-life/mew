import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import { reorderLayoutRect, useReorderAnimation } from '@mew/ui'
import { taskParent, moveTaskSubtree, type TaskItem } from '../../shared/task-list'

type Preview = { item: TaskItem; x: number; y: number; width: number; beforeId: string | null }
type Gesture = { pointerId: number; id: string; startX: number; startY: number; x: number; y: number; offsetX: number; offsetY: number; width: number; capture: HTMLElement; dragging: boolean; order: TaskItem[]; signature: string }

export function useTaskDrag(tasks: TaskItem[], canEdit: boolean, edit: (tasks: TaskItem[]) => void) {
  const list = useRef<HTMLDivElement>(null)
  const latest = useRef({ tasks, canEdit, edit })
  latest.current = { tasks, canEdit, edit }
  const gesture = useRef<Gesture | null>(null)
  const suppressedClick = useRef(false)
  const frame = useRef<number | null>(null)
  const [order, setOrder] = useState<TaskItem[] | null>(null)
  const signature = (items: TaskItem[]) => JSON.stringify(items.map(item => [item.id, taskParent(item)]))
  const [preview, setPreview] = useState<Preview | null>(null)
  const captureAnimation = useReorderAnimation(() => list.current?.querySelectorAll<HTMLElement>('[data-task-id]') ?? [])
  const targetAt = (y: number, current: Gesture) => {
    const siblings = current.order.filter(item => taskParent(item) === taskParent(current.order.find(item => item.id === current.id)!))
    const index = siblings.findIndex(item => item.id === current.id)
    let target = index
    const positions = new Map(siblings.map((item, index) => [item.id, index]))
    for (const row of list.current?.querySelectorAll<HTMLElement>('[data-task-id]') ?? []) {
      const position = positions.get(row.dataset.taskId!) ?? -1
      if (position < 0 || position === index) continue
      const rect = reorderLayoutRect(row), middle = rect.top + rect.height / 2
      if (position < index && y < middle) target = Math.min(target, position)
      if (position > index && y > middle) target = Math.max(target, position)
    }
    return target === index ? current.id : target < index ? siblings[target].id : siblings[target + 1]?.id ?? null
  }
  const cancel = () => {
    const current = gesture.current
    gesture.current = null
    if (current?.dragging) captureAnimation()
    setOrder(null)
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    setPreview(null)
    if (current?.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId)
  }
  const updatePreview = () => {
    const current = gesture.current
    if (!current?.dragging) return
    const item = latest.current.tasks.find(item => item.id === current.id)
    if (!item || signature(latest.current.tasks) !== current.signature || !latest.current.canEdit || !list.current?.checkVisibility()) { cancel(); return }
    const target = targetAt(current.y, current)
    const next = moveTaskSubtree(current.order, current.id, target)
    if (next.some((item, index) => item.id !== current.order[index].id)) {
      captureAnimation()
      current.order = next
      setOrder(next)
    }
    const siblings = current.order.filter(task => taskParent(task) === taskParent(item))
    const beforeId = siblings[siblings.findIndex(task => task.id === current.id) + 1]?.id ?? null
    setPreview({ item, x: current.x - current.offsetX, y: current.y - current.offsetY, width: current.width, beforeId })
  }
  const scroll = () => {
    const current = gesture.current, host = list.current?.parentElement
    if (!current?.dragging || !host) return
    const rect = host.getBoundingClientRect()
    const bottom = Math.min(rect.bottom, window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight)
    const speed = current.y < rect.top + 32 ? -Math.min(16, (rect.top + 32 - current.y) / 2)
      : current.y > bottom - 32 ? Math.min(16, (current.y - bottom + 32) / 2) : 0
    if (speed) host.scrollTop += speed
    updatePreview()
    if (gesture.current?.dragging) frame.current = requestAnimationFrame(scroll)
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    current.x = event.clientX; current.y = event.clientY
    if (!current.dragging && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
      current.capture.setPointerCapture(current.pointerId)
      current.dragging = true
      suppressedClick.current = true
      frame.current = requestAnimationFrame(scroll)
    }
    if (current.dragging) { event.preventDefault(); updatePreview() }
  }
  const moveItem = (id: string, beforeId: string | null) => {
    const { tasks, canEdit, edit } = latest.current
    const item = tasks.find(item => item.id === id)
    if (!canEdit || !item || beforeId === id) return
    const next = moveTaskSubtree(tasks, id, beforeId)
    if (next.every((item, index) => item.id === tasks[index].id)) return
    captureAnimation(); edit(next)
  }
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopImmediatePropagation(); cancel() }
    }
    const reset = () => cancel()
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', reset)
    window.addEventListener('resize', reset)
    document.addEventListener('visibilitychange', reset)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', reset); window.removeEventListener('resize', reset); document.removeEventListener('visibilitychange', reset); cancel() }
    // Gesture callbacks read current data through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const items = new Map(tasks.map(item => [item.id, item]))
  return { list, preview, tasks: order ? order.map(item => items.get(item.id) ?? item) : tasks,
    events: {
      onPointerMove: move,
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const current = gesture.current
        if (!current || current.pointerId !== event.pointerId) return
        if (current.dragging) {
          event.preventDefault()
          updatePreview()
          if (gesture.current) {
            const siblings = current.order.filter(item => taskParent(item) === taskParent(current.order.find(item => item.id === current.id)!))
            moveItem(current.id, siblings[siblings.findIndex(item => item.id === current.id) + 1]?.id ?? null)
          }
        }
        cancel()
      },
      onPointerCancel: cancel,
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => { if (gesture.current?.capture === event.target) cancel() },
    }, handle: (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!latest.current.canEdit || event.button !== 0 || gesture.current) { if (gesture.current) cancel(); return }
      const row = event.currentTarget.closest<HTMLElement>('[data-task-id]')
      if (!row) return
      const rect = reorderLayoutRect(row)
      suppressedClick.current = false
      event.preventDefault()
      gesture.current = { pointerId: event.pointerId, id, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.x, offsetY: event.clientY - rect.y, width: rect.width, capture: list.current!, dragging: false, order: latest.current.tasks, signature: signature(latest.current.tasks) }
    },
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (suppressedClick.current) { event.preventDefault(); event.stopPropagation(); suppressedClick.current = false }
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || !canEdit) return
      event.preventDefault(); event.stopPropagation()
      const siblings = tasks.filter(item => taskParent(item) === taskParent(tasks.find(item => item.id === id)!))
      const index = siblings.findIndex(item => item.id === id)
      if (event.key === 'ArrowUp' && index > 0) moveItem(id, siblings[index - 1].id)
      if (event.key === 'ArrowDown' && index < siblings.length - 1) moveItem(id, siblings[index + 2]?.id ?? null)
    },
  }) }
}
