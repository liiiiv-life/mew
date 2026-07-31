// 마우스를 올리면 **기다림 없이** 뜨는 이름표. 브라우저 기본 title은 1초쯤 지나야 나오고 위치도
// 고를 수 없어서, 아이콘만 있는 버튼 줄에서는 사실상 이름이 없는 것과 같다.
//
// 배선은 껍데기 하나로 끝난다 — 이 안에서 `data-tip="이름"`이 붙은 요소면 무엇이든 대상이 된다.
// 버튼마다 훅을 걸지 않으므로 나중에 늘어나는 버튼도 속성 하나만 붙이면 그냥 따라온다.
// 이름표는 body로 포털한다: 버튼 줄이 overflow-x-auto라 안에 두면 잘린다.
// 터치에서는 뜨지 않는다 — 손가락엔 hover가 없고, 그 자리는 탭·길게누르기가 이미 쓰고 있다.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** 버튼과 이름표 사이 간격 */
const GAP_PX = 6
/** 화면 좌우에서 이만큼은 띄운다 */
const MARGIN_PX = 8

type Tip = { label: string; centerX: number; top: number }

function closestTipEl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const el = target.closest('[data-tip]')
  return el instanceof HTMLElement && el.dataset.tip ? el : null
}

export function HoverTipLayer({ className, children }: { className?: string; children: ReactNode }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  // 지금 이름표를 띄우고 있는 버튼 — 같은 버튼 안(아이콘↔여백)을 오갈 때 깜빡이지 않게 한다
  const shownForRef = useRef<HTMLElement | null>(null)

  // 이름표는 버튼 가운데에 맞춰 띄우되 화면 밖으로는 나가지 않게 민다. 폭은 그려 봐야 알 수 있어서
  // 그린 뒤에 재고 transform만 고친다 — 페인트 전에 끝나므로 튀어 보이지 않는다.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!el) return
    el.style.transform = 'translate(-50%, -100%)'
    const r = el.getBoundingClientRect()
    let dx = 0
    if (r.left < MARGIN_PX) dx = MARGIN_PX - r.left
    else if (r.right > window.innerWidth - MARGIN_PX) dx = window.innerWidth - MARGIN_PX - r.right
    if (dx !== 0) el.style.transform = `translate(calc(-50% + ${dx}px), -100%)`
  }, [tip])

  function onPointerOver(e: React.PointerEvent) {
    if (e.pointerType !== 'mouse') return
    const el = closestTipEl(e.target)
    if (!el || el === shownForRef.current) return
    shownForRef.current = el
    const r = el.getBoundingClientRect()
    setTip({ label: el.dataset.tip!, centerX: r.left + r.width / 2, top: r.top - GAP_PX })
  }

  function onPointerOut(e: React.PointerEvent) {
    const from = shownForRef.current
    if (!from) return
    // 같은 버튼 안쪽으로 옮겨 간 것뿐이면 그대로 둔다
    const to = e.relatedTarget
    if (to instanceof Node && from.contains(to)) return
    shownForRef.current = null
    setTip(null)
  }

  function hide() {
    shownForRef.current = null
    setTip(null)
  }

  return (
    <div className={className} onPointerOver={onPointerOver} onPointerOut={onPointerOut} onPointerDown={hide}>
      {children}
      {tip &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            // width:max-content가 없으면 폭이 `left`에 딸려 간다 — fixed 요소의 남는 자리는
            // (뷰포트 너비 − left)라, 오른쪽 끝 버튼에서는 이름표가 한 글자씩 접힌 기둥이 된다.
            // 내용만큼 펴 두고 아래 useLayoutEffect가 화면 안으로 밀어 넣는다.
            style={{ left: tip.centerX, top: tip.top, transform: 'translate(-50%, -100%)', width: 'max-content' }}
            className="pointer-events-none fixed z-[1200] max-w-xs rounded border border-edge-bright bg-surface-raised px-2 py-1 text-xs whitespace-pre-line text-ink shadow-lg"
          >
            {tip.label}
          </div>,
          document.body,
        )}
    </div>
  )
}
