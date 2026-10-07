import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TreeNode } from '../api/client'
import { TREE_MATERIALIZE_EVENT, type TreeMaterializeDetail } from '../utils/treePersistence'

/** Expanded directory wrappers stay mounted for sticky ancestors. Long runs of files and closed folders are windowed. */
export function VirtualTreeRows({ nodes, pinned, render }: {
  nodes: TreeNode[]
  pinned: (string | undefined)[]
  render: (node: TreeNode) => ReactNode
}) {
  const container = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(28)
  const [range, setRange] = useState({ start: 0, end: 40 })
  const [focusPath, setFocusPath] = useState<string>()
  const indices = useMemo(() => new Map(nodes.map((node, index) => [node.path, index])), [nodes])

  useLayoutEffect(() => {
    const group = container.current!
    let scroller = group.parentElement
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    if (!scroller) return
    const list = scroller
    let frame = 0
    const update = () => {
      const top = group.getBoundingClientRect().top - list.getBoundingClientRect().top
      const start = Math.max(0, Math.min(nodes.length, Math.floor(-top / height) - 12))
      const end = Math.max(start, Math.min(nodes.length, Math.ceil((list.clientHeight - top) / height) + 12))
      setRange(previous => previous.start === start && previous.end === end ? previous : { start, end })
      const row = group.querySelector<HTMLElement>('[data-path]')
      const measured = row?.getBoundingClientRect().height
      if (measured && Math.abs(measured - height) > 0.5) setHeight(measured)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update) }
    const materialize = (event: Event) => {
      const detail = (event as CustomEvent<TreeMaterializeDetail>).detail
      if (detail.tree !== group.closest<HTMLElement>('[data-tree-key]')?.dataset.treeKey) return
      const index = indices.get(detail.path)
      if (index === undefined) return
      event.preventDefault()
      const top = group.getBoundingClientRect().top - list.getBoundingClientRect().top + index * height
      if (detail.fraction !== undefined) list.scrollTop += top + height * detail.fraction - list.clientHeight / 2
      else if (top < 0) list.scrollTop += top
      else if (top + height > list.clientHeight) list.scrollTop += top + height - list.clientHeight
      update()
    }
    list.addEventListener('scroll', schedule, { passive: true })
    list.addEventListener(TREE_MATERIALIZE_EVENT, materialize)
    const resize = new ResizeObserver(schedule)
    resize.observe(list)
    resize.observe(group)
    update()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      list.removeEventListener('scroll', schedule)
      list.removeEventListener(TREE_MATERIALIZE_EVENT, materialize)
    }
  }, [nodes.length, height, indices])

  const visible = new Set<number>()
  for (let index = range.start; index < range.end; index++) visible.add(index)
  for (const path of [...pinned, focusPath]) {
    const index = path === undefined ? undefined : indices.get(path)
    if (index !== undefined) visible.add(index)
  }
  return <div ref={container} data-tree-virtual style={{ height: nodes.length * height, position: 'relative' }}
    onFocus={event => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-index]')
      if (row) setFocusPath(nodes[Number(row.dataset.treeIndex)]?.path)
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusPath(undefined) }}
    onKeyDown={event => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-index]')
      if (!row) return
      const buttons = [...row.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')]
      if (event.target !== buttons[event.shiftKey ? 0 : buttons.length - 1]) return
      const index = Number(row.dataset.treeIndex) + (event.shiftKey ? -1 : 1)
      if (!nodes[index] || visible.has(index)) return
      event.preventDefault()
      setFocusPath(nodes[index].path)
      requestAnimationFrame(() => {
        const next = container.current?.querySelector(`[data-tree-index="${index}"]`)
        const targets = next?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')
        targets?.[event.shiftKey ? targets.length - 1 : 0]?.focus()
      })
    }}>
    {[...visible].sort((a, b) => a - b).map(index => nodes[index] && <div key={nodes[index].path}
      data-tree-index={index}
      style={{ position: 'absolute', top: index * height, width: '100%' }}>{render(nodes[index])}</div>)}
  </div>
}
