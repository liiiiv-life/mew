import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../api/client'
import { copyFile, copyInto, createFolder, createNewDocument, deleteFile, downloadUrl, renamePath, setGuestAccess, uploadInto } from '../api/client'
import { flattenFiles, fuzzyScore } from '@mew/editor'
import { ConfirmDialog, keepFocusOnPress, setPathDragData } from '@mew/ui'
import { getBinding, matchesShortcut } from '@mew/shortcuts'
import { PresenceDots } from './PresenceDots'
import { CommandButtonMenu } from './CommandButtonMenu'
import { getTreeScroll, saveTreeScroll, setScrollSaveSuppressed } from '../utils/scrollMemory'
import { readFileClipboard, writeFileClipboard, type FileClipboard } from '../utils/fileClipboard'

type EditingState =
  | { mode: 'rename'; path: string; type: 'file' | 'dir'; value: string; error?: string; busy?: boolean }
  | { mode: 'create-file' | 'create-folder'; parentPath: string; value: string; error?: string; busy?: boolean }
  | null

type Focused = { path: string; type: 'file' | 'dir' } | null

type PopoverState = { path: string; type: 'file' | 'dir'; x: number; y: number } | null

export type TreePersistenceState = { openDirs: string[]; scrollTop: number }

interface NodeCtx {
  selectedPath: string | null
  focused: Focused
  openDirs: Set<string>
  editing: EditingState
  readOnly: boolean
  canUseCommands: boolean
  presence: Record<string, string[]>
  /** 지연 로드한 폴더별 직접 자식. 값이 빈 배열이면 "불러왔지만 비어 있음"이다. */
  directoryChildren: Record<string, TreeNode[]>
  loadingDirs: Set<string>
  /** 드롭 강조 중인 폴더 경로(''=루트). 이동 대상 미리보기 */
  dropDir: string | null
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
  onToggleGuestView: (node: TreeNode) => void
  onToggleGuestEdit: (node: TreeNode) => void
  // ── 드래그 이동 ──
  beginDrag: (path: string, type: 'file' | 'dir') => void
  endDrag: () => void
  canDropInto: (dir: string) => boolean
  onDragOverDir: (dir: string) => void
  onDropDir: (dir: string) => void
  /** 바깥(파일 탐색기)에서 끌어온 파일을 그 폴더에 업로드 */
  onDropFiles: (dir: string, files: FileList) => void
}

/**
 * 바깥에서 끌어온 파일인지 — dragover에서는 DataTransfer가 보호 모드라 `types`만 읽을 수 있다.
 * 사이드바 안에서 끄는 항목은 파일이 아니므로 이 목록에 'Files'가 없다.
 */
function hasExternalFiles(dt: DataTransfer | null | undefined): boolean {
  return dt ? Array.prototype.includes.call(dt.types, 'Files') : false
}

function parentOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

// 검색 결과 경로를 짧게: 디렉터리는 첫 글자만, 파일명은 그대로
// (products/notes/2026/drafts/plan-01.md → p/n/2/d/plan-01.md).
// Array.from으로 잘라 한글 등 멀티바이트 첫 글자도 안전하게 뽑는다.
function abbreviatePath(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 1) return path
  const dirs = parts.slice(0, -1).map((seg) => (seg ? (Array.from(seg)[0] ?? '') : ''))
  return [...dirs, parts[parts.length - 1]].join('/')
}

// MOC(Map of Content)는 파일명 그대로 목록에 섞이지 않는다 — 자기 폴더의 첫 줄에 지도 아이콘 +
// "Map Of Contents"로 고정된다. 정렬용 언더스코어를 붙인 _MOC.md도 같은 문서다
// (server/documents.ts·git.ts와 같은 규칙).
const MOC_FILE = /^_?MOC\.md$/i

function isMocNode(node: TreeNode): boolean {
  return node.type === 'file' && MOC_FILE.test(node.name)
}

function MapIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6 9 3l6 3 6-3v15l-6 3-6-3-6 3Z" />
      <path d="M9 3v15" />
      <path d="M15 6v15" />
    </svg>
  )
}

/** 일반 폴더의 펼침 상태는 삼각형 대신 폴더 모양으로 드러낸다. */
function FolderIcon({ open, size = 14 }: { open: boolean; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {open ? (
        <path d="M3 7h5l2 3h11l-2 10H5L3 7Z" />
      ) : (
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      )}
    </svg>
  )
}

// MOC 한 줄 — 파일명(MOC.md/_MOC.md) 대신 지도 아이콘 + "Map Of Contents"로, 그 폴더의 첫 항목에 고정한다.
// 어느 깊이에서든 같은 모양이라 "이 폴더의 입구"라는 뜻이 한눈에 읽힌다.
function MocItem({
  path,
  depth,
  active,
  presenceColors,
  onSelect,
}: {
  path: string
  depth: number
  active: boolean
  presenceColors: string[]
  onSelect: (path: string, opts?: { preview?: boolean }) => void
}) {
  return (
    <button
      type="button"
      data-path={path}
      onClick={() => onSelect(path)}
      onDoubleClick={() => onSelect(path, { preview: false })}
      title={path}
      className={`mb-0.5 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm select-none hover:bg-surface-raised ${
        active ? 'bg-surface-raised font-medium text-ink' : 'text-ink-secondary'
      }`}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      <MapIcon size={14} />
      <span className="min-w-0 flex-1 truncate">Map Of Contents</span>
      <PresenceDots colors={presenceColors} />
    </button>
  )
}

type SortMode = 'name' | 'ext'
const SORT_KEY = 'mew:tree-sort'

/** 펼쳐 둔 폴더는 프로젝트마다 따로 기억한다 — 브라우저를 껐다 켜도 보던 모양 그대로 뜬다 */
const openDirsKey = (project: string) => `mew:tree-open:${project}`

