import { useEffect, useState } from 'react'

export type SidebarCreateRequest = { kind: 'file' | 'folder'; parentPath: string }
type Target = { scope: string; parentPath: string }

/** Keep the selected directory independent of editor focus and toolbar clicks. */
export function useSidebarCreate(workspacePath: string | null, reveal: (scope: string) => void) {
  const [target, setTarget] = useState<(Target & { workspacePath: string | null }) | null>(null)
  const [pending, setPending] = useState<(SidebarCreateRequest & { scope: string; workspacePath: string | null }) | null>(null)
  useEffect(() => { setTarget(null); setPending(null) }, [workspacePath])

  const selectDirectory = (scope: string, parentPath: string) => setTarget({ scope, parentPath, workspacePath })
  const create = (kind: SidebarCreateRequest['kind']) => {
    const destination = target?.workspacePath === workspacePath ? target : { scope: 'root', parentPath: '' }
    reveal(destination.scope)
    setPending({ ...destination, kind, workspacePath })
  }
  const treeProps = (scope: string) => ({
    onDirectoryFocus: (parentPath: string) => selectDirectory(scope, parentPath),
    createRequest: pending?.workspacePath === workspacePath && pending.scope === scope ? pending : null,
    onCreateRequestHandled: () => setPending(current => current === pending ? null : current),
  })
  return { selectDirectory, create, treeProps }
}
