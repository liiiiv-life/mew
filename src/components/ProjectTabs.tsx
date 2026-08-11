// 프로젝트 탭 — 라우트 대신 탭으로 프로젝트를 오간다(주소는 바뀌지 않는다).
//
// 볼 수 있는 프로젝트는 **전부** 맨 윗줄에 선다(닫기 없음, 순서는 팝업 격자에서 정한 자리).
// 생김새는 아래 문서 탭 줄과 같게: 테두리 없이 세로 구분선만, 선택된 탭은 배경만 밝아진다.
// 데스크톱은 아이콘+이름, 모바일은 아이콘만 — 단 **지금 보고 있는 탭은 모바일에서도 이름을 보여준다**
// (아이콘만 늘어선 줄에서 어디에 있는지 알 수 있어야 한다).
//
// - 그냥 누르면: 그 프로젝트를 연다 (문서 탭·사이드바가 그 프로젝트 것으로 바뀐다).
//   **모바일에서 지금 보고 있지 않은 탭은 한 번에 열리지 않는다** — 아이콘만 보이는 탭이라 무엇을
//   누르는지 모른 채 프로젝트가 통째로 바뀌기 때문이다. 첫 탭은 이름표(ProjectPeek)를 띄우고,
//   같은 탭이나 이름표를 한 번 더 눌러야 옮겨 간다. 이름표에는 그 프로젝트의 ▶도 같이 있다.
// - 꾹 눌렀다 떼면(모바일) 또는 우클릭하면(데스크톱): 프로젝트 격자 팝업 (아이콘·자리 배치·생성·개명·삭제)
// - 꾹 누른 채 좌우로 끌면(모바일 0.35초·마우스 0.5초): 탭 순서가 바뀐다 — 문서 탭 줄과 같은 훅(useDragReorder)이고,
//   바뀐 순서는 팝업 격자의 자리(slot)로 그대로 저장된다. 꾹 누르기 전에 끌면 탭 줄이 좌우로 굴러갈 뿐이다
// - 탭 오른쪽: 그 프로젝트의 명령어 버튼(▶). 모바일은 좁으니 활성 탭에서만 보인다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDragReorder, useOverlayDismiss, type DragItemProps } from '@mew/ui'
import type { ProjectInfo } from '../api/client'
import { hasIcon } from '../utils/projectIcons'
import { CommandButtonMenu } from './CommandButtonMenu'
import { ProjectIcon } from './ProjectIcon'

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

/** 이름표를 화면 좌우에서 이만큼은 띄운다 */
const PEEK_MARGIN_PX = 8

function ProjectGlyph({ project, size }: { project: ProjectInfo; size: number }) {
  // 모바일은 이름을 감추므로 아이콘이 없거나 모르는 키면 탭이 텅 빈다 — 첫 글자로 대신한다
  if (hasIcon(project.icon)) return <ProjectIcon icon={project.icon!} size={size} />
  return (
    <span className="font-semibold leading-none" style={{ fontSize: size * 0.72 }}>
      {project.name[0]?.toUpperCase()}
    </span>
  )
}