/** 저장된 펼침 목록. 저장된 적이 없으면 null(= 처음 여는 프로젝트라 기본값을 쓴다) */
function loadOpenDirs(project: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(openDirsKey(project))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((p): p is string => typeof p === 'string')) : null
  } catch {
    return null
  }
}

// 만들거나 옮기는 데는 성공했는데 그 결과가 내 트리에는 안 뜰 때(숨김 목록·확장자 필터) 띄우는 안내.
// 조용히 아무 일도 없었던 것처럼 보이는 게 제일 나쁘다 — 파일은 디스크에 실제로 있다.
// owner·manager는 필터가 없어 이 안내를 볼 일이 없다 (server/reqAuth.ts의 seesEveryFile).
const NOT_ALLOWED = '권한이 없습니다'

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// 확장자순: 폴더는 서버 순서(docs 최상위 랭킹 포함)를 그대로 두고, 파일만 확장자별로 묶는다
// (a.png a.svg b.png b.svg → a.png b.png a.svg b.svg) — sort는 stable이라 0 반환 = 순서 유지
function sortTreeByExt(nodes: TreeNode[]): TreeNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (a.type === 'dir') return 0
    return extOf(a.name).localeCompare(extOf(b.name)) || a.name.localeCompare(b.name)
  })
  return sorted.map((n) => (n.type === 'dir' && n.children ? { ...n, children: sortTreeByExt(n.children) } : n))
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
  onDuplicate,
  onCopyClip,
  onCutClip,
  onPasteClip,
  onDownload,
  onDelete,
  onNewFile,
  onNewFolder,
  onUpload,
  onClose,
}: {
  x: number
  y: number
  /** 루트(빈 공간) 메뉴에서는 대상 경로가 없어 undefined로 숨긴다 */
  onRename?: () => void
  /** 복제 — 파일에만 제공(폴더는 undefined로 숨긴다) */
  onDuplicate?: () => void
  onCopyClip?: () => void
  onCutClip?: () => void
  /** 클립보드에 담긴 항목이 있을 때만 제공 — 없으면 undefined로 숨긴다 */
  onPasteClip?: () => void
  onDownload?: () => void
  onDelete?: () => void
  onNewFile: () => void
  onNewFolder: () => void
  onUpload: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // 항목 개수(파일/폴더/루트)마다 실제 높이가 달라 고정 상수로는 못 잡는다 —
  // 렌더된 실측 크기로 화면 밖을 벗어나지 않게 클램프한다.
  const [pos, setPos] = useState({ left: x, top: y })

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

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setPos({
      left: Math.max(0, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(0, Math.min(y, window.innerHeight - rect.height - 4)),
    })
  }, [x, y])

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000 }}
      className="min-w-[9rem] overflow-hidden rounded-lg border border-edge-bright bg-surface-raised text-sm shadow-xl"
    >
      {onRename && (
        <button type="button" onClick={onRename} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
          ✎ 이름 수정
        </button>
      )}
      {onDuplicate && (
        <button type="button" onClick={onDuplicate} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
          ⧉ 복제
        </button>
      )}
      {onCopyClip && (
        <button type="button" onClick={onCopyClip} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
          ⎘ 복사 (Ctrl+C)
        </button>
      )}
      {onCutClip && (
        <button type="button" onClick={onCutClip} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
          ✂ 잘라내기 (Ctrl+X)
        </button>
      )}
      {onPasteClip && (
        <button type="button" onClick={onPasteClip} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
          📋 붙여넣기 (Ctrl+V)
        </button>
      )}
      {onDownload && (
        <button type="button" onClick={onDownload} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
          ⬇ 다운로드
        </button>
      )}
      <button type="button" onClick={onNewFile} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
        ＋ 새 파일
      </button>
      <button type="button" onClick={onNewFolder} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
        ＋ 새 폴더
      </button>
      <button type="button" onClick={onUpload} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">
        ⬆ 업로드
      </button>
      {onDelete && (
        <button type="button" onClick={onDelete} className="block w-full px-3 py-2 text-left text-danger hover:bg-surface-hover">
          🗑 삭제
        </button>
      )}
    </div>
  )
}

