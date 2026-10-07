import { scopedBrowserStorage } from '@mew/ui/browser-storage-scope'
import { Download } from 'iconoir-react'
import { useI18n } from '../i18n'
import { pageRepresentative, documentPageLabel, documentPageTarget, remapPagePath, type DocumentPageMutation } from '../../shared/document-pages'
import { canAutoFocusInput } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useTreeMoveAnimation } from '../hooks/use-tree-move-animation'
import { useTreeTouchGesture } from '../hooks/use-tree-touch-gesture'
import type { SidebarCreateRequest } from '../hooks/use-sidebar-create'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../api/client'
import { copyFile, copyInto, createSubproject, createFolder, createNewDocument, mutateDocumentPage, deleteFile, downloadUrl, initializeGitRepository, renamePath, uploadInto } from '../api/client'
import { flattenFiles, fuzzyScore } from '@mew/editor'
import { ConfirmDialog, setPathDragData, useDialog } from '@mew/ui'
import { getBinding, matchesShortcut } from '@mew/shortcuts'
import { PresenceDots } from './PresenceDots'
import { CommandButtonMenu } from './CommandButtonMenu'
import { DownloadLink } from './DownloadLink'
import { FileActionMenu as ActionPopover } from './file-action-menu'
import { getTreeScroll, saveTreeScroll, setScrollSaveSuppressed } from '../utils/scrollMemory'
import { readFileClipboard, writeFileClipboard, type FileClipboard } from '../utils/fileClipboard'
import { SubprojectLink } from './subproject-link'
import { ProjectIcon } from './ProjectIcon'
import { GitButton } from './GitButton'
import { VirtualTreeRows } from './virtual-tree-rows'
import {
  childrenForOpenDirs,
  visibleOpenDirectories,
  readTreeCenter,
  restoreTreeCenter,
  materializeTreePath,
  loadDirectoryChildren,
  saveDirectoryChildren,
  type DirectoryChildren,
  type TreePersistenceState,
} from '../utils/treePersistence'

export type { TreePersistenceState } from '../utils/treePersistence'

type EditingState =
  | { mode: 'rename'; path: string; type: 'file' | 'dir'; value: string; error?: string; busy?: boolean }
  | { mode: 'create-file' | 'create-folder'; parentPath: string; value: string; error?: string; busy?: boolean }
  | null

export type TreeOpenOptions = { preview?: boolean; forceNewTab?: boolean; replaceActive?: boolean }

type Focused = { path: string; type: 'file' | 'dir' } | null

type PopoverState = { path: string; type: 'file' | 'dir'; x: number; y: number } | null

export type FileSearchScope = { id: string; label: string; icon: string }
export type FileSearchResult = { path: string; project: string; scope: FileSearchScope }