export function ProjectTabs({
  projects,
  activeProject,
  canUseTerminal,
  canReorder,
  onActivate,
  onOpenPicker,
  onReorder,
  onReorderEnd,
}: {
  /** 탭 줄에 세울 프로젝트들 (표시 순서대로) */
  projects: ProjectInfo[]
  activeProject: string
  canUseTerminal: boolean
  /** 배치 저장은 로그인 사용자만 — 게스트는 끌어도 아무 일도 일어나지 않는다 */
  canReorder: boolean
  onActivate: (name: string) => void
  onOpenPicker: () => void
  /** 끄는 동안 화면의 순서만 바꾼다 (탭 하나를 지날 때마다 호출된다) */
  onReorder: (from: number, to: number) => void
  /** 손을 뗐다 — 여기서 한 번만 서버에 저장한다 */
  onReorderEnd: () => void
}) {
  // 이번 제스처가 어디까지 왔는지: 'armed'는 꾹 누르기만 한 상태(떼면 팝업), 'dragging'은 순서를 바꾸는 중
  const gestureRef = useRef<'none' | 'armed' | 'dragging'>('none')
  const movedRef = useRef(false)
  // 모바일에서 이름표를 띄우고 있는 탭 — 한 번 더 눌러야 실제로 그 프로젝트로 옮겨 간다
  const [peek, setPeek] = useState<{ name: string; centerX: number; top: number } | null>(null)

  function activate(name: string) {
    setPeek(null)
    onActivate(name)
  }

  const drag = useDragReorder({
    onReorder: (from, to) => {
      if (!canReorder) return
      movedRef.current = true
      onReorder(from, to)
    },
    // 터치로 꾹 누른 시점 — 아직 팝업을 열지 않는다. 여기서 열면 이어서 끌 때 팝업이 손끝을 덮는다
    onLongPress: () => {
      gestureRef.current = 'armed'
    },
    onDragStart: () => {
      gestureRef.current = 'dragging'
      // 탭이 움직이기 시작하면 이름표는 붙어 있던 자리를 잃는다 — 같이 걷는다
      setPeek(null)
    },
  })

  function endGesture(opened: boolean) {
    const phase = gestureRef.current
    gestureRef.current = 'none'
    if (movedRef.current) {
      movedRef.current = false
      onReorderEnd()
    }
    // 꾹 누르기만 하고 뗐으면(끌지 않았으면) 그때 팝업을 연다 — 격자 팝업이 뜨면 이름표는 물러난다
    if (opened && phase === 'armed') {
      setPeek(null)
      onOpenPicker()
    }
  }

  return (
    <div data-project-tabs className="no-scrollbar flex h-full min-w-0 flex-1 items-stretch overflow-x-auto">
      {projects.map((p, i) => {
        const { ref, ...handlers } = drag.getItemProps(i)
        return (
          <ProjectTab
            key={p.name}
            tabRef={ref}
            project={p}
            active={p.name === activeProject}
            dragging={drag.dragIndex === i}
            canUseTerminal={canUseTerminal}
            pressProps={{
              ...handlers,
              onPointerUp: (e: React.PointerEvent) => {
                handlers.onPointerUp(e)
                endGesture(true)
              },
              onPointerCancel: (e: React.PointerEvent) => {
                handlers.onPointerCancel(e)
                endGesture(false)
              },
            }}
            onClick={(e) => {
              // 끌었거나 꾹 눌렀던 직후의 click은 흘린다 — 옮긴 탭이 열려버리지 않게
              if (drag.consumeClick()) return
              // 모바일에서 아직 이름을 못 본 탭이면 이름표부터 — 두 번째 탭에서 실제로 옮긴다
              if (!isDesktop() && p.name !== activeProject && peek?.name !== p.name) {
                const r = e.currentTarget.getBoundingClientRect()
                setPeek({ name: p.name, centerX: r.left + r.width / 2, top: r.bottom + 4 })
                return
              }
              activate(p.name)
            }}
            onContextMenu={(e) => {
              // 모바일 롱프레스가 부르는 네이티브 메뉴를 막고, 데스크톱에서는 우클릭 = 팝업.
              // 터치 제스처가 진행 중이면(꾹 누르기·드래그) 팝업은 손을 뗄 때 판단한다.
              e.preventDefault()
              if (gestureRef.current === 'none') onOpenPicker()
            }}
          />
        )
      })}
      {peek && (
        <ProjectPeek
          name={peek.name}
          centerX={peek.centerX}
          top={peek.top}
          canUseTerminal={canUseTerminal}
          onActivate={() => activate(peek.name)}
          onDismiss={() => setPeek(null)}
        />
      )}
    </div>
  )
}

/**
 * 모바일에서 아이콘만 보이는 탭을 처음 눌렀을 때 뜨는 이름표. 이름을 누르면 그 프로젝트로 옮겨 가고,
 * 옆의 ▶는 활성 탭에 붙는 것과 같은 명령어 버튼이다 — 프로젝트를 바꾸지 않고도 명령을 돌릴 수 있다.
 * 탭 줄이 가로 스크롤 컨테이너라 안에 두면 잘린다 — body로 포털해 fixed로 띄운다.
 */
