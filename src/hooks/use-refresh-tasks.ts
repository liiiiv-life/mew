import { useCallback, useEffect, useRef, useState } from 'react'

/** Explicit restoration reads only: polling, saves and ordinary file opens stay local. */
export function useRefreshTasks() {
  const tasks = useRef(new Set<symbol>())
  const [pending, setPending] = useState(false)
  useEffect(() => () => { tasks.current.clear() }, [])

  const track = useCallback(<T,>(request: Promise<T>): Promise<T> => {
    const token = Symbol()
    tasks.current.add(token)
    setPending(true)
    return request.finally(() => {
      // Unmounted owners discard their outstanding tasks without updating state.
      if (tasks.current.delete(token)) setPending(tasks.current.size > 0)
    })
  }, [])

  return { pending, track }
}