// member+ 전용 — 눈/연필 아이콘으로 이 경로의 게스트 열람/편집 허용을 직접 토글한다.
// 서버가 edit=true면 view도 강제로 켠다(편집은 열람을 전제).
function GuestAccessIcons({
  node,
  onToggleView,
  onToggleEdit,
}: {
  node: TreeNode
  onToggleView: (node: TreeNode) => void
  onToggleEdit: (node: TreeNode) => void
}) {
  const view = node.guestAccess?.view ?? false
  const edit = node.guestAccess?.edit ?? false
  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-0.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleView(node)
        }}
        title={view ? '게스트 열람 허용됨 — 클릭하여 해제' : '게스트 열람 허용'}
        aria-label="게스트 열람 권한 전환"
        className={`flex h-5 w-5 items-center justify-center rounded hover:bg-surface-hover ${view ? 'text-accent' : 'text-ink-faint'}`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleEdit(node)
        }}
        title={edit ? '게스트 편집 허용됨 — 클릭하여 해제' : '게스트 편집 허용'}
        aria-label="게스트 편집 권한 전환"
        className={`flex h-5 w-5 items-center justify-center rounded hover:bg-surface-hover ${edit ? 'text-accent' : 'text-ink-faint'}`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
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
      <div className="flex w-full items-center gap-0.5">
        <button
          type="button"
          data-path={node.path}
          draggable={!ctx.readOnly}
          onDragStart={(e) => {
            setPathDragData(e.dataTransfer, node.path)
            ctx.beginDrag(node.path, 'file')
          }}
          onDragEnd={ctx.endDrag}
          onClick={handleClick}
          onDoubleClick={() => ctx.onSelect(node.path, { preview: false })}
          {...touchProps}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-sm select-none [-webkit-touch-callout:none] hover:bg-surface-raised ${
            isSelected ? 'bg-surface-raised font-medium' : ''
          } ${isFocused ? 'ring-1 ring-inset ring-accent' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <PresenceDots colors={ctx.presence[node.path] ?? []} />
        </button>
        {!ctx.readOnly && (
          <GuestAccessIcons node={node} onToggleView={ctx.onToggleGuestView} onToggleEdit={ctx.onToggleGuestEdit} />
        )}
      </div>
    )
  }

  const isOpen = ctx.openDirs.has(node.path)
  const isDropTarget = ctx.dropDir === node.path
  // 이 폴더의 MOC는 파일 목록에서 빼고, 펼쳤을 때 맨 첫 줄에 따로 세운다
  const nodeChildren = node.children ?? ctx.directoryChildren[node.path]
  const moc = nodeChildren?.find(isMocNode) ?? null
  const children = moc ? nodeChildren?.filter((c) => !isMocNode(c)) : nodeChildren
  const createEditing =
    (ctx.editing?.mode === 'create-file' || ctx.editing?.mode === 'create-folder') && ctx.editing.parentPath === node.path
      ? ctx.editing
      : null

  return (
    <div
      // 폴더(및 그 안의 파일)로 드롭하면 이 폴더로 이동한다. 자식 폴더는 자기 dragover에서
      // stopPropagation하므로, 하위 파일 위에서 놓으면 가장 가까운 폴더(=여기)가 대상이 된다.
      onDragOver={(e) => {
        // 바깥에서 끌어온 파일이면 이 폴더에 업로드, 사이드바 항목이면 이 폴더로 이동
        const external = hasExternalFiles(e.dataTransfer)
        if (external ? ctx.readOnly : !ctx.canDropInto(node.path)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = external ? 'copy' : 'move'
        ctx.onDragOverDir(node.path)
      }}
      onDrop={(e) => {
        if (hasExternalFiles(e.dataTransfer)) {
          if (ctx.readOnly) return
          e.preventDefault()
          e.stopPropagation()
          ctx.onDropFiles(node.path, e.dataTransfer.files)
          return
        }
        if (!ctx.canDropInto(node.path)) return
        e.preventDefault()
        e.stopPropagation()
        ctx.onDropDir(node.path)
      }}
    >
      <div className="flex w-full items-center gap-0.5">
        <button
          type="button"
          draggable={!ctx.readOnly}
          onDragStart={(e) => {
            setPathDragData(e.dataTransfer, node.path, 'dir')
            ctx.beginDrag(node.path, 'dir')
          }}
          onDragEnd={ctx.endDrag}
          onClick={handleClick}
          {...touchProps}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-medium text-ink-secondary select-none [-webkit-touch-callout:none] hover:bg-surface-raised ${
            isFocused ? 'ring-1 ring-inset ring-accent' : ''
          } ${isDropTarget ? 'bg-accent/15 ring-1 ring-accent' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <FolderIcon open={isOpen} />
          <span className="min-w-0 truncate">{node.name}</span>
          {node.project && (
            <span className="ml-1 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
              Project
            </span>
          )}
        </button>
        {node.project && ctx.canUseCommands && <CommandButtonMenu project={node.name} />}
        {!ctx.readOnly && (
          <GuestAccessIcons node={node} onToggleView={ctx.onToggleGuestView} onToggleEdit={ctx.onToggleGuestEdit} />
        )}
      </div>
      {isOpen && (
        <div>
          {moc && (
            <MocItem
              path={moc.path}
              depth={depth + 1}
              active={moc.path === ctx.selectedPath}
              presenceColors={ctx.presence[moc.path] ?? []}
              onSelect={ctx.onSelect}
            />
          )}
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
          {ctx.loadingDirs.has(node.path) && (
            <div className="py-1 text-xs text-ink-muted" style={{ paddingLeft: (depth + 1) * 14 + 8 }}>불러오는 중…</div>
          )}
          {children?.map((child) => (
            <Node key={child.path} node={child} depth={depth + 1} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  )
}

export function FileTree({
  tree,
  project,
  stateKey,
  accountState,
  onAccountStateChange,
  workspacePath = null,
  selectedPath,
  readOnly,
  canUseCommands = false,
  compact = false,
  roots,
  commands,
  loadChildren,
  prefetchRootChildren = false,
  searchFocusSignal,
  newFileSignal,
  revealSignal,
  presence,
  onSelect,
  onFileCreated,
  onFolderCreated,
  onRenamed,
  onDeleted,
  onGuestAccessChanged,
  onNotice,
  registerSearchCancel,
}: {
  tree: TreeNode[]
  /** 펼친 폴더·스크롤을 프로젝트별로 기억하는 열쇠 (이 컴포넌트는 key={project}로 갈아 끼워진다) */
  project: string
  /** API 프로젝트명과 별개로, 트리 UI 상태를 구분하는 열쇠. */
  stateKey?: string
  /** 로그인 계정에서 복원한 폴더·스크롤 상태. 없으면 기존 브라우저 저장값을 최초 이관 원본으로 쓴다. */
  accountState?: TreePersistenceState
  onAccountStateChange?: (state: TreePersistenceState) => void
  /** 다른 루트 프로젝트로 붙여넣을 때 원본을 다시 찾는 절대경로. */
  workspacePath?: string | null
  selectedPath: string | null
  readOnly: boolean
  canUseCommands?: boolean
  /** 다른 트리 안에 넣을 때 검색·정렬 도구와 독립 스크롤을 숨긴다. */
  compact?: boolean
  /** 검색창 아래에 서는 Documents/프로젝트 가상 폴더 */
  roots?: React.ReactNode
  /** 파일 목록 흐름에 끼우는 루트 프로젝트 명령 등 추가 항목 */
  commands?: React.ReactNode
  /** 폴더를 펼칠 때 해당 폴더의 직접 자식만 불러온다. 없으면 기존 완전 트리처럼 동작한다. */
  loadChildren?: (path: string) => Promise<TreeNode[]>
  /** 첫 화면을 그린 뒤 최상위 폴더의 직접 자식만 천천히 미리 읽는다. 더 깊은 경로는 펼칠 때 읽는다. */
  prefetchRootChildren?: boolean
  searchFocusSignal: number
  /** Alt+N — 새 파일 이름 입력 열기. parentPath가 null이면 트리의 선택 항목 기준 */
  newFileSignal: { n: number; parentPath: string | null }
  /** 오를 때마다 지금 문서 자리를 다시 드러낸다 — 이미 열린 탭을 다시 눌렀을 때도 반응하려고 신호로 받는다 */
  revealSignal: number
  presence: Record<string, string[]>
  onSelect: (path: string, opts?: { preview?: boolean }) => void
  onFileCreated: (relPath: string) => void
  onFolderCreated: () => void
  onRenamed: (oldPath: string, newPath: string, type: 'file' | 'dir') => void
  onDeleted: (path: string, type: 'file' | 'dir') => void
  /** member+ 전용 — 눈/연필 아이콘으로 게스트 열람/편집 규칙을 바꾼 뒤 트리를 다시 불러오도록 호출 */
  onGuestAccessChanged: () => void
  /** 흐름을 끊지 않는 짧은 안내(토스트) — 실패는 아니지만 말해줘야 하는 것들 */
  onNotice: (message: string) => void
  /** 검색창 밖에 포커스가 있어도 사이드바의 첫 Esc가 검색부터 취소할 수 있게 App에 등록한다 */
  registerSearchCancel: (cancel: (() => boolean) | null) => void
}) {
  const persistedProject = stateKey ?? project
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>(() => (localStorage.getItem(SORT_KEY) === 'ext' ? 'ext' : 'name'))
  const [focused, setFocused] = useState<Focused>(null)
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set(accountState?.openDirs ?? loadOpenDirs(persistedProject) ?? []))
  const [directoryChildren, setDirectoryChildren] = useState<Record<string, TreeNode[]>>({})
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const directoryChildrenRef = useRef(directoryChildren)
  directoryChildrenRef.current = directoryChildren
  const loadingDirsRef = useRef(loadingDirs)
  loadingDirsRef.current = loadingDirs
  // 저장된 펼침 상태가 있으면(전부 접어 둔 빈 목록이어도) 아래 "처음엔 최상위 폴더를 모두 편다"를 건너뛴다
  const [hadSavedOpenDirs] = useState(() => accountState !== undefined || loadOpenDirs(persistedProject) !== null)
  const [editing, setEditing] = useState<EditingState>(null)
  const [popover, setPopover] = useState<PopoverState>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; type: 'file' | 'dir' } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [clipboard, setClipboardState] = useState<FileClipboard>(() => readFileClipboard())
  const [dropDir, setDropDir] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const queryRef = useRef(query)
  queryRef.current = query
  const setClipboard = useCallback((value: FileClipboard) => {
    writeFileClipboard(value)
    setClipboardState(value)
  }, [])
  const listRef = useRef<HTMLDivElement>(null)
  const treeScrollRef = useRef(accountState?.scrollTop ?? getTreeScroll(persistedProject) ?? 0)
  // 팝오버의 "업로드"는 파일 선택창을 띄워야 해서 클릭 시점의 대상 폴더를 잠깐 들고 있는다
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadDirRef = useRef('')
  function triggerUpload(dir: string) {
    uploadDirRef.current = dir
    uploadInputRef.current?.click()
  }
  // 빈 영역 롱프레스(모바일) — Node의 onTouchStart와 같은 500ms 타이머 패턴
  const rootLongPressTimer = useRef<number | null>(null)
  function clearRootLongPress() {
    if (rootLongPressTimer.current !== null) {
      window.clearTimeout(rootLongPressTimer.current)
      rootLongPressTimer.current = null
    }
  }
  // 드래그 중인 항목 — dragover가 초당 여러 번 발화하므로 상태 대신 ref로 들고 다닌다
  const draggingRef = useRef<{ path: string; type: 'file' | 'dir' } | null>(null)
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
    registerSearchCancel(() => {
      if (!queryRef.current) return false
      setQuery('')
      return true
    })
    return () => registerSearchCancel(null)
  }, [registerSearchCancel])

  // Alt+N — 0으로 초기화(마운트 시점 값이 아니라): 사이드바가 닫힌 채 Alt+N을 누르면
  // 신호가 먼저 오르고 이 컴포넌트가 그 뒤에 마운트되므로, 마운트 직후에도 처리해야 한다
  const lastHandledNewFileSignal = useRef(0)

  useEffect(() => {
    if (newFileSignal.n === lastHandledNewFileSignal.current) return
    lastHandledNewFileSignal.current = newFileSignal.n
    const parent =
      newFileSignal.parentPath ?? (focused ? (focused.type === 'dir' ? focused.path : parentOf(focused.path)) : '')
    startCreate(parent, 'file')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 신호가 오를 때만 실행하는 이벤트성 이펙트
  }, [newFileSignal])

  // 처음 여는 프로젝트만 최상위 폴더를 모두 펴 준다 — 기억해 둔 모양이 있으면 그대로 둔다
  useEffect(() => {
    if (hadSavedOpenDirs || initializedOpenDirs.current || tree.length === 0) return
    initializedOpenDirs.current = true
    setOpenDirs(new Set(tree.filter((n) => n.type === 'dir').map((n) => n.path)))
  }, [tree, hadSavedOpenDirs])

  // 루트 목록이 새로 왔다는 것은 파일 조작·watcher 갱신 또는 프로젝트 전환이다. 이미 펼쳐 둔
  // 폴더의 오래된 자식은 버리고, 다음에 펼칠 때 최신 한 단계 목록을 읽는다.
  useEffect(() => {
    directoryChildrenRef.current = {}
    loadingDirsRef.current = new Set()
    setDirectoryChildren({})
    setLoadingDirs(new Set())
  }, [tree])

  useEffect(() => {
    localStorage.setItem(openDirsKey(persistedProject), JSON.stringify([...openDirs]))
    onAccountStateChange?.({ openDirs: [...openDirs], scrollTop: treeScrollRef.current })
  }, [openDirs, persistedProject, onAccountStateChange])

  // 사이드바 스크롤 복원 — 트리가 처음 들어온 프레임에 한 번만. 그 뒤로는 사용자가 굴린 대로 두고,
  // 활성 파일 드러내기(위 이펙트)는 이미 보이면 아무것도 하지 않으므로 복원 위치를 뺏지 않는다
  const restoredScroll = useRef(false)
  useEffect(() => {
    if (restoredScroll.current || tree.length === 0) return
    restoredScroll.current = true
    const top = accountState?.scrollTop ?? getTreeScroll(persistedProject)
    if (top === null) return
    const raf = requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = top
    })
    return () => cancelAnimationFrame(raf)
  }, [tree, persistedProject, accountState])

  // 활성 탭이 바뀌면 사이드바에서도 해당 파일이 보이게 부모 폴더 체인을 열고 스크롤한다.
  // 사이드바가 닫혀 있으면 이 컴포넌트는 언마운트 상태 — 다시 열릴 때 이 이펙트가 반영한다.
  // revealSignal도 함께 본다 — **이미 열린 탭을 다시 눌렀을 때**는 경로가 그대로라 그 신호만이 유일한 단서다.
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
  }, [selectedPath, tree, revealSignal])

  const loadDir = useCallback((path: string) => {
    if (!loadChildren || directoryChildrenRef.current[path] !== undefined || loadingDirsRef.current.has(path)) return
    loadingDirsRef.current = new Set(loadingDirsRef.current).add(path)
    setLoadingDirs(loadingDirsRef.current)
    void loadChildren(path)
      .then((children) => {
        directoryChildrenRef.current = { ...directoryChildrenRef.current, [path]: children }
        setDirectoryChildren(directoryChildrenRef.current)
      })
      .catch((err: unknown) => onNotice(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        const next = new Set(loadingDirsRef.current)
        next.delete(path)
        loadingDirsRef.current = next
        setLoadingDirs(next)
      })
  }, [loadChildren, onNotice])

  function toggleDir(path: string) {
    const opening = !openDirs.has(path)
    setOpenDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (opening) loadDir(path)
  }

  // 프로젝트 전환 뒤에는 루트 목록을 먼저 화면에 내보낸다. 그 다음 프레임부터 최상위 폴더만
  // 하나씩 미리 읽어, 첫 화면을 전체 재귀 탐색으로 막지 않으면서 곧 펼칠 폴더는 빠르게 연다.
  useEffect(() => {
    if (!prefetchRootChildren || !loadChildren || tree.length === 0) return
    const paths = tree.filter((node) => node.type === 'dir').map((node) => node.path)
    let index = 0
    let timer: number | null = null
    const next = () => {
      if (index >= paths.length) return
      loadDir(paths[index++])
      timer = window.setTimeout(next, 50)
    }
    const frame = requestAnimationFrame(() => { timer = window.setTimeout(next, 0) })
    return () => {
      cancelAnimationFrame(frame)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [loadChildren, loadDir, prefetchRootChildren, tree])

  function ensureOpenChain(dirPath: string) {
    if (!dirPath) return
    setOpenDirs((prev) => {
      const parts = dirPath.split('/')
      const missing: string[] = []
      let acc = ''
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part
        if (!prev.has(acc)) missing.push(acc)
      }
      // 이미 다 열려 있으면 그대로 둔다 — 탭을 누를 때마다 새 Set을 만들면 괜한 리렌더와 저장이 따라온다
      if (missing.length === 0) return prev
      const next = new Set(prev)
      for (const dir of missing) next.add(dir)
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

  async function requestCopy(path: string) {
    if (readOnly) return
    try {
      const { relPath, hidden } = await copyFile(path, project)
      if (hidden) onNotice(NOT_ALLOWED)
      // 새 파일 생성과 같은 후처리 — 트리 갱신 + 복사본을 탭으로 연다
      onFileCreated(relPath)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  function requestDownload(path: string) {
    const a = document.createElement('a')
    a.href = downloadUrl(path, project)
    a.download = path.split('/').pop() ?? path
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  function requestDelete(path: string, type: 'file' | 'dir') {
    if (readOnly) return
    setDeleteTarget({ path, type })
  }

  async function deleteConfirmed() {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target) return
    try {
      await deleteFile(target.path, project)
      setFocused((f) => (f?.path === target.path ? null : f))
      onDeleted(target.path, target.type)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  function openPopover(path: string, type: 'file' | 'dir', x: number, y: number) {
    if (readOnly) return
    setPopover({ path, type, x, y })
  }

  function handleToggleGuestView(node: TreeNode) {
    if (readOnly) return
    const current = node.guestAccess ?? { view: false, edit: false }
    const nextView = !current.view
    setGuestAccess(node.path, nextView, nextView ? current.edit : false, project)
      .then(onGuestAccessChanged)
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : String(err)))
  }

  function handleToggleGuestEdit(node: TreeNode) {
    if (readOnly) return
    const current = node.guestAccess ?? { view: false, edit: false }
    const nextEdit = !current.edit
    setGuestAccess(node.path, nextEdit ? true : current.view, nextEdit, project)
      .then(onGuestAccessChanged)
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : String(err)))
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
      // .md 문서만 확장자를 보정한다 — 미디어·코드 파일 이름에 .md를 덧붙이면 안 된다
      if (current.type === 'file' && oldName.toLowerCase().endsWith('.md') && !name.toLowerCase().endsWith('.md')) name += '.md'
      name = sanitizeSegment(name)
      const parent = parentOf(current.path)
      const newPath = parent ? `${parent}/${name}` : name
      if (newPath === current.path) {
        setEditing(null)
        return
      }
      setEditing({ ...current, busy: true, error: undefined })
      try {
        const { hidden } = await renamePath(current.path, newPath, project)
        setEditing(null)
        // 바꾼 이름이 트리에 안 뜨는 종류면(확장자·숨김 목록) 사라진 것처럼 보인다 — 이유를 알린다
        if (hidden) onNotice(NOT_ALLOWED)
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
        const { relPath: created, hidden } = await createNewDocument(relPath, name, project)
        setEditing(null)
        if (hidden) onNotice(NOT_ALLOWED)
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
        const { hidden } = await createFolder(relPath, project)
        setEditing(null)
        if (hidden) onNotice(NOT_ALLOWED)
        ensureOpenChain(relPath)
        onFolderCreated()
      } catch (err) {
        setEditing({ ...current, busy: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  function basenameOf(p: string): string {
    return p.split('/').pop() ?? p
  }

  // 폴더를 자기 자신 또는 그 하위 경로로 옮기거나 복사하는 것을 막는다(무한 재귀·경로 소실 방지)
  function isSelfOrDescendant(srcPath: string, srcType: 'file' | 'dir', destDir: string): boolean {
    return srcType === 'dir' && (destDir === srcPath || destDir.startsWith(`${srcPath}/`))
  }

  // 드래그 이동·잘라내기 붙여넣기 — 내부적으로 terminal mv(=fs.renameSync)인 /rename을 재사용한다
  async function moveInto(srcPath: string, srcType: 'file' | 'dir', destDir: string) {
    if (readOnly) return
    const newPath = destDir ? `${destDir}/${basenameOf(srcPath)}` : basenameOf(srcPath)
    if (newPath === srcPath) return // 같은 위치로의 이동 — 무동작
    if (isSelfOrDescendant(srcPath, srcType, destDir)) {
      setErrorMsg('폴더를 자기 자신 안으로는 옮길 수 없습니다')
      return
    }
    try {
      const { hidden } = await renamePath(srcPath, newPath, project)
      if (hidden) onNotice(NOT_ALLOWED)
      onRenamed(srcPath, newPath, srcType)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  // 복사 붙여넣기 — 내부적으로 terminal cp(=fs.cpSync, 폴더 재귀)인 /copy-into를 호출한다
  async function copyIntoDir(srcPath: string, srcType: 'file' | 'dir', destDir: string, sourceWorkspacePath: string | null) {
    if (readOnly) return
    if (sourceWorkspacePath === workspacePath && isSelfOrDescendant(srcPath, srcType, destDir)) {
      setErrorMsg('폴더를 자기 자신 안으로는 복사할 수 없습니다')
      return
    }
    try {
      const { relPath, hidden } = await copyInto(srcPath, destDir, project, sourceWorkspacePath === workspacePath ? null : sourceWorkspacePath)
      if (hidden) onNotice(NOT_ALLOWED)
      if (srcType === 'file') onFileCreated(relPath)
      else onFolderCreated()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  // Ctrl+V / 우클릭 붙여넣기 — cut은 이동(클립보드 비움), copy는 복사(여러 번 붙일 수 있게 유지)
  async function pasteInto(destDir: string) {
    const clip = clipboard
    if (!clip || readOnly) return
    if (clip.mode === 'cut') {
      if (clip.workspacePath !== workspacePath) {
        setErrorMsg('다른 프로젝트로는 잘라내기 대신 복사해 붙여넣으세요')
        return
      }
      await moveInto(clip.path, clip.type, destDir)
      setClipboard(null)
    } else {
      await copyIntoDir(clip.path, clip.type, destDir, clip.workspacePath)
    }
    ensureOpenChain(destDir)
  }

  function beginDrag(path: string, type: 'file' | 'dir') {
    draggingRef.current = { path, type }
    // 드래그 동안 스크롤 저장 잠금 — 브라우저 자동 스크롤이 저장값을 오염시킨다 (scrollMemory 주석 참고)
    setScrollSaveSuppressed(true)
  }

  function endDrag() {
    draggingRef.current = null
    setDropDir(null)
    setScrollSaveSuppressed(false)
  }

  function canDropInto(dir: string): boolean {
    const item = draggingRef.current
    if (!item || readOnly) return false
    return !isSelfOrDescendant(item.path, item.type, dir)
  }

  function onDragOverDir(dir: string) {
    setDropDir((cur) => (cur === dir ? cur : dir))
  }

  function onDropDir(dir: string) {
    const item = draggingRef.current
    draggingRef.current = null
    setDropDir(null)
    if (item) void moveInto(item.path, item.type, dir)
  }

  // 바깥(파일 탐색기)에서 끌어온 파일을 놓은 폴더에 그대로 업로드한다. 여러 개면 순서대로 —
  // 이름 충돌 회피가 서버에서 "이미 있나" 확인으로 이뤄지므로 동시에 보내면 같은 이름을 집을 수 있다.
  async function uploadFilesInto(dir: string, fileList: FileList) {
    if (readOnly) return
    const files = Array.from(fileList)
    if (files.length === 0) return
    setDropDir(null)
    let hiddenAny = false
    try {
      for (const file of files) {
        const { hidden } = await uploadInto(file, dir, project)
        hiddenAny = hiddenAny || hidden === true
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
    if (dir) ensureOpenChain(dir)
    onFolderCreated() // = 트리 새로고침
    if (hiddenAny) onNotice(NOT_ALLOWED)
  }

  function handleTreeKeyDown(e: React.KeyboardEvent) {
    if (readOnly || !focused || editing) return
    const targetParent = focused.type === 'dir' ? focused.path : parentOf(focused.path)

    // Ctrl/⌘ + C(복사)·X(잘라내기)·V(붙여넣기)·D(복제). 트리 노드는 select-none이라
    // 가로챌 텍스트 선택이 없어 네이티브 클립보드를 덮어써도 안전하다.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'c') {
        e.preventDefault()
        setClipboard({ path: focused.path, type: focused.type, mode: 'copy', workspacePath })
        return
      }
      if (k === 'x') {
        e.preventDefault()
        setClipboard({ path: focused.path, type: focused.type, mode: 'cut', workspacePath })
        return
      }
      if (k === 'v') {
        e.preventDefault()
        void pasteInto(targetParent)
        return
      }
      if (k === 'd') {
        e.preventDefault()
        if (focused.type === 'file') void requestCopy(focused.path) // 폴더 복제는 금지
        return
      }
    }

    if (matchesShortcut(e, getBinding('treeRename'))) {
      e.preventDefault()
      startRename(focused.path, focused.type)
    } else if (matchesShortcut(e, getBinding('treeDelete'))) {
      e.preventDefault()
      requestDelete(focused.path, focused.type)
    } else if (matchesShortcut(e, getBinding('treeNewFile'))) {
      e.preventDefault()
      startCreate(targetParent, 'file')
    } else if (matchesShortcut(e, getBinding('treeNewFolder'))) {
      e.preventDefault()
      startCreate(targetParent, 'folder')
    } else if (matchesShortcut(e, getBinding('treeNewFileAlt'))) {
      e.preventDefault()
      startCreate(targetParent, 'file')
    } else if (matchesShortcut(e, getBinding('treeNewFolderAlt'))) {
      e.preventDefault()
      startCreate(targetParent, 'folder')
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      // 검색어가 있으면 그것만 지우고 멈춘다 — 흘려보내면 오버레이 스택이 사이드바까지 닫는다.
      // 이미 비어 있으면 그대로 흘려보내 사이드바가 닫히게 둔다 (Esc 두 번 = 검색 취소 → 닫기)
      if (!query) return
      e.preventDefault()
      e.stopPropagation()
      setQuery('')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredPaths && filteredPaths.length > 0) onSelect(filteredPaths[0])
    }
  }

  const sortedTree = useMemo(() => (sortMode === 'ext' ? sortTreeByExt(tree) : tree), [tree, sortMode])

  // 최상위 MOC는 담을 폴더가 없으니 여기서 직접 세운다 — 프로젝트 전체의 입구라서 어떤 폴더보다 위에.
  // 하위 폴더의 MOC는 각 Node가 자기 첫 줄에 같은 모양으로 세운다.
  const rootMoc = useMemo(() => sortedTree.find(isMocNode) ?? null, [sortedTree])
  const rootNodes = useMemo(() => (rootMoc ? sortedTree.filter((n) => !isMocNode(n)) : sortedTree), [sortedTree, rootMoc])

  function toggleSortMode() {
    setSortMode((prev) => {
      const next = prev === 'name' ? 'ext' : 'name'
      localStorage.setItem(SORT_KEY, next)
      return next
    })
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
    canUseCommands,
    presence,
    directoryChildren,
    loadingDirs,
    dropDir,
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
    onToggleGuestView: handleToggleGuestView,
    onToggleGuestEdit: handleToggleGuestEdit,
    beginDrag,
    endDrag,
    canDropInto,
    onDragOverDir,
    onDropDir,
    onDropFiles: (dir, files) => void uploadFilesInto(dir, files),
  }

  return (
    <div className={compact ? 'bg-surface-deep' : 'flex h-full flex-col border-r border-edge bg-surface-deep'}>
      {!compact && <div className="flex items-center gap-1.5 border-b border-edge p-2">
        <div className="relative min-w-0 flex-1" onMouseDown={keepFocusOnPress}>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="문서 검색… (Ctrl+P)"
            className="w-full rounded border border-edge-strong bg-surface py-1 pr-7 pl-2 text-xs text-ink outline-none focus:border-accent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-sm leading-none text-ink-muted hover:bg-surface-raised hover:text-ink"
              title="검색 취소"
              aria-label="파일 검색 지우기"
            >
              ×
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={toggleSortMode}
          className="shrink-0 rounded border border-edge-strong px-1.5 py-1 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink"
          title={sortMode === 'name' ? '정렬: 이름순 (클릭 → 확장자순)' : '정렬: 확장자순 (클릭 → 이름순)'}
          aria-label="정렬 방식 전환"
        >
          {sortMode === 'name' ? '가나다' : '확장자'}
        </button>
      </div>}
      <div
        ref={listRef}
        tabIndex={-1}
        // 스크롤 위치도 기억한다 — 저장은 문서 스크롤과 같은 저장소가 모아서 쓴다(utils/scrollMemory.ts)
        onScroll={(e) => {
          const scrollTop = e.currentTarget.scrollTop
          treeScrollRef.current = scrollTop
          saveTreeScroll(persistedProject, scrollTop)
          onAccountStateChange?.({ openDirs: [...openDirs], scrollTop })
        }}
        onKeyDown={handleTreeKeyDown}
        onContextMenu={(e) => {
          // 노드 위 우클릭은 Node.handleContextMenu가 먼저 처리하고 버블링되어 여기 닿는다 —
          // e.target이 컨테이너 자신일 때만(=빈 영역) 루트 메뉴를 연다.
          if (readOnly || e.target !== e.currentTarget) return
          e.preventDefault()
          openPopover('', 'dir', e.clientX, e.clientY)
        }}
        onTouchStart={(e) => {
          if (readOnly || e.target !== e.currentTarget) return
          const touch = e.touches[0]
          rootLongPressTimer.current = window.setTimeout(() => {
            openPopover('', 'dir', touch.clientX, touch.clientY)
          }, 500)
        }}
        onTouchEnd={clearRootLongPress}
        onTouchMove={clearRootLongPress}
        onTouchCancel={clearRootLongPress}
        onDragOver={(e) => {
          // 폴더 위에서는 폴더의 핸들러가 stopPropagation하므로, 여기까지 온 건 빈 영역·최상위 파일 = 루트로
          const external = hasExternalFiles(e.dataTransfer)
          if (readOnly || (!external && !draggingRef.current)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = external ? 'copy' : 'move'
          setDropDir((cur) => (cur === '' ? cur : ''))
        }}
        onDrop={(e) => {
          if (readOnly) return
          e.preventDefault()
          if (hasExternalFiles(e.dataTransfer)) {
            setDropDir(null)
            void uploadFilesInto('', e.dataTransfer.files)
            return
          }
          const item = draggingRef.current
          draggingRef.current = null
          setDropDir(null)
          if (item) void moveInto(item.path, item.type, '')
        }}
        className={`${compact ? 'py-1' : 'min-h-0 flex-1 overflow-y-auto py-2'} outline-none ${dropDir === '' ? 'ring-1 ring-inset ring-accent' : ''}`}
      >
        {roots}
        {commands}
        {filteredPaths !== null ? (
          filteredPaths.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-muted">결과 없음</div>
          ) : (
            filteredPaths.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => onSelect(path)}
                title={path}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm text-ink hover:bg-surface-raised"
              >
                {/* direction:rtl + text-align:left → 넘칠 때 ...이 왼쪽에 붙어 오른쪽(파일명)이 보인다 */}
                <span style={{ direction: 'rtl', textAlign: 'left' }} className="min-w-0 flex-1 truncate">
                  {abbreviatePath(path)}
                </span>
                <PresenceDots colors={presence[path] ?? []} />
              </button>
            ))
          )
        ) : (
          <>
            {rootMoc && (
              <MocItem
                path={rootMoc.path}
                depth={0}
                active={rootMoc.path === selectedPath}
                presenceColors={presence[rootMoc.path] ?? []}
                onSelect={onSelect}
              />
            )}
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
            {rootNodes.map((node) => (
              <Node key={node.path} node={node} depth={0} ctx={ctx} />
            ))}
          </>
        )}
      </div>
      {popover && !readOnly && (
        <ActionPopover
          x={popover.x}
          y={popover.y}
          onRename={
            popover.path === ''
              ? undefined
              : () => {
                  startRename(popover.path, popover.type)
                  setPopover(null)
                }
          }
          onDuplicate={
            popover.type === 'file'
              ? () => {
                  void requestCopy(popover.path)
                  setPopover(null)
                }
              : undefined
          }
          onCopyClip={
            popover.path === ''
              ? undefined
              : () => {
                  setClipboard({ path: popover.path, type: popover.type, mode: 'copy', workspacePath })
                  setPopover(null)
                }
          }
          onCutClip={
            popover.path === ''
              ? undefined
              : () => {
                  setClipboard({ path: popover.path, type: popover.type, mode: 'cut', workspacePath })
                  setPopover(null)
                }
          }
          onPasteClip={
            clipboard
              ? () => {
                  void pasteInto(popover.type === 'dir' ? popover.path : parentOf(popover.path))
                  setPopover(null)
                }
              : undefined
          }
          onDownload={
            popover.type === 'file'
              ? () => {
                  requestDownload(popover.path)
                  setPopover(null)
                }
              : undefined
          }
          onDelete={
            popover.path === ''
              ? undefined
              : () => {
                  requestDelete(popover.path, popover.type)
                  setPopover(null)
                }
          }
          onNewFile={() => {
            startCreate(popover.type === 'dir' ? popover.path : parentOf(popover.path), 'file')
            setPopover(null)
          }}
          onNewFolder={() => {
            startCreate(popover.type === 'dir' ? popover.path : parentOf(popover.path), 'folder')
            setPopover(null)
          }}
          onUpload={() => {
            triggerUpload(popover.type === 'dir' ? popover.path : parentOf(popover.path))
            setPopover(null)
          }}
          onClose={() => setPopover(null)}
        />
      )}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files
          if (files) void uploadFilesInto(uploadDirRef.current, files)
          e.target.value = ''
        }}
      />

      {deleteTarget && (
        <ConfirmDialog
          message={`${deleteTarget.type === 'dir' ? '폴더' : '파일'} "${deleteTarget.path}"을(를) 삭제할까요?`}
          detail="이 작업은 되돌릴 수 없습니다."
          confirmLabel="삭제"
          danger
          onConfirm={deleteConfirmed}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {errorMsg !== null && <ConfirmDialog message={errorMsg} onConfirm={() => setErrorMsg(null)} />}
    </div>
  )
}
