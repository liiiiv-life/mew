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

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

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
            onCommit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        onBlur={onCancel}
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
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
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

  const isFocused = ctx.focused?.path === node.path
  const touchProps = {
    onTouchStart,
    onTouchEnd: clearLongPress,
    onTouchMove: clearLongPress,
    onTouchCancel: clearLongPress,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
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
        onClick={handleClick}
        onDoubleClick={() => ctx.onSelect(node.path, { preview: false })}
        {...touchProps}
        className={`block w-full truncate rounded px-2 py-1 text-left text-sm select-none [-webkit-touch-callout:none] hover:bg-surface-raised ${
          isSelected ? 'bg-surface-raised font-medium' : ''
        } ${isFocused ? 'ring-1 ring-inset ring-accent' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {node.name}
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
  const initializedOpenDirs = useRef(false)

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [searchFocusSignal])

  useEffect(() => {
    if (initializedOpenDirs.current || tree.length === 0) return
    initializedOpenDirs.current = true
    setOpenDirs(new Set(tree.filter((n) => n.type === 'dir').map((n) => n.path)))
  }, [tree])

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
    if (!current) return

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
      <div tabIndex={-1} onKeyDown={handleTreeKeyDown} className="min-h-0 flex-1 overflow-y-auto py-2 outline-none">
        {filteredPaths !== null ? (
          filteredPaths.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-muted">결과 없음</div>
          ) : (
            filteredPaths.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => onSelect(path)}
                className="block w-full truncate rounded px-2 py-1 text-left text-sm text-ink hover:bg-surface-raised"
              >
                {path}
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
