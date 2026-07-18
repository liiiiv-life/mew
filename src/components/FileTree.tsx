import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../api/client'
import { createFolder, createNewDocument, deleteFile, renamePath } from '../api/client'
import { flattenFiles, fuzzyScore } from '../utils/fuzzy'

type EditingState =
  | { mode: 'rename'; path: string; type: 'file' | 'dir'; value: string; error?: string; busy?: boolean }
  | { mode: 'create-file' | 'create-folder'; parentPath: string; value: string; error?: string; busy?: boolean }
  | null

type Focused = { path: string; type: 'file' | 'dir' } | null

type PopoverState = { path: string; type: 'file' | 'dir'; x: number; y: number } | null

interface NodeCtx {
  selectedPath: string | null
  focused: Focused
  openDirs: Set<string>
  editing: EditingState
  readOnly: boolean
  presence: Record<string, number>
  onSelect: (path: string, opts?: { preview?: boolean }) => void
  toggleDir: (path: string) => void
  focusNode: (path: string, type: 'file' | 'dir') => void
  startRename: (path: string, type: 'file' | 'dir') => void
  startCreate: (parentPath: string, kind: 'file' | 'folder') => void
  requestDelete: (path: string, type: 'file' | 'dir') => void
  openPopover: (path: string, type: 'file' | 'dir', x: number, y: number) => void
  setEditValue: (v: string) => void
  submitEdit: () => void
  cancelEdit: () => void
}

function parentOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

// 이 문서를 탭으로 열어둔 세션 수 배지 (탭 바의 배지와 동일한 시각 언어)
function PresenceBadge({ count }: { count: number }) {
  if (count < 1) return null
  return (
    <span
      className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-medium text-ink-inverse"
      title={`이 문서를 ${count}개 세션에서 열어두고 있습니다`}
    >
      {count}
    </span>
  )
}

function sanitizeSegment(input: string): string {
  return input.trim().replace(/[\\/]+/g, '-')
}

function InlineInput({
  value,
  onChange,
  onCommit,
  onCancel,
  error,
  placeholder,
  paddingLeft,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  error?: string
  placeholder?: string
  paddingLeft: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // 서버가 에러를 돌려주면 재시도할 수 있도록 커밋 잠금을 푼다
  useEffect(() => {
    if (error) committedRef.current = false
  }, [error])

  return (
    <div style={{ paddingLeft }} className="py-0.5 pr-2">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            // 한글 등 IME 조합 확정용 Enter는 무시 — 조합 중 상태로 한 번, 실제 제출로 또
            // 한 번 발화되어 submitEdit이 중복 실행되는 것을 막는다 (keyCode 229는 구형 브라우저 호환)
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
            if (committedRef.current) return
            committedRef.current = true
            onCommit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={() => {
          // 포커스를 잃으면 취소가 아니라 커밋을 시도한다 — 모바일에서 엔터 키 이벤트가
          // 안정적으로 발화되지 않는 경우가 있어(키보드 자동 닫힘 등), blur를 곧 "완료 의도"로
          // 취급해야 "아무 반응 없음"으로 보이는 상황을 막을 수 있다. 값이 안 바뀐 경우엔
          // onCommit 내부에서 알아서 무동작 처리됨. 명시적 취소는 Escape로만 가능하다.
          if (committedRef.current) return
          committedRef.current = true
          onCommit()
        }}
        placeholder={placeholder}
        className="w-full rounded border border-accent bg-surface px-1.5 py-0.5 text-sm text-ink outline-none"
      />
      {error && <div className="mt-0.5 text-xs text-danger">{error}</div>}
    </div>
  )
}

function ActionPopover({
  x,
  y,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onClose,
}: {
  x: number
  y: number
  onRename: () => void
  onDelete: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      onClose()
      // 팝오버를 닫은 이 상호작용이 그 아래 요소의 클릭(파일 열기/폴더 토글 등)까지
      // 이어지지 않도록, 뒤따라올 click 이벤트 하나를 캡처 단계에서 삼킨다.
      function swallowClick(ce: MouseEvent) {
        ce.preventDefault()
        ce.stopPropagation()
      }
      document.addEventListener('click', swallowClick, { capture: true, once: true })
      setTimeout(() => document.removeEventListener('click', swallowClick, true), 0)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  const left = Math.min(x, window.innerWidth - 180)
  const top = Math.min(y, window.innerHeight - 176)

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, zIndex: 1000 }}
      className="min-w-[9rem] overflow-hidden rounded-lg border border-edge-bright bg-surface-raised text-sm shadow-xl"
    >
      <button type="button" onClick={onRename} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
        ✎ 이름 수정
      </button>
      <button type="button" onClick={onNewFile} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
        ＋ 새 파일
      </button>
      <button type="button" onClick={onNewFolder} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
        ＋ 새 폴더
      </button>
      <button type="button" onClick={onDelete} className="block w-full px-3 py-2 text-left text-danger hover:bg-surface-hover">
        🗑 삭제
      </button>
    </div>
  )
}

