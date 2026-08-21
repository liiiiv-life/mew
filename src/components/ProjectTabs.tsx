// 프로젝트 탭 — 라우트 대신 탭으로 프로젝트를 오간다(주소는 바뀌지 않는다).
//
// 볼 수 있는 프로젝트는 **전부** 맨 윗줄에 선다(닫기 없음, 순서는 팝업 격자에서 정한 자리).
// 생김새는 아래 문서 탭 줄과 같게: 테두리 없이 세로 구분선만, 선택된 탭은 배경만 밝아진다.
// 데스크톱은 아이콘+이름, 모바일은 아이콘만 — 단 **지금 보고 있는 탭은 모바일에서도 이름을 보여준다**
// (아이콘만 늘어선 줄에서 어디에 있는지 알 수 있어야 한다).
//
// - 그냥 누르면: 그 프로젝트를 연다 (문서 탭·사이드바가 그 프로젝트 것으로 바뀐다).
// - 꾹 눌렀다 떼면(모바일) 또는 우클릭하면(데스크톱): 프로젝트 격자 팝업 (아이콘·자리 배치·생성·개명·삭제)
// - 꾹 누른 채 좌우로 끌면(모바일 0.35초·마우스 0.5초): 탭 순서가 바뀐다 — 문서 탭 줄과 같은 훅(useDragReorder)이고,
//   바뀐 순서는 팝업 격자의 자리(slot)로 그대로 저장된다. 꾹 누르기 전에 끌면 탭 줄이 좌우로 굴러갈 뿐이다
// - 탭 오른쪽: 그 프로젝트의 명령어 버튼(▶). 모바일은 좁으니 활성 탭에서만 보인다.
import { useRef } from 'react'
import { useDragReorder, type DragItemProps } from '@mew/ui'
import type { ProjectInfo } from '../api/client'
import { hasIcon } from '../utils/projectIcons'
import { CommandButtonMenu } from './CommandButtonMenu'
import { ProjectIcon } from './ProjectIcon'

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
    },
  })

  function endGesture(opened: boolean) {
    const phase = gestureRef.current
    gestureRef.current = 'none'
    if (movedRef.current) {
      movedRef.current = false
      onReorderEnd()
    }
    // 꾹 누르기만 하고 뗐으면(끌지 않았으면) 그때 팝업을 연다
    if (opened && phase === 'armed') onOpenPicker()
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
            onClick={() => {
              // 끌었거나 꾹 눌렀던 직후의 click은 흘린다 — 옮긴 탭이 열려버리지 않게
              if (drag.consumeClick()) return
              onActivate(p.name)
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
    </div>
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
  onClick: () => void
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