interface NodeCtx {
  project: string
  documentPages: boolean
  openPage: (node: TreeNode, opts?: TreeOpenOptions) => void
  selectedPath: string | null
  openPaths?: ReadonlySet<string>
  focused: Focused
  menuPath: string | undefined
  openDirs: Set<string>
  editing: EditingState
  readOnly: boolean
  canUseCommands: boolean
  openProject?: (path: string) => void
  canOpenProjects: boolean
  presence: Record<string, string[]>
  /** 지연 로드한 폴더별 직접 자식. 값이 빈 배열이면 "불러왔지만 비어 있음"이다. */
  directoryChildren: DirectoryChildren
  loadingDirs: Set<string>
  /** 드롭 강조 중인 폴더 경로(''=루트). 이동 대상 미리보기 */
  dropDir: string | null
  onSelect: (path: string, opts?: TreeOpenOptions) => void
  toggleDir: (path: string) => void
  focusNode: (path: string, type: 'file' | 'dir') => void
  startRename: (path: string, type: 'file' | 'dir') => void
  startCreate: (parentPath: string, kind: 'file' | 'folder') => void
  requestDelete: (path: string, type: 'file' | 'dir') => void
  openPopover: (path: string, type: 'file' | 'dir', x: number, y: number) => void
  setEditValue: (v: string) => void
  submitEdit: () => void
  cancelEdit: () => void
  // ── 드래그 이동 ──
  beginDrag: (path: string, type: 'file' | 'dir') => void
  endDrag: () => void
  canDropInto: (dir: string) => boolean
  onDragOverDir: (dir: string) => void
  onDropDir: (dir: string) => void
  /** 바깥(파일 탐색기)에서 끌어온 파일을 그 폴더에 업로드 */
  onDropFiles: (dir: string, files: FileList) => void
  openGit?: (path: string) => void
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
  useUiLocale()
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
  useUiLocale()
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {open ? (
        <>
          <path d="M3 10V6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5V10" />
          <path d="M3.4 10h17.3a1 1 0 0 1 .96 1.28l-2 7a1 1 0 0 1-.96.72H4.3a1 1 0 0 1-.96-.72l-1.9-7A1 1 0 0 1 2.4 10Z" />
        </>
      ) : (
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />
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
  opened = false,
  presenceColors,
  label = 'Map Of Contents',
  documentPages = false,
  onSelect,
}: {
  path: string
  depth: number
  active: boolean
  opened?: boolean
  presenceColors: string[]
  label?: string
  documentPages?: boolean
  onSelect: (path: string, opts?: TreeOpenOptions) => void
}) {
  useUiLocale()
  return (
    <button
      type="button"
      data-path={path}
      onClick={event => onSelect(path, documentPages ? { replaceActive: !event.ctrlKey && !event.metaKey, forceNewTab: event.ctrlKey || event.metaKey, preview: false } : undefined)}
      onDoubleClick={() => onSelect(path, { preview: false })}
      title={path}
      className={`mb-0.5 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm select-none hover:bg-surface-raised ${
        active ? 'bg-surface-raised font-medium text-ink' : opened ? 'bg-surface-raised/50 text-ink-secondary' : 'text-ink-secondary'
      }`}
      style={{ paddingLeft: `${depth * 14 + 8}px`, scrollMarginTop: `${depth * 1.75}rem` }}
    >
      <MapIcon size={14} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <PresenceDots colors={presenceColors} />
    </button>
  )
}

/** 펼쳐 둔 폴더는 프로젝트마다 따로 기억한다 — 브라우저를 껐다 켜도 보던 모양 그대로 뜬다 */
const openDirsKey = (project: string) => `mew:tree-open:${project}`

/** 저장된 펼침 목록. 저장된 적이 없으면 null(= 처음 여는 프로젝트라 기본값을 쓴다) */
function loadOpenDirs(project: string): Set<string> | null {
  try {
    const raw = scopedBrowserStorage().getItem(openDirsKey(project))
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
const notAllowed = () => uiText("권한이 없습니다")

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
  useUiLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    if (canAutoFocusInput()) inputRef.current?.focus()
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
      {error && <div className="select-text mt-0.5 text-xs text-danger">{error}</div>}
    </div>
  )
}


function TreeChildren({ depth, documentPages = false, children }: { depth: number; documentPages?: boolean; children: React.ReactNode }) {
  return <div className="relative">
    <span aria-hidden="true" data-tree-guide className="pointer-events-none absolute inset-y-0 z-10 w-px bg-edge-strong" style={{ left: depth * 14 + (documentPages ? 12 : 13) }} />
    {children}
  </div>
}

function TreeHeader({ depth, open, children }: { depth: number; open: boolean; children: React.ReactNode }) {
  return <div data-tree-sticky-depth={open ? depth : undefined} className={open ? 'sticky z-20 bg-surface-deep' : undefined} style={open ? { top: `calc(${depth * 1.75}rem - var(--tree-sticky-inset, 0px))` } : undefined}>
    {children}
  </div>
}

function Node({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: NodeCtx }) {
  useUiLocale()
  const readOnly = ctx.readOnly || node.editable === false
  const touch = useTreeTouchGesture({
    enabled: !readOnly,
    onMenu: (x, y) => {
      ctx.focusNode(node.path, node.type)
      ctx.openPopover(node.path, node.type, x, y)
    },
    onDragCancel: ctx.endDrag,
  })

  function handleClick(event: React.MouseEvent) {
    if (touch.consumeClick()) return
    if (ctx.documentPages && !node.project && (node.type === 'dir' || /\.md$/i.test(node.name))) {
      ctx.openPage(node, { forceNewTab: event.ctrlKey || event.metaKey, replaceActive: !event.ctrlKey && !event.metaKey, preview: false })
    } else if (node.type === 'dir' && node.project && ctx.openProject) {
      if (ctx.canOpenProjects) ctx.openProject(node.path)
    } else if (node.type === 'dir') {
      ctx.toggleDir(node.path)
      ctx.focusNode(node.path, 'dir')
    } else {
      ctx.onSelect(node.path)
      ctx.focusNode(node.path, 'file')
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (readOnly) return
    e.preventDefault()
    if (touch.isTouchInput()) return
    ctx.focusNode(node.path, node.type)
    ctx.openPopover(node.path, node.type, e.clientX, e.clientY)
  }

  const isMenuTarget = ctx.menuPath === node.path
  const holdHighlight = 'data-[touch-holding=true]:bg-surface-raised'
  const isFocused = ctx.focused?.path === node.path
  const touchProps = {
    'data-menu-target': isMenuTarget || undefined,
    ref: touch.ref,
    onPointerDown: touch.onPointerDown,
    onContextMenu: handleContextMenu,
  }

  function handleDragStart(e: React.DragEvent) {
    // Touch uses its own 1s hold; reject an early browser-native drag takeover.
    if (touch.isTouchInput() && e.nativeEvent.isTrusted) {
      e.preventDefault()
      return
    }
    setPathDragData(e.dataTransfer, node.path, node.type)
    e.dataTransfer.setData('application/x-mew-project', ctx.project)
    ctx.beginDrag(node.path, node.type)
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

  if (ctx.documentPages && !node.project && (node.type === 'dir' || /\.md$/i.test(node.name))) {
    const folder = node.type === 'dir'
    const loadedChildren = node.children ?? ctx.directoryChildren[node.path]
    const all = loadedChildren ?? []
    const representative = folder ? pageRepresentative(node.path, all) : undefined
    const children = all.filter(child => child !== representative && !isMocNode(child))
    const hasChildren = folder && (loadedChildren === undefined || children.length > 0)
    const open = hasChildren && ctx.openDirs.has(node.path)
    const pageFile = representative?.path ?? (folder && ctx.selectedPath && documentPageTarget(ctx.selectedPath) === node.path ? ctx.selectedPath : undefined)
      ?? (folder ? Array.from(ctx.openPaths ?? []).find(path => documentPageTarget(path) === node.path) : undefined)
    const label = documentPageLabel(folder ? node.path : node.name) || (folder ? node.name : node.name.replace(/\.md$/i, ''))
    const active = node.path === ctx.selectedPath || pageFile === ctx.selectedPath
    const creating = ctx.editing?.mode === 'create-file' && ctx.editing.parentPath === node.path ? ctx.editing : null
    return <div className="group/page isolate" data-document-page={node.path}
      onDragOver={event => { if (!ctx.canDropInto(node.path)) return; event.preventDefault(); event.stopPropagation(); ctx.onDragOverDir(node.path) }}
      onDrop={event => { if (!ctx.canDropInto(node.path)) return; event.preventDefault(); event.stopPropagation(); ctx.onDropDir(node.path) }}>
      <TreeHeader depth={depth} open={open}>
        <div className={`flex min-w-0 items-center rounded hover:bg-surface-raised ${active ? 'bg-surface-raised' : ctx.openPaths?.has(pageFile ?? node.path) ? 'bg-surface-raised/50' : ''} ${ctx.dropDir === node.path ? 'ring-1 ring-accent' : ''}`} style={{ paddingLeft: depth * 14 + 4 }}>
          {hasChildren ? <button type="button" aria-label={uiText('{p0} 하위 문서', { p0: label })} aria-expanded={open}
            onClick={() => { ctx.toggleDir(node.path); ctx.focusNode(node.path, 'dir') }} className="flex h-7 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={open ? 'm6 9 6 6 6-6' : 'm9 6 6 6-6 6'} /></svg>
          </button> : <span aria-hidden="true" data-document-leaf className="flex h-7 w-5 shrink-0 items-center justify-center text-ink-muted">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="2" /></svg>
          </span>}
          <button type="button" aria-current={active ? 'page' : undefined} data-path={node.path} data-page-file={pageFile} style={{ scrollMarginTop: `${depth * 1.75}rem` }} draggable={!readOnly} onDragStart={handleDragStart} onDragEnd={ctx.endDrag}
            onClick={handleClick} {...touchProps} className={`flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 pr-1 text-left text-sm text-ink select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-accent ${holdHighlight} ${isMenuTarget ? 'bg-surface-raised' : ''}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-ink-muted" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h8M8 17h5" /></svg>
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <PresenceDots colors={ctx.presence[pageFile ?? node.path] ?? []} />
          </button>
          {!readOnly && <button type="button" aria-label={uiText('{p0}에 하위 문서 추가', { p0: label })}
            onClick={() => ctx.startCreate(node.path, 'file')} className="mr-1 flex h-7 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent sm:opacity-0 sm:group-hover/page:opacity-100 sm:group-focus-within/page:opacity-100">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>}
        </div>
      </TreeHeader>
      {(open || creating) && <TreeChildren depth={depth} documentPages>
        {creating && <InlineInput value={creating.value} onChange={ctx.setEditValue} onCommit={ctx.submitEdit} onCancel={ctx.cancelEdit} error={creating.error} placeholder={uiText('새 문서 이름')} paddingLeft={(depth + 1) * 14 + 24} />}
        {open && <>
          {ctx.loadingDirs.has(node.path) && loadedChildren === undefined && <div className="py-1 text-xs text-ink-muted" style={{ paddingLeft: (depth + 1) * 14 + 24 }}>{uiText('불러오는 중…')}</div>}
          <NodeList nodes={children} depth={depth + 1} ctx={ctx} />
        </>}
      </TreeChildren>}
    </div>
  }

  if (node.type === 'file') {
    const isSelected = node.path === ctx.selectedPath
    return (
      <div className="flex w-full items-center gap-0.5">
        <button
          type="button"
          data-path={node.path}
          draggable={!readOnly}
          onDragStart={handleDragStart}
          onDragEnd={ctx.endDrag}
          onClick={handleClick}
          onDoubleClick={() => { if (!touch.consumeClick()) ctx.onSelect(node.path, { preview: false }) }}
          {...touchProps}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-sm select-none [-webkit-touch-callout:none] ${holdHighlight} data-[touch-dragging=true]:bg-accent/15 data-[touch-dragging=true]:ring-1 data-[touch-dragging=true]:ring-accent hover:bg-surface-raised ${
            isSelected || isMenuTarget ? 'bg-surface-raised font-medium' : ctx.openPaths?.has(node.path) ? 'bg-surface-raised/50' : ''
          }`}
          style={{ paddingLeft: `${depth * 14 + 8}px`, scrollMarginTop: `${depth * 1.75}rem` }}
        >
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <PresenceDots colors={ctx.presence[node.path] ?? []} />
        </button>
      </div>
    )
  }

  const projectLink = node.project && ctx.openProject !== undefined
  const isOpen = !projectLink && ctx.openDirs.has(node.path)
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
    <div className="isolate"
      // 폴더(및 그 안의 파일)로 드롭하면 이 폴더로 이동한다. 자식 폴더는 자기 dragover에서
      // stopPropagation하므로, 하위 파일 위에서 놓으면 가장 가까운 폴더(=여기)가 대상이 된다.
      onDragOver={(e) => {
        // 바깥에서 끌어온 파일이면 이 폴더에 업로드, 사이드바 항목이면 이 폴더로 이동
        const external = hasExternalFiles(e.dataTransfer)
        if (external ? readOnly : !ctx.canDropInto(node.path)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = external ? 'copy' : 'move'
        ctx.onDragOverDir(node.path)
      }}
      onDrop={(e) => {
        if (hasExternalFiles(e.dataTransfer)) {
          if (readOnly) return
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
      <TreeHeader depth={depth} open={isOpen}>
        <div className="flex w-full items-center gap-0.5">
          {projectLink ? <SubprojectLink
            name={node.name}
            icon={node.icon ?? 'i:folder'}
            unavailable={!ctx.canOpenProjects}
            data-path={node.path}
            draggable={!readOnly}
            onDragStart={handleDragStart}
            onDragEnd={ctx.endDrag}
            onClick={handleClick}
            {...touchProps}
            style={{ paddingLeft: `${depth * 14 + 8}px`, scrollMarginTop: `${depth * 1.75}rem` }}
            className={`${holdHighlight} ${isFocused || isMenuTarget ? 'bg-surface-raised' : ''} ${isDropTarget ? 'bg-accent/15 ring-1 ring-accent' : ''}`}
          /> : <button
            type="button"
            data-path={node.path}
            draggable={!readOnly}
            onDragStart={handleDragStart}
            onDragEnd={ctx.endDrag}
            onClick={handleClick}
            {...touchProps}
            className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-medium text-ink-secondary select-none [-webkit-touch-callout:none] ${holdHighlight} data-[touch-dragging=true]:bg-accent/15 data-[touch-dragging=true]:ring-1 data-[touch-dragging=true]:ring-accent hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent ${isDropTarget ? 'bg-accent/15 ring-1 ring-accent' : isMenuTarget ? 'bg-surface-raised' : ''}`}
            style={{ paddingLeft: `${depth * 14 + 8}px`, scrollMarginTop: `${depth * 1.75}rem` }}
          >
            <FolderIcon open={isOpen} />
            <span className="min-w-0 truncate">{node.name}</span>
            {node.project && (
              <span className="ml-1 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                Project
              </span>
            )}
          </button>}
          {node.git && !projectLink && ctx.openGit && <GitButton onClick={() => ctx.openGit?.(node.path)} title={uiText("{p0} Git 열기", { p0: node.name })} />}
          {node.project && !projectLink && ctx.canUseCommands && <CommandButtonMenu project={ctx.project} directory={node.path} />}
        </div>
      </TreeHeader>
      {isOpen && (
        <TreeChildren depth={depth}>
          {moc && (
            <MocItem
              path={moc.path}
              depth={depth + 1}
              active={moc.path === ctx.selectedPath}
              opened={ctx.openPaths?.has(moc.path)}
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
              placeholder={createEditing.mode === 'create-folder' ? uiText("새 폴더 이름") : uiText("새 파일 이름")}
              paddingLeft={(depth + 1) * 14 + 8}
            />
          )}
          {ctx.loadingDirs.has(node.path) && nodeChildren === undefined && (
            <div className="py-1 text-xs text-ink-muted" style={{ paddingLeft: (depth + 1) * 14 + 8 }}>{uiText("불러오는 중…")}</div>
          )}
          {children && <NodeList nodes={children} depth={depth + 1} ctx={ctx} />}
        </TreeChildren>
      )}
    </div>
  )
}

function NodeList({ nodes, depth, ctx }: { nodes: TreeNode[]; depth: number; ctx: NodeCtx }) {
  const groups = useMemo(() => {
    const result: TreeNode[][] = []
    const leaf = (node: TreeNode) => node.type === 'file' || (!node.project && !ctx.openDirs.has(node.path))
    for (const node of nodes) {
      if (leaf(node) && result.at(-1)?.[0] && leaf(result.at(-1)![0])) result.at(-1)!.push(node)
      else result.push([node])
    }
    return result
  }, [nodes, ctx.openDirs])
  return <>{groups.map(group => group.length >= 200 && !group.some(node => ctx.editing?.mode === 'rename' ? ctx.editing.path === node.path : ctx.editing?.parentPath === node.path)
    ? <VirtualTreeRows key={group[0].path} nodes={group} pinned={[ctx.focused?.path, ctx.menuPath]}
        render={node => <Node node={node} depth={depth} ctx={ctx} />} />
    : group.map(node => <Node key={node.path} node={node} depth={depth} ctx={ctx} />))}</>
}

export function FileTree({
  tree,
  project,
  stateKey,
  accountState,
  onAccountStateChange,
  workspacePath = null,
  rootPath = '',
  onDirectoryFocus,
  createRequest,
  onCreateRequestHandled,
  selectedPath,
  openPaths,
  readOnly,
  canUseCommands = false,
  onOpenProject,
  canOpenProjects = false,
  canUseGit = false,
  compact = false,
  roots,
  onOpenGraph,
  documentPages = false,
  onPageMutation,
  onBeforePageMutation,
  commands,
  loadChildren,
  treeInvalidation,
  refreshSignal = 0,
  searchFocusSignal,
  newFileSignal,
  revealSignal,
  revealOnMount = false,
  onRevealHandled,
  presence,
  onSelect,
  onFileCreated,
  onFolderCreated,
  onRenamed,
  onDeleted,
  onNotice,
  onOpenGit,
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
  /** Project-relative directory represented by this tree's top level. */
  rootPath?: string
  onDirectoryFocus?: (parentPath: string) => void
  createRequest?: SidebarCreateRequest | null
  onCreateRequestHandled?: () => void
  selectedPath: string | null
  openPaths?: ReadonlySet<string>
  readOnly: boolean
  canUseCommands?: boolean
  /** Treat marked directories as navigation boundaries instead of expandable folders. */
  onOpenProject?: (path: string) => void
  canOpenProjects?: boolean
  canUseGit?: boolean
  /** 다른 트리 안에 넣을 때 검색·정렬 도구와 독립 스크롤을 숨긴다. */
  compact?: boolean
  /** 검색창 아래에 서는 Documents/프로젝트 가상 폴더 */
  roots?: React.ReactNode
  /** Docs root only: graph entry above its MOC. */
  onOpenGraph?: () => void
  documentPages?: boolean
  onBeforePageMutation?: () => Promise<void | (() => void)>
  onPageMutation?: (result: DocumentPageMutation) => void
  /** 파일 목록 흐름에 끼우는 루트 프로젝트 명령 등 추가 항목 */
  commands?: React.ReactNode
  /** 폴더를 펼칠 때 해당 폴더의 직접 자식만 불러온다. 없으면 기존 완전 트리처럼 동작한다. */
  loadChildren?: (path: string) => Promise<TreeNode[]>
  /** watcher가 알려 준 영향 부모만 자식 캐시를 다시 읽는다. */
  treeInvalidation?: { n: number; project: string; version: number; parents: string[] }
  refreshSignal?: number
  searchFocusSignal: number
  /** Alt+N — 새 파일 이름 입력 열기. parentPath가 null이면 트리의 선택 항목 기준 */
  newFileSignal: { n: number; parentPath: string | null }
  /** 오를 때마다 지금 문서 자리를 다시 드러낸다 — 이미 열린 탭을 다시 눌렀을 때도 반응하려고 신호로 받는다 */
  revealSignal: number
  /** 탭 클릭으로 닫혀 있던 트리를 여는 경우 초기 복원보다 파일 위치 표시를 우선한다. */
  revealOnMount?: boolean
  onRevealHandled?: () => void
  presence: Record<string, string[]>
  onSelect: (path: string, opts?: TreeOpenOptions) => void
  onFileCreated: (relPath: string) => void
  onFolderCreated: () => void
  onRenamed: (oldPath: string, newPath: string, type: 'file' | 'dir') => void
  onDeleted: (path: string, type: 'file' | 'dir') => void
  /** member+ 전용 — 눈/연필 아이콘으로 게스트 열람/편집 규칙을 바꾼 뒤 트리를 다시 불러오도록 호출 */
  onGuestAccessChanged?: () => void
  /** 흐름을 끊지 않는 짧은 안내(토스트) — 실패는 아니지만 말해줘야 하는 것들 */
  onNotice: (message: string) => void
  /** 저장소 폴더의 Git 워크벤치 가상 탭을 연다. */
  onOpenGit?: (path: string) => void
  /** 검색창 밖에 포커스가 있어도 사이드바의 첫 Esc가 검색부터 취소할 수 있게 App에 등록한다 */
  registerSearchCancel: (cancel: (() => boolean) | null) => void
}) {
  const { t } = useI18n()
  const persistedProject = stateKey ?? project
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState<Focused>(null)
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set(accountState?.openDirs ?? loadOpenDirs(persistedProject) ?? []))
  // 로그인 계정은 서버 상태를 우선하고, 서버 상태가 아직 없을 때만 이 브라우저의 기존 캐시를 이관한다.
  // 게스트는 예전에 더 넓은 권한으로 본 파일명이 남지 않도록 자식 목록을 디스크에 저장하지 않는다.
  const persistsDirectoryChildren = onAccountStateChange !== undefined
  const onAccountStateChangeRef = useRef(onAccountStateChange)
  onAccountStateChangeRef.current = onAccountStateChange
  const [directoryChildren, setDirectoryChildren] = useState<DirectoryChildren>(() => (
    accountState?.directoryChildren ?? (persistsDirectoryChildren ? loadDirectoryChildren(persistedProject) : {})
  ))
  const gitPaths = useMemo(() => {
    const result = new Set<string>()
    const visit = (nodes: TreeNode[]) => nodes.forEach((node) => {
      if (node.git) result.add(node.path)
      if (node.children) visit(node.children)
    })
    visit(tree)
    Object.values(directoryChildren).forEach(visit)
    return result
  }, [directoryChildren, tree])
  const projectPaths = useMemo(() => {
    const result = new Set<string>()
    const visit = (nodes: TreeNode[]) => nodes.forEach((node) => {
      if (node.project) result.add(node.path)
      const children = node.children ?? directoryChildren[node.path]
      if (children) visit(children)
    })
    visit(tree)
    return result
  }, [directoryChildren, tree])
  const creatingProjectRef = useRef(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const directoryChildrenRef = useRef(directoryChildren)
  directoryChildrenRef.current = directoryChildren
  const loadingDirsRef = useRef(loadingDirs)
  loadingDirsRef.current = loadingDirs
  // 빈 펼침 목록도 복원 상태다. 처음 표시할 때 활성 문서로 덮어쓰지 않는다.
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
  const captureMove = useTreeMoveAnimation(listRef)
  const treeScrollRef = useRef(accountState?.scrollTop ?? getTreeScroll(persistedProject) ?? 0)
  const centerAnchorRef = useRef(accountState?.centerAnchor)
  const restoringScrollRef = useRef(!compact)
  const pageOpenSequence = useRef(0)
  useEffect(() => () => { pageOpenSequence.current++ }, [persistedProject])
  const initialRevealRef = useRef({ selectedPath, revealSignal: revealOnMount ? -1 : revealSignal })
  const onRevealHandledRef = useRef(onRevealHandled)
  onRevealHandledRef.current = onRevealHandled
  const recordScrollRef = useRef(() => {})
  recordScrollRef.current = () => {
    const list = listRef.current
    if (compact || !list || !list.clientHeight || restoringScrollRef.current) return
    treeScrollRef.current = list.scrollTop
    centerAnchorRef.current = readTreeCenter(list)
    saveTreeScroll(persistedProject, list.scrollTop)
    onAccountStateChangeRef.current?.({
      openDirs: [...openDirs], scrollTop: list.scrollTop, centerAnchor: centerAnchorRef.current,
      directoryChildren: childrenForOpenDirs(openDirs, directoryChildrenRef.current),
    })
  }
  // 팝오버의 "업로드"는 파일 선택창을 띄워야 해서 클릭 시점의 대상 폴더를 잠깐 들고 있는다
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadDirRef = useRef('')
  function triggerUpload(dir: string) {
    uploadDirRef.current = dir
    uploadInputRef.current?.click()
  }
  async function makeSubproject(dir: string) {
    if (creatingProjectRef.current) return
    creatingProjectRef.current = true
    setCreatingProject(true)
    try {
      await createSubproject(dir, project)
      // The marker changes the folder row in its parent, not only its own contents.
      requestDir(parentOf(dir), true)
      if (openDirs.has(dir)) requestDir(dir, true)
      onFolderCreated()
      onNotice(uiText("{p0}: 하위 프로젝트로 지정했습니다", { p0: dir }))
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err))
    } finally {
      creatingProjectRef.current = false
      setCreatingProject(false)
    }
  }
  const dialogs = useDialog()
  async function initGit(dir: string) {
    const shown = dir || uiText("프로젝트 루트")
    if (!(await dialogs.confirm({ message: uiText("이 폴더를 Git 저장소로 초기화할까요?"), detail: shown, confirmLabel: uiText("Git 초기화") }))) return
    void initializeGitRepository(dir, project)
      .then(() => {
        onNotice(uiText("{p0}: Git 저장소를 만들었습니다", { p0: shown }))
        onFolderCreated()
      })
      .catch((err: unknown) => onNotice(err instanceof Error ? err.message : String(err)))
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
  const previousRootRef = useRef<TreeNode[] | null>(null)
  const pendingDirsRef = useRef(new Map<string, { promise: Promise<TreeNode[] | undefined>; dirty: boolean }>())
  const mountedTreeRef = useRef(true)
  const revalidatedRestoredChildrenRef = useRef(new Set<string>())
  const lastTreeInvalidationRef = useRef(0)
  const lastRefreshSignalRef = useRef(refreshSignal)
  // 마운트 시점 값으로 초기화 — "처음 한 번은 건너뛰기" 식 불리언 가드는 StrictMode가
  // 마운트 이펙트를 두 번 실행할 때(두 번째 호출에서 가드가 이미 소진됨) 무력화돼 사이드바를
  // 열기만 해도 검색창에 포커스가 가는(모바일 키보드가 뜨는) 버그가 있었다. 값 비교면
  // 두 번 호출돼도 항상 "신호가 안 바뀌었으니 스킵"으로 같은 결론이 난다.
  const lastHandledSearchFocusSignal = useRef(searchFocusSignal)

  useEffect(() => {
    if (searchFocusSignal === lastHandledSearchFocusSignal.current) return
    lastHandledSearchFocusSignal.current = searchFocusSignal
    if (canAutoFocusInput()) searchInputRef.current?.focus()
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

  const handledCreateRequest = useRef<SidebarCreateRequest | null>(null)
  useEffect(() => {
    if (!createRequest || handledCreateRequest.current === createRequest) return
    handledCreateRequest.current = createRequest
    startCreate(createRequest.parentPath, createRequest.kind)
    onCreateRequestHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Each request is consumed once, including StrictMode.
  }, [createRequest])

  useEffect(() => {
    const savedChildren = childrenForOpenDirs(openDirs, directoryChildren)
    try {
      writeBrowserStorage(openDirsKey(persistedProject), JSON.stringify([...openDirs]))
    } catch {
      // 로컬 캐시 실패로 트리 렌더와 서버 계정 상태 저장을 중단하지 않는다.
    }
    if (persistsDirectoryChildren) saveDirectoryChildren(persistedProject, savedChildren)
    onAccountStateChangeRef.current?.({ openDirs: [...openDirs], scrollTop: treeScrollRef.current, centerAnchor: centerAnchorRef.current, directoryChildren: savedChildren })
  }, [directoryChildren, openDirs, persistedProject, persistsDirectoryChildren])

  // Nested Docs/project trees share this scroll surface. Keep the center stable while
  // their asynchronous rows arrive, but yield immediately to user navigation.
  useLayoutEffect(() => {
    const list = listRef.current
    if (compact || !list) return
    let frame = 0
    const restore = () => {
      if (!restoringScrollRef.current) { recordScrollRef.current(); return }
      if (!centerAnchorRef.current || !restoreTreeCenter(list, centerAnchorRef.current)) {
        list.scrollTop = treeScrollRef.current
      }
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore) }
    const stop = () => { restoringScrollRef.current = false }
    list.addEventListener('mew:tree-reveal', stop)
    const mutations = new MutationObserver(schedule)
    mutations.observe(list, { childList: true, subtree: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(list)
    for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) list.addEventListener(event, stop, { passive: true })
    restore()
    return () => {
      cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
      list.removeEventListener('mew:tree-reveal', stop)
      for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) list.removeEventListener(event, stop)
    }
  }, [compact])

  // 활성 탭이 바뀌면 사이드바에서도 해당 파일이 보이게 부모 폴더 체인을 열고 스크롤한다.
  // 사이드바가 닫혀 있으면 이 컴포넌트는 언마운트 상태 — 다시 열릴 때 이 이펙트가 반영한다.
  // revealSignal도 함께 본다 — **이미 열린 탭을 다시 눌렀을 때**는 경로가 그대로라 그 신호만이 유일한 단서다.
  useEffect(() => {
    if (!selectedPath || tree.length === 0) return
    // 하위 프로젝트·Documents는 처음 펼칠 때 저장 상태(없으면 모두 접힘)를 유지한다.
    // 이후 사용자가 문서 탭을 선택하면 기존대로 해당 경로를 펼친다.
    if ((compact || hadSavedOpenDirs) && initialRevealRef.current.selectedPath === selectedPath
      && initialRevealRef.current.revealSignal === revealSignal) return
    restoringScrollRef.current = false
    const list = listRef.current
    if (!list) return
    // Documents의 바깥 트리도 초기 중앙 위치 보정을 끝내야 한다.
    list.dispatchEvent(new Event('mew:tree-reveal', { bubbles: true }))
    ensureOpenChain(parentOf(documentPages ? documentPageTarget(selectedPath) : selectedPath))
    // 지연 로딩된 자식이 실제로 나타날 때까지 기다린다. 캐시 갱신마다 재스크롤하지 않는다.
    let raf = 0
    const stop = () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      resize.disconnect()
      onRevealHandledRef.current?.()
    }
    const reveal = () => {
      const row = list.querySelector<HTMLElement>(`[data-path="${CSS.escape(selectedPath)}"], [data-page-file="${CSS.escape(selectedPath)}"]`)
      if (!row) {
        materializeTreePath(list, { tree: persistedProject, path: selectedPath })
        return
      }
      if (!row.getClientRects().length) return
      row.scrollIntoView({ block: 'nearest' })
      stop()
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(reveal)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(list, { childList: true, subtree: true })
    // 모바일에서 에디터 뒤에 숨겨진 트리는 사이드바를 실제로 열 때 스크롤한다.
    const resize = new ResizeObserver(schedule)
    resize.observe(list)
    raf = requestAnimationFrame(reveal)
    for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) list.addEventListener(event, stop, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      resize.disconnect()
      for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown']) list.removeEventListener(event, stop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, tree, revealSignal])

  const requestDir = useCallback((path: string, refresh = false): Promise<TreeNode[] | undefined> => {
    if (onOpenProject && [...projectPaths].some(parent => path === parent || path.startsWith(`${parent}/`))) return Promise.resolve(undefined)
    if (!loadChildren) return Promise.resolve(undefined)
    const existing = pendingDirsRef.current.get(path)
    if (existing) {
      if (refresh) existing.dirty = true
      revalidatedRestoredChildrenRef.current.add(path)
      return existing.promise
    }
    if (!refresh && directoryChildrenRef.current[path] !== undefined) return Promise.resolve(directoryChildrenRef.current[path])
    const pending = { promise: Promise.resolve<TreeNode[] | undefined>(undefined), dirty: false }
    pendingDirsRef.current.set(path, pending)
    revalidatedRestoredChildrenRef.current.add(path)
    loadingDirsRef.current = new Set(loadingDirsRef.current).add(path)
    setLoadingDirs(loadingDirsRef.current)
    pending.promise = Promise.resolve().then(async () => {
      while (pendingDirsRef.current.get(path) === pending) {
        pending.dirty = false
        const children = await loadChildren(path)
        if (!mountedTreeRef.current || pendingDirsRef.current.get(path) !== pending) return undefined
        if (pending.dirty) continue
        const old = directoryChildrenRef.current[path] ?? []
        const directories = new Set(children.filter(node => node.type === 'dir').map(node => node.path))
        const removed = old.filter(node => node.type === 'dir' && !directories.has(node.path))
        const cache = { ...directoryChildrenRef.current, [path]: children }
        const loading = new Set(loadingDirsRef.current)
        for (const key of new Set([...Object.keys(cache), ...pendingDirsRef.current.keys()])) if (removed.some(node => key === node.path || key.startsWith(node.path + '/'))) {
          delete cache[key]
          pendingDirsRef.current.delete(key)
          revalidatedRestoredChildrenRef.current.delete(key)
          loading.delete(key)
        }
        loadingDirsRef.current = loading
        setLoadingDirs(loading)
        directoryChildrenRef.current = cache
        setDirectoryChildren(cache)
        return children
      }
      return undefined
    }).catch((err: unknown) => {
      if (pendingDirsRef.current.get(path) === pending) onNotice(err instanceof Error ? err.message : String(err))
      return undefined
    }).finally(() => {
      if (pendingDirsRef.current.get(path) !== pending) return
      pendingDirsRef.current.delete(path)
      const next = new Set(loadingDirsRef.current)
      next.delete(path)
      loadingDirsRef.current = next
      setLoadingDirs(next)
    })
    return pending.promise
  }, [loadChildren, onNotice, onOpenProject, projectPaths])

  useEffect(() => {
    mountedTreeRef.current = true
    const requests = pendingDirsRef.current
    return () => {
      mountedTreeRef.current = false
      // StrictMode immediately mounts effects again; keep its shared in-flight reads.
      queueMicrotask(() => { if (!mountedTreeRef.current) requests.clear() })
    }
  }, [persistedProject])

  // A new root array is a refreshed listing, not a reason to discard unchanged subtrees.
  useEffect(() => {
    const previous = previousRootRef.current
    if (!previous && tree.length === 0) return
    previousRootRef.current = tree
    if (!previous) return
    const directories = new Set(tree.filter(node => node.type === 'dir').map(node => node.path))
    const removed = previous.filter(node => node.type === 'dir' && !directories.has(node.path))
    if (!removed.length) return
    const cache = { ...directoryChildrenRef.current }
    const loading = new Set(loadingDirsRef.current)
    for (const key of new Set([...Object.keys(cache), ...pendingDirsRef.current.keys()])) if (removed.some(node => key === node.path || key.startsWith(node.path + '/'))) {
      delete cache[key]
      pendingDirsRef.current.delete(key)
      revalidatedRestoredChildrenRef.current.delete(key)
      loading.delete(key)
    }
    loadingDirsRef.current = loading
    setLoadingDirs(loading)
    directoryChildrenRef.current = cache
    setDirectoryChildren(cache)
  }, [tree])

  useEffect(() => {
    if (!treeInvalidation?.n || treeInvalidation.project !== project || !loadChildren) return
    if (treeInvalidation.n === lastTreeInvalidationRef.current) return
    lastTreeInvalidationRef.current = treeInvalidation.n
    const visible = visibleOpenDirectories(tree, openDirs, directoryChildrenRef.current, !!onOpenProject)
    const parents = treeInvalidation.parents.includes('') ? visible : treeInvalidation.parents
    for (const parent of parents) {
      revalidatedRestoredChildrenRef.current.delete(parent)
      if (visible.includes(parent)) void requestDir(parent, true)
    }
  }, [treeInvalidation, project, loadChildren, openDirs, tree, onOpenProject, requestDir])

  const loadDir = useCallback((path: string) => requestDir(path), [requestDir])

  useEffect(() => {
    if (lastRefreshSignalRef.current === refreshSignal) return
    lastRefreshSignalRef.current = refreshSignal
    for (const path of visibleOpenDirectories(tree, openDirs, directoryChildrenRef.current, !!onOpenProject)) {
      void requestDir(path, true)
    }
  }, [refreshSignal, tree, openDirs, onOpenProject, requestDir])

  // Only request directories reachable through expanded ancestors. Cached rows render
  // immediately; each restored directory is refreshed once, without a timed waterfall.
  useEffect(() => {
    if (!loadChildren || tree.length === 0) return
    for (const path of visibleOpenDirectories(tree, openDirs, directoryChildren, !!onOpenProject)) {
      if (loadingDirsRef.current.has(path)) continue
      const cached = directoryChildren[path] !== undefined
      if (cached && revalidatedRestoredChildrenRef.current.has(path)) continue
      revalidatedRestoredChildrenRef.current.add(path)
      requestDir(path, cached)
    }
  }, [directoryChildren, loadChildren, openDirs, requestDir, tree, onOpenProject])

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

  function ensureOpenChain(dirPath: string) {
    if (!dirPath) return
    setOpenDirs((prev) => {
      const parts = dirPath.split('/')
      const missing: string[] = []
      let acc = ''
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part
        if (onOpenProject && projectPaths.has(acc)) break
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
    if (documentPages && type === 'file' && /\.md$/i.test(path)) { onDirectoryFocus?.(documentPageTarget(path)); return }
    onDirectoryFocus?.(type === 'dir' && !(onOpenProject && projectPaths.has(path)) ? path : parentOf(path))
  }

  function startRename(path: string, type: 'file' | 'dir') {
    if (readOnly) return
    const name = path.split('/').pop() ?? path
    setEditing({ mode: 'rename', path, type, value: name })
  }

  function startCreate(parentPath: string, kind: 'file' | 'folder') {
    if (readOnly) return
    const boundary = onOpenProject && [...projectPaths].find(path => parentPath === path || parentPath.startsWith(`${path}/`))
    if (boundary) {
      if (canOpenProjects) onOpenProject?.(boundary)
      return
    }
    setQuery('')
    ensureOpenChain(documentPages && parentPath.endsWith('.md') ? parentOf(parentPath) : parentPath)
    setEditing({ mode: documentPages || kind === 'file' ? 'create-file' : 'create-folder', parentPath, value: '' })
  }

  async function changePage(action: Parameters<typeof mutateDocumentPage>[0], path: string, name = '', destination = '') {
    const release = await onBeforePageMutation?.()
    try {
      const result = await mutateDocumentPage(action, path, name, destination)
      if (action === 'move') captureMove(path, result.path)
      pageOpenSequence.current++
      const remap = (path: string) => remapPagePath(path, result.moves)
      setOpenDirs(current => new Set([...current].map(remap)))
      setFocused(current => current ? { ...current, path: remap(current.path) } : null)
      const remapNode = (node: TreeNode): TreeNode => ({ ...node, path: remap(node.path), name: basenameOf(remap(node.path)), ...(node.children ? { children: node.children.map(remapNode) } : {}) })
      directoryChildrenRef.current = Object.fromEntries(Object.entries(directoryChildrenRef.current).map(([parent, nodes]) => [remap(parent), nodes.map(remapNode)]))
      setDirectoryChildren(directoryChildrenRef.current)
      onPageMutation?.(result)
      return result
    } finally { release?.() }
  }

  async function requestCopy(path: string) {
    if (readOnly) return
    try {
      if (documentPages && (path.endsWith('.md') || focused?.type === 'dir' && focused.path === path || popover?.type === 'dir' && popover.path === path)) {
        const result = await changePage('copy', path, '', parentOf(path))
        onFileCreated(result.path); return
      }
      const { relPath, hidden } = await copyFile(path, project)
      if (hidden) onNotice(notAllowed())
      // 새 파일 생성과 같은 후처리 — 트리 갱신 + 복사본을 탭으로 연다
      onFileCreated(relPath)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
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
      if (documentPages && (target.type === 'dir' || target.path.endsWith('.md'))) await changePage('delete', target.path)
      else await deleteFile(target.path, project)
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
        if (documentPages && (current.type === 'dir' || current.path.endsWith('.md'))) {
          const result = await changePage('rename', current.path, name)
          setEditing(null); ensureOpenChain(parentOf(result.path)); onFolderCreated(); return
        }
        const { hidden } = await renamePath(current.path, newPath, project)
        setEditing(null)
        // 바꾼 이름이 트리에 안 뜨는 종류면(확장자·숨김 목록) 사라진 것처럼 보인다 — 이유를 알린다
        if (hidden) onNotice(notAllowed())
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
      const name = sanitizeSegment(raw)
      if (!name) {
        setEditing({ ...current, busy: false, error: uiText("올바른 파일명을 입력하세요") })
        return
      }
      const relPath = current.parentPath ? `${current.parentPath}/${name}` : name
      try {
        if (documentPages) {
          const result = await changePage('create', current.parentPath, name)
          setEditing(null); ensureOpenChain(parentOf(result.path)); onFileCreated(result.path); return
        }
        const { relPath: created, hidden } = await createNewDocument(relPath, name.replace(/\.md$/i, '') || name, project)
        setEditing(null)
        if (hidden) onNotice(notAllowed())
        onFileCreated(created)
      } catch (err) {
        setEditing({ ...current, busy: false, error: err instanceof Error ? err.message : String(err) })
      }
    } else {
      const name = sanitizeSegment(raw)
      if (!name) {
        setEditing({ ...current, busy: false, error: uiText("올바른 폴더명을 입력하세요") })
        return
      }
      const relPath = current.parentPath ? `${current.parentPath}/${name}` : name
      try {
        const { hidden } = await createFolder(relPath, project)
        setEditing(null)
        if (hidden) onNotice(notAllowed())
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
      setErrorMsg(uiText("폴더를 자기 자신 안으로는 옮길 수 없습니다"))
      return
    }
    try {
      if (documentPages && (srcType === 'dir' || srcPath.endsWith('.md'))) {
        const result = await changePage('move', srcPath, '', destDir)
        ensureOpenChain(parentOf(result.path)); onFolderCreated(); return
      }
      const { hidden } = await renamePath(srcPath, newPath, project)
      if (hidden) onNotice(notAllowed())
      captureMove(srcPath, newPath)
      onRenamed(srcPath, newPath, srcType)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  // 복사 붙여넣기 — 내부적으로 terminal cp(=fs.cpSync, 폴더 재귀)인 /copy-into를 호출한다
  async function copyIntoDir(srcPath: string, srcType: 'file' | 'dir', destDir: string, sourceWorkspacePath: string | null) {
    if (readOnly) return
    if (sourceWorkspacePath === workspacePath && isSelfOrDescendant(srcPath, srcType, destDir)) {
      setErrorMsg(uiText("폴더를 자기 자신 안으로는 복사할 수 없습니다"))
      return
    }
    try {
      if (documentPages && sourceWorkspacePath === workspacePath && (srcType === 'dir' || srcPath.endsWith('.md'))) {
        const result = await changePage('copy', srcPath, '', destDir)
        ensureOpenChain(parentOf(result.path)); onFileCreated(result.path); return
      }
      const { relPath, hidden } = await copyInto(srcPath, destDir, project, sourceWorkspacePath === workspacePath ? null : sourceWorkspacePath)
      if (hidden) onNotice(notAllowed())
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
        setErrorMsg(uiText("다른 프로젝트로는 잘라내기 대신 복사해 붙여넣으세요"))
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
    focusNode(path, type)
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
    if (hiddenAny) onNotice(notAllowed())
  }

  function handleTreeKeyDown(e: React.KeyboardEvent) {
    if (readOnly || !focused || editing) return
    const targetParent = documentPages || focused.type === 'dir' ? focused.path : parentOf(focused.path)

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
        if (focused.type === 'file' || documentPages) void requestCopy(focused.path)
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

  // 최상위 MOC는 담을 폴더가 없으니 여기서 직접 세운다 — 프로젝트 전체의 입구라서 어떤 폴더보다 위에.
  // 하위 폴더의 MOC는 각 Node가 자기 첫 줄에 같은 모양으로 세운다.
  const rootMoc = useMemo(() => tree.find(isMocNode) ?? null, [tree])
  const rootNodes = useMemo(() => (rootMoc ? tree.filter((n) => !isMocNode(n)) : tree), [tree, rootMoc])

  const filteredPaths = useMemo((): FileSearchResult[] | null => {
    if (!query.trim()) return null
    const files = flattenFiles(tree).map((path) => ({ path, project, scope: { id: 'root', label: '', icon: 'i:folder' } }))
    return files
      .map((file) => ({ ...file, score: fuzzyScore(query, file.path) }))
      .filter((r): r is FileSearchResult & { score: number } => r.score !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 50)
  }, [tree, query, project])

  function selectSearchResult(result: FileSearchResult) {
    onSelect(result.path)
  }

  const rootCreateEditing =
    (editing?.mode === 'create-file' || editing?.mode === 'create-folder') && editing.parentPath === rootPath ? editing : null

  const ctx: NodeCtx = {
    project,
    documentPages,
    openPage: (node, opts) => {
      const sequence = ++pageOpenSequence.current
      focusNode(node.path, node.type)
      if (node.type === 'file') { onSelect(node.path, opts); return }
      const resolve = (children: TreeNode[]) => {
        if (sequence !== pageOpenSequence.current) return
        const representative = pageRepresentative(node.path, children)
        if (representative) onSelect(representative.path, opts)
        else ensureOpenChain(node.path)
      }
      const cached = node.children ?? directoryChildrenRef.current[node.path]
      if (cached) resolve(cached)
      else void requestDir(node.path).then(children => {
        if (children && sequence === pageOpenSequence.current) resolve(children)
      })
    },
    selectedPath,
    openPaths,
    focused,
    menuPath: popover?.path,
    openDirs,
    editing,
    readOnly,
    canUseCommands,
    openProject: onOpenProject,
    canOpenProjects,
    presence,
    directoryChildren,
    loadingDirs,
    dropDir,
    onSelect: (path, opts) => { pageOpenSequence.current++; focusNode(path, 'file'); onSelect(path, opts) },
    toggleDir,
    focusNode,
    startRename,
    startCreate,
    requestDelete,
    openPopover,
    setEditValue,
    submitEdit,
    cancelEdit,
        beginDrag,
    endDrag,
    canDropInto,
    onDragOverDir,
    onDropDir,
    onDropFiles: (dir, files) => void uploadFilesInto(dir, files),
    openGit: onOpenGit,
  }

  return (
    <div data-tree-key={persistedProject} className={compact ? 'bg-surface-deep' : 'flex h-full flex-col border-r border-edge bg-surface-deep'}>
      {dialogs.dialog}
      <div
        ref={listRef}
        tabIndex={-1}
        // 스크롤 위치도 기억한다 — 저장은 문서 스크롤과 같은 저장소가 모아서 쓴다(utils/scrollMemory.ts)
        onScroll={(e) => {
          if (e.target === e.currentTarget) recordScrollRef.current()
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
        className={`${compact ? 'py-1' : 'min-h-0 flex-1 overflow-y-auto pt-0.5 pb-[300px] [--tree-sticky-inset:2px]'} outline-none ${dropDir === '' ? 'ring-1 ring-inset ring-accent' : ''}`}
      >
        {roots}
        {commands}
        {filteredPaths !== null ? (
          filteredPaths.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-muted">{uiText("결과 없음")}</div>
          ) : (
            filteredPaths.map((result) => (
              <button
                key={`${result.project}:${result.path}`}
                type="button"
                onClick={() => selectSearchResult(result)}
                title={result.path}
                className="group relative flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm text-ink hover:bg-surface-raised"
              >
                {result.scope.label && <ProjectIcon icon={result.scope.icon} size={13} />}
                {/* direction:rtl + text-align:left → 넘칠 때 ...이 왼쪽에 붙어 오른쪽(파일명)이 보인다 */}
                <span style={{ direction: 'rtl', textAlign: 'left' }} className="min-w-0 flex-1 truncate">
                  {abbreviatePath(result.path)}
                </span>
                <PresenceDots colors={presence[result.path] ?? []} />
                {result.scope.label && <FileSearchPathTooltip result={result} />}
              </button>
            ))
          )
        ) : (
          <>
            {onOpenGraph && rootPath === '' && <button type="button" data-docs-graph-entry onClick={onOpenGraph}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 7 11 0M6 7l5 11M17 7l-6 11"/><circle cx="6" cy="7" r="2.5"/><circle cx="17" cy="7" r="2.5"/><circle cx="11" cy="18" r="2.5"/></svg>
              {uiText('그래프 보기')}
            </button>}
            {rootMoc && (
              <MocItem
                path={rootMoc.path}
                depth={0}
                label={documentPages ? uiText('문서 홈') : undefined}
                documentPages={documentPages}
                active={rootMoc.path === selectedPath}
                opened={openPaths?.has(rootMoc.path)}
                presenceColors={presence[rootMoc.path] ?? []}
                onSelect={(path, opts) => { focusNode(path, 'file'); onSelect(path, opts) }}
              />
            )}
            {rootCreateEditing && (
              <InlineInput
                value={rootCreateEditing.value}
                onChange={setEditValue}
                onCommit={submitEdit}
                onCancel={cancelEdit}
                error={rootCreateEditing.error}
                placeholder={documentPages ? uiText('새 문서 이름') : rootCreateEditing.mode === 'create-folder' ? uiText("새 폴더 이름") : uiText("새 파일 이름")}
                paddingLeft={8}
              />
            )}
            <NodeList nodes={rootNodes} depth={0} ctx={ctx} />
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
            popover.type === 'file' || documentPages
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
                  void pasteInto(documentPages ? popover.path : popover.type === 'dir' ? popover.path : parentOf(popover.path))
                  setPopover(null)
                }
              : undefined
          }
          onDownload={
            popover.type === 'file'
              ? <DownloadLink href={downloadUrl(popover.path, project)} name={popover.path.split('/').pop() ?? popover.path} onStarted={() => setPopover(null)} menuIcon={<Download />}>{t('fileExplorer.download')}</DownloadLink>
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
          onNewFile={onOpenProject && projectPaths.has(popover.path) ? undefined : () => {
            startCreate(documentPages ? popover.path : popover.type === 'dir' ? popover.path : parentOf(popover.path), 'file')
            setPopover(null)
          }}
          onNewFolder={documentPages ? undefined : onOpenProject && projectPaths.has(popover.path) ? undefined : () => {
            startCreate(popover.type === 'dir' ? popover.path : parentOf(popover.path), 'folder')
            setPopover(null)
          }}
          onUpload={onOpenProject && projectPaths.has(popover.path) ? undefined : () => {
            triggerUpload(popover.type === 'dir' ? popover.path : parentOf(popover.path))
            setPopover(null)
          }}
          onCreateSubproject={
            !creatingProject && popover.type === 'dir' && popover.path !== '' && popover.path !== rootPath
              && !popover.path.split('/').includes('.mew') && !projectPaths.has(popover.path)
              ? () => { void makeSubproject(popover.path); setPopover(null) }
              : undefined
          }
          onInitGit={
            canUseGit && popover.type === 'dir' && popover.path !== '' && !gitPaths.has(popover.path)
              ? () => {
                  initGit(popover.path)
                  setPopover(null)
                }
              : undefined
          }
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
          message={uiText("{p0} \"{p1}\"을(를) 삭제할까요?", { p0: deleteTarget.type === 'dir' ? uiText("폴더") : uiText("파일"), p1: deleteTarget.path })}
          detail={uiText("이 작업은 되돌릴 수 없습니다.")}
          confirmLabel={uiText("삭제")}
          danger
          onConfirm={deleteConfirmed}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {errorMsg !== null && <ConfirmDialog message={errorMsg} onConfirm={() => setErrorMsg(null)} />}
    </div>
  )
}

function FileSearchPathTooltip({ result }: { result: FileSearchResult }) {
  useUiLocale()
  const parts = result.path.split('/').filter(Boolean)
  const relative = result.scope.id.startsWith('subproject:') ? parts.slice(1) : parts
  return <div className="pointer-events-none absolute left-2 top-full z-40 hidden min-w-[15rem] max-w-[22rem] rounded border border-edge-bright bg-surface-deep p-3 text-xs shadow-xl group-hover:block">
    <div className="mb-2 flex items-center gap-2 font-medium text-ink"><ProjectIcon icon={result.scope.icon} size={16} /><span>{result.scope.label}</span></div>
    <div className="space-y-1 text-ink-secondary">{relative.map((part, index) => <div key={`${part}:${index}`} className="flex items-center gap-1" style={{ paddingLeft: `${index * 12}px` }}><span className="text-ink-faint">ㄴ</span><span className={index === relative.length - 1 ? 'text-ink' : ''}>{part}</span></div>)}</div>
  </div>
}