function Node({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: NodeCtx }) {
  const longPressTimer = useRef<number | null>(null)
  const longPressFired = useRef(false)

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    if (ctx.readOnly) return
    const touch = e.touches[0]
    longPressFired.current = false
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true
      ctx.openPopover(node.path, node.type, touch.clientX, touch.clientY)
    }, 500)
  }

  function handleClick() {
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    if (node.type === 'dir') {
      ctx.toggleDir(node.path)
      ctx.focusNode(node.path, 'dir')
    } else {
      ctx.onSelect(node.path)
      ctx.focusNode(node.path, 'file')
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (ctx.readOnly) return
    e.preventDefault()
    ctx.focusNode(node.path, node.type)
    ctx.openPopover(node.path, node.type, e.clientX, e.clientY)
  }

  const isFocused = ctx.focused?.path === node.path
  const touchProps = {
    onTouchStart,
    onTouchEnd: clearLongPress,
    onTouchMove: clearLongPress,
    onTouchCancel: clearLongPress,
    onContextMenu: handleContextMenu,
  }

  const renameEditing = ctx.editing?.mode === 'rename' && ctx.editing.path === node.path ? ctx.editing : null
  if (renameEditing) {
    return (
      <InlineInput
        value={renameEditing.value}
        onChange={ctx.setEditValue}
        onCommit={ctx.submitEdit}
        onCancel={ctx.cancelEdit}
        error={renameEditing.error}
        paddingLeft={depth * 14 + 8}
      />
    )
  }

  if (node.type === 'file') {
    const isSelected = node.path === ctx.selectedPath
    return (
      <button
        type="button"
        data-path={node.path}
        onClick={handleClick}
        onDoubleClick={() => ctx.onSelect(node.path, { preview: false })}
        {...touchProps}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm select-none [-webkit-touch-callout:none] hover:bg-surface-raised ${
          isSelected ? 'bg-surface-raised font-medium' : ''
        } ${isFocused ? 'ring-1 ring-inset ring-accent' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <PresenceBadge count={ctx.presence[node.path] ?? 0} />
      </button>
    )
  }

  const isOpen = ctx.openDirs.has(node.path)
  const createEditing =
    (ctx.editing?.mode === 'create-file' || ctx.editing?.mode === 'create-folder') && ctx.editing.parentPath === node.path
      ? ctx.editing
      : null

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        {...touchProps}
        className={`block w-full truncate rounded px-2 py-1 text-left text-sm font-medium text-ink-secondary select-none [-webkit-touch-callout:none] hover:bg-surface-raised ${
          isFocused ? 'ring-1 ring-inset ring-accent' : ''
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {isOpen ? '▾' : '▸'} {node.name}
      </button>
      {isOpen && (
        <div>
          {createEditing && (
            <InlineInput
              value={createEditing.value}
              onChange={ctx.setEditValue}
              onCommit={ctx.submitEdit}
              onCancel={ctx.cancelEdit}
              error={createEditing.error}
              placeholder={createEditing.mode === 'create-folder' ? '새 폴더 이름' : '새 파일 이름'}
              paddingLeft={(depth + 1) * 14 + 8}
            />
          )}
          {node.children?.map((child) => (
            <Node key={child.path} node={child} depth={depth + 1} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  )
}

export function FileTree({
  tree,
  selectedPath,
  readOnly,
  searchFocusSignal,
  presence,
  onSelect,
  onFileCreated,
  onFolderCreated,
  onRenamed,
  onDeleted,
}: {
  tree: TreeNode[]
  selectedPath: string | null
  readOnly: boolean
  searchFocusSignal: number
  presence: Record<string, number>
  onSelect: (path: string, opts?: { preview?: boolean }) => void
  onFileCreated: (relPath: string) => void
  onFolderCreated: () => void
  onRenamed: (oldPath: string, newPath: string, type: 'file' | 'dir') => void
  onDeleted: (path: string, type: 'file' | 'dir') => void
}) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState<Focused>(null)
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<EditingState>(null)
  const [popover, setPopover] = useState<PopoverState>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const initializedOpenDirs = useRef(false)
  // 마운트 시점 값으로 초기화 — "처음 한 번은 건너뛰기" 식 불리언 가드는 StrictMode가
  // 마운트 이펙트를 두 번 실행할 때(두 번째 호출에서 가드가 이미 소진됨) 무력화돼 사이드바를
  // 열기만 해도 검색창에 포커스가 가는(모바일 키보드가 뜨는) 버그가 있었다. 값 비교면
  // 두 번 호출돼도 항상 "신호가 안 바뀌었으니 스킵"으로 같은 결론이 난다.
  const lastHandledSearchFocusSignal = useRef(searchFocusSignal)

  useEffect(() => {
    if (searchFocusSignal === lastHandledSearchFocusSignal.current) return
    lastHandledSearchFocusSignal.current = searchFocusSignal
    searchInputRef.current?.focus()
  }, [searchFocusSignal])

  useEffect(() => {
    if (initializedOpenDirs.current || tree.length === 0) return
    initializedOpenDirs.current = true
    setOpenDirs(new Set(tree.filter((n) => n.type === 'dir').map((n) => n.path)))
  }, [tree])

  // 활성 탭이 바뀌면 사이드바에서도 해당 파일이 보이게 부모 폴더 체인을 열고 스크롤한다.
  // 사이드바가 닫혀 있으면 이 컴포넌트는 언마운트 상태 — 다시 열릴 때 이 이펙트가 반영한다.
  useEffect(() => {
    if (!selectedPath || tree.length === 0) return
    ensureOpenChain(parentOf(selectedPath))
    // openDirs 반영으로 노드가 DOM에 나타난 다음 프레임에 스크롤
    const raf = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-path="${CSS.escape(selectedPath)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, tree])

  function toggleDir(path: string) {
    setOpenDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function ensureOpenChain(dirPath: string) {
    if (!dirPath) return
    setOpenDirs((prev) => {
      const next = new Set(prev)
      const parts = dirPath.split('/')
      let acc = ''
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part
        next.add(acc)
      }
      return next
    })
  }

  function focusNode(path: string, type: 'file' | 'dir') {
    setFocused({ path, type })
  }

  function startRename(path: string, type: 'file' | 'dir') {
    if (readOnly) return
    const name = path.split('/').pop() ?? path
    setEditing({ mode: 'rename', path, type, value: name })
  }

  function startCreate(parentPath: string, kind: 'file' | 'folder') {
    if (readOnly) return
    ensureOpenChain(parentPath)
    setEditing({ mode: kind === 'file' ? 'create-file' : 'create-folder', parentPath, value: '' })
  }

  async function requestDelete(path: string, type: 'file' | 'dir') {
    if (readOnly) return
    const label = type === 'dir' ? '폴더' : '파일'
    if (!window.confirm(`${label} "${path}"을(를) 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return
    try {
      await deleteFile(path)
      setFocused((f) => (f?.path === path ? null : f))
      onDeleted(path, type)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    }
  }

  function openPopover(path: string, type: 'file' | 'dir', x: number, y: number) {
    if (readOnly) return
    setPopover({ path, type, x, y })
  }

  function cancelEdit() {
    setEditing(null)
  }

  function setEditValue(v: string) {
    setEditing((cur) => (cur ? { ...cur, value: v, error: undefined } : cur))
  }

  async function submitEdit() {
    const current = editing
    if (!current || current.busy) return

    if (current.mode === 'rename') {
      let name = current.value.trim()
      const oldName = current.path.split('/').pop() ?? current.path
      if (!name || name === oldName) {
        setEditing(null)
        return
      }
      if (current.type === 'file' && !name.toLowerCase().endsWith('.md')) name += '.md'
      name = sanitizeSegment(name)
      const parent = parentOf(current.path)
      const newPath = parent ? `${parent}/${name}` : name
      if (newPath === current.path) {
        setEditing(null)
        return
      }
      setEditing({ ...current, busy: true, error: undefined })
      try {
        await renamePath(current.path, newPath)
        setEditing(null)
        onRenamed(current.path, newPath, current.type)
      } catch (err) {
        setEditing({ ...current, busy: false, error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    const raw = current.value.trim()
    if (!raw) {
      setEditing(null)
      return
    }
    setEditing({ ...current, busy: true, error: undefined })

    if (current.mode === 'create-file') {
      const name = sanitizeSegment(raw.replace(/\.md$/i, ''))
      if (!name) {
        setEditing({ ...current, busy: false, error: '올바른 파일명을 입력하세요' })
        return
      }
      const relPath = current.parentPath ? `${current.parentPath}/${name}.md` : `${name}.md`
      try {
        const { relPath: created } = await createNewDocument(relPath, name)
        setEditing(null)
        onFileCreated(created)
      } catch (err) {
        setEditing({ ...current, busy: false, error: err instanceof Error ? err.message : String(err) })
      }
    } else {
      const name = sanitizeSegment(raw)
      if (!name) {
        setEditing({ ...current, busy: false, error: '올바른 폴더명을 입력하세요' })
        return
      }
      const relPath = current.parentPath ? `${current.parentPath}/${name}` : name
      try {
        await createFolder(relPath)
        setEditing(null)
        ensureOpenChain(relPath)
        onFolderCreated()
      } catch (err) {
        setEditing({ ...current, busy: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  function handleTreeKeyDown(e: React.KeyboardEvent) {
    if (readOnly || !focused || editing) return
    const mod = e.ctrlKey || e.metaKey
    const targetParent = focused.type === 'dir' ? focused.path : parentOf(focused.path)

    if (e.key === 'F2') {
      e.preventDefault()
      startRename(focused.path, focused.type)
    } else if (e.key === 'Delete') {
      e.preventDefault()
      requestDelete(focused.path, focused.type)
    } else if (e.key === 'Insert' && !e.shiftKey) {
      e.preventDefault()
      startCreate(targetParent, 'file')
    } else if (e.key === 'Insert' && e.shiftKey) {
      e.preventDefault()
      startCreate(targetParent, 'folder')
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      startCreate(targetParent, 'file')
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      startCreate(targetParent, 'folder')
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setQuery('')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredPaths && filteredPaths.length > 0) onSelect(filteredPaths[0])
    }
  }

  const filteredPaths = useMemo(() => {
    if (!query.trim()) return null
    const files = flattenFiles(tree)
    return files
      .map((p) => ({ path: p, score: fuzzyScore(query, p) }))
      .filter((r): r is { path: string; score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 50)
      .map((r) => r.path)
  }, [tree, query])

  const rootCreateEditing =
    (editing?.mode === 'create-file' || editing?.mode === 'create-folder') && editing.parentPath === '' ? editing : null

  const ctx: NodeCtx = {
    selectedPath,
    focused,
    openDirs,
    editing,
    readOnly,
    presence,
    onSelect,
    toggleDir,
    focusNode,
    startRename,
    startCreate,
    requestDelete,
    openPopover,
    setEditValue,
    submitEdit,
    cancelEdit,
  }

  return (
    <div className="flex h-full flex-col border-r border-edge bg-surface-deep">
      <div className="border-b border-edge p-2">
        <input
          ref={searchInputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="문서 검색… (Ctrl+P)"
          className="w-full rounded border border-edge-strong bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
        />
      </div>
      <div ref={listRef} tabIndex={-1} onKeyDown={handleTreeKeyDown} className="min-h-0 flex-1 overflow-y-auto py-2 outline-none">
        {filteredPaths !== null ? (
          filteredPaths.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-muted">결과 없음</div>
          ) : (
            filteredPaths.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => onSelect(path)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm text-ink hover:bg-surface-raised"
              >
                <span className="min-w-0 flex-1 truncate">{path}</span>
                <PresenceBadge count={presence[path] ?? 0} />
              </button>
            ))
          )
        ) : (
          <>
            {rootCreateEditing && (
              <InlineInput
                value={rootCreateEditing.value}
                onChange={setEditValue}
                onCommit={submitEdit}
                onCancel={cancelEdit}
                error={rootCreateEditing.error}
                placeholder={rootCreateEditing.mode === 'create-folder' ? '새 폴더 이름' : '새 파일 이름'}
                paddingLeft={8}
              />
            )}
            {tree.map((node) => (
              <Node key={node.path} node={node} depth={0} ctx={ctx} />
            ))}
          </>
        )}
      </div>
      {popover && !readOnly && (
        <ActionPopover
          x={popover.x}
          y={popover.y}
          onRename={() => {
            startRename(popover.path, popover.type)
            setPopover(null)
          }}
          onDelete={() => {
            requestDelete(popover.path, popover.type)
            setPopover(null)
          }}
          onNewFile={() => {
            startCreate(popover.type === 'dir' ? popover.path : parentOf(popover.path), 'file')
            setPopover(null)
          }}
          onNewFolder={() => {
            startCreate(popover.type === 'dir' ? popover.path : parentOf(popover.path), 'folder')
            setPopover(null)
          }}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}