function ProjectPeek({
  name,
  centerX,
  top,
  canUseTerminal,
  onActivate,
  onDismiss,
}: {
  name: string
  centerX: number
  top: number
  canUseTerminal: boolean
  onActivate: () => void
  onDismiss: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)

  // Esc·모바일 뒤로가기로 이름표만 닫는다
  useOverlayDismiss(onDismiss)

  // 탭 가운데에 맞추되 화면 밖으로는 나가지 않게 민다 — 폭은 그려 봐야 알 수 있어서 그린 뒤에 잰다
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.transform = 'translateX(-50%)'
    const r = el.getBoundingClientRect()
    let dx = 0
    if (r.left < PEEK_MARGIN_PX) dx = PEEK_MARGIN_PX - r.left
    else if (r.right > window.innerWidth - PEEK_MARGIN_PX) dx = window.innerWidth - PEEK_MARGIN_PX - r.right
    if (dx !== 0) el.style.transform = `translateX(calc(-50% + ${dx}px))`
  }, [name, centerX])

  // 드래그 중에도 부모가 계속 다시 그려진다 — 리스너를 매번 다시 달지 않도록 최신 함수만 ref로 잡는다
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  // 바깥을 누르면 닫는다. 단 두 곳은 예외다:
  // - 탭 줄: 같은 탭을 한 번 더 누르는 것이 "이동" 신호다. 여기서 닫아 버리면 뒤따라 오는 click이
  //   이름표를 다시 띄워, 두 번째 탭이 영영 이동이 되지 않는다. 판단은 탭의 click 핸들러가 한다.
  // - ▶가 띄우는 드롭다운·수정 창: body로 포털돼 이 상자 밖이라, 닫으면 메뉴까지 같이 사라진다.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      const target = e.target as Element | null
      if (boxRef.current?.contains(target as Node)) return
      if (target?.closest?.('[data-project-tabs],[data-cmd-overlay]')) return
      dismissRef.current()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [])

  return createPortal(
    <div
      ref={boxRef}
      style={{ left: centerX, top, transform: 'translateX(-50%)' }}
      className="fixed z-[1040] flex items-center gap-1 rounded-lg border border-edge-bright bg-surface-raised py-1 pl-2.5 pr-1.5 shadow-xl"
    >
      <button
        type="button"
        onClick={onActivate}
        className="max-w-[12rem] truncate text-xs text-ink"
        style={{ touchAction: 'manipulation' }}
      >
        {name}
      </button>
      {canUseTerminal && <CommandButtonMenu project={name} />}
    </div>,
    document.body,
  )
}

function ProjectTab({
  tabRef,
  project,
  active,
  dragging,
  canUseTerminal,
  pressProps,
  onClick,
  onContextMenu,
}: {
  /** 드래그가 자리를 재는 기준 요소 — 탭 전체(▶ 포함)를 등록한다 */
  tabRef: DragItemProps['ref']
  project: ProjectInfo
  active: boolean
  dragging: boolean
  canUseTerminal: boolean
  pressProps: Omit<DragItemProps, 'ref'>
  /** 이름표를 탭 바로 아래에 놓아야 해서 이벤트째로 받는다 (currentTarget의 위치를 잰다) */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    // 탭을 여는 건 이름 버튼뿐이다 — ▶를 감싸는 컨테이너에 onClick·포인터 핸들러를 걸면 안 된다.
    // 드롭다운이 포털이라도 React 트리에서는 이 안이라, 메뉴 클릭이 여기까지 버블링된다.
    // 다만 드래그가 자리를 재는 기준(ref)은 ▶까지 포함한 탭 전체여야 한다.
    <div
      ref={tabRef}
      className={`flex h-full shrink-0 select-none items-center border-r border-edge text-xs [-webkit-touch-callout:none] ${
        active ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary hover:bg-surface-raised'
      } ${canUseTerminal ? 'pr-1.5' : ''} ${dragging ? 'opacity-70 ring-1 ring-inset ring-accent' : ''}`}
    >
      <button
        type="button"
        {...pressProps}
        onClick={onClick}
        onContextMenu={onContextMenu}
        className="flex h-full min-w-0 items-center gap-1.5 px-2.5"
        style={{ touchAction: 'manipulation' }}
        title={`${project.name} — 꾹 눌러 좌우로 끌면 순서 바꾸기, 떼면(우클릭) 프로젝트 팝업`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <ProjectGlyph project={project} size={17} />
        </span>
        {/* 모바일에서는 보고 있는 탭만 이름을 편다 — 나머지는 아이콘만 (탭 줄이 한 화면에 들어와야 한다) */}
        <span className={`max-w-[10rem] truncate ${active ? 'inline' : 'hidden md:inline'}`}>{project.name}</span>
      </button>
      {/* 모바일은 탭이 좁다 — ▶는 지금 보고 있는 프로젝트에만 붙인다 */}
      {canUseTerminal && (
        <span className={`items-center ${active ? 'flex' : 'hidden md:flex'}`}>
          <CommandButtonMenu project={project.name} />
        </span>
      )}
    </div>
  )
}
