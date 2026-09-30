import { canAutoFocusInput } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useEffect, useRef, useState } from 'react'
import { nextFieldKey, type FrontmatterData } from '../utils/frontmatter'
import { isExternalHref, resolveRelativePath } from '../utils/fuzzy'

// frontmatter는 본문(tiptap) 밖에서 다룬다 — 편집 가능한 리치텍스트 흐름에 섞이면 사용자가
// 실수로 YAML 구조를 깨뜨릴 수 있다. title 외 모든 필드(desc/created/updated 포함)는 동일하게
// 취급하는 자유 key-value 목록 — 여기서 추가·수정·삭제·순서변경한다. 값에 :이 있어도 되지만 키에는 안 됨.
export function FrontmatterPanel({
  data,
  onChange,
  readOnly,
  docPath = '',
  onOpenLink,
}: {
  data: FrontmatterData
  onChange: (next: FrontmatterData) => void
  readOnly?: boolean
  /** 상대 링크 해석 기준이 되는 현재 문서 경로 */
  docPath?: string
  onOpenLink?: (path: string) => void
}) {
  useUiLocale()
  // 드래그 중인 필드의 index와, 현재 드롭 지점(어느 필드의 위/아래인지). 순수 시각 표시용.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [over, setOver] = useState<{ index: number; after: boolean } | null>(null)
  // 값 입력창을 붙잡고 있는 필드. 링크가 든 값은 평소엔 렌더된 모습으로 보여주고, 이 필드일 때만
  // 원본 마크다운을 인풋으로 편집한다. 링크가 없는 값도 포커스되는 동안은 여기 잡아둬야
  // 타이핑 도중 `[a](b)`가 완성되는 순간 인풋이 사라지는 일이 없다.
  const [editing, setEditing] = useState<number | null>(null)
  const editingRef = useRef<HTMLInputElement | null>(null)

  // 렌더 뷰 → 인풋으로 막 바뀐 경우에만 포커스를 옮긴다. 이미 포커스된 인풋(사용자가 글 중간을
  // 클릭한 경우)에는 손대지 않는다 — 캐럿이 끝으로 튀어버린다.
  useEffect(() => {
    const el = editingRef.current
    if (!el || document.activeElement === el) return
    if (canAutoFocusInput()) el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  function openLink(href: string) {
    if (isExternalHref(href)) window.open(href, '_blank', 'noopener,noreferrer')
    else onOpenLink?.(resolveRelativePath(docPath, href))
  }

  function setTitle(title: string) {
    onChange({ ...data, title })
  }
  function setFieldKey(index: number, key: string) {
    onChange({ ...data, fields: data.fields.map((f, i) => (i === index ? { ...f, key } : f)) })
  }
  function setFieldValue(index: number, value: string) {
    onChange({ ...data, fields: data.fields.map((f, i) => (i === index ? { ...f, value } : f)) })
  }
  function removeField(index: number) {
    onChange({ ...data, fields: data.fields.filter((_, i) => i !== index) })
  }
  function addField() {
    onChange({ ...data, fields: [...data.fields, { key: nextFieldKey(data.fields), value: '' }] })
  }

  // fields 배열 순서가 곧 YAML 직렬화 순서(joinFrontmatter)라, 재배치는 로컬 배열만 옮기면 된다.
  // `before`는 "이 원본 index 앞에 끼워넣는다"는 뜻 — 제거로 인한 인덱스 밀림을 보정한다.
  function moveField(from: number, before: number) {
    const insertAt = from < before ? before - 1 : before
    if (from === insertAt) return
    const fields = [...data.fields]
    const [moved] = fields.splice(from, 1)
    fields.splice(insertAt, 0, moved)
    onChange({ ...data, fields })
  }

  function endDrag() {
    setDragIndex(null)
    setOver(null)
  }

  return (
    // mt-12: App.tsx가 우측 상단(top-3/right-3)에 Hotview/Plain 토글을 겹쳐 띄우므로 그 아래로 여유를 둔다.
    // 본문 H1과 같은 역할을 대신하는 자리라 제목만 그만큼 크게 — border-b로 아래 본문과 구분한다.
    <div className="mx-8 mt-12 mb-2 border-b border-edge pb-3">
      <input
        value={data.title}
        onChange={(e) => setTitle(e.target.value)}
        readOnly={readOnly}
        placeholder={uiText("제목")}
        className="w-full border-none bg-transparent text-3xl leading-tight font-bold text-ink-bright outline-none placeholder:text-ink-faint"
      />
      <div className="mt-3 flex flex-col gap-1">
        {data.fields.map((field, i) => (
          <div
            key={i}
            // 위/아래 2px 투명 테두리를 항상 둬서 드롭 인디케이터가 켜져도 행 높이가 흔들리지 않게 한다.
            className={`group flex items-center gap-1 border-y-2 border-transparent ${
              dragIndex === i ? 'opacity-40' : ''
            } ${over && over.index === i && dragIndex !== i ? (over.after ? 'border-b-accent' : 'border-t-accent') : ''}`}
            onDragOver={(e) => {
              if (dragIndex === null) return // 외부(파일 등) 드래그는 무시
              e.preventDefault()
              const rect = e.currentTarget.getBoundingClientRect()
              setOver({ index: i, after: e.clientY > rect.top + rect.height / 2 })
            }}
            onDrop={(e) => {
              if (dragIndex === null) return
              e.preventDefault()
              moveField(dragIndex, over && over.after ? i + 1 : i)
              endDrag()
            }}
          >
            {!readOnly && (
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(i)) // 파이어폭스는 데이터가 있어야 드래그를 시작한다
                  setDragIndex(i)
                }}
                onDragEnd={endDrag}
                aria-label={uiText("필드 순서 변경")}
                title={uiText("드래그해서 순서 변경")}
                className="shrink-0 cursor-grab rounded px-0.5 text-ink-faint opacity-0 hover:text-ink-muted group-hover:opacity-100 active:cursor-grabbing"
              >
                <GripIcon />
              </button>
            )}
            <input
              value={field.key}
              onChange={(e) => setFieldKey(i, e.target.value)}
              readOnly={readOnly}
              placeholder={uiText("필드명")}
              className="w-24 shrink-0 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-muted outline-none hover:border-edge focus:border-edge-bright"
            />
            {editing !== i && hasLink(field.value) ? (
              // 링크가 든 값은 마크다운 원문 대신 렌더된 모습으로 — 링크 밖 아무 데나(빈 여백 포함)
              // 누르면 원문 편집으로 돌아간다. 값 전체가 링크라도 오른쪽 여백이 편집 진입로가 된다.
              <div
                onMouseDown={(e) => {
                  if (readOnly || (e.target as HTMLElement).closest('a')) return
                  setEditing(i)
                }}
                className={`min-w-0 flex-1 truncate rounded border border-transparent px-1 py-0.5 text-xs text-ink-secondary hover:border-edge ${
                  readOnly ? '' : 'cursor-text'
                }`}
              >
                {splitLinks(field.value).map((seg, s) =>
                  seg.href === undefined ? (
                    <span key={s}>{seg.text}</span>
                  ) : (
                    <a
                      key={s}
                      href={seg.href}
                      title={seg.href}
                      onClick={(e) => {
                        e.preventDefault()
                        openLink(seg.href!)
                      }}
                      className="text-link underline"
                    >
                      {seg.text}
                    </a>
                  ),
                )}
              </div>
            ) : (
              <input
                ref={editing === i ? editingRef : undefined}
                value={field.value}
                onChange={(e) => setFieldValue(i, e.target.value)}
                onFocus={() => setEditing(i)}
                onBlur={() => setEditing((cur) => (cur === i ? null : cur))}
                readOnly={readOnly}
                placeholder={uiText("값")}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-ink-secondary outline-none hover:border-edge focus:border-edge-bright"
              />
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => removeField(i)}
                aria-label={uiText("필드 삭제")}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-faint opacity-0 hover:bg-surface-hover hover:text-ink group-hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button
            type="button"
            onClick={addField}
            className="mt-1 self-start rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            {uiText("+ 필드 추가")}</button>
        )}
      </div>
    </div>
  )
}

// 값은 YAML 한 줄이라 인라인 마크다운 중 링크만 다룬다 — 라벨에 ]가, 주소에 )가 없다고 본다.
const LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g

interface ValueSegment {
  text: string
  /** 링크 조각일 때만 채워진다 */
  href?: string
}

function splitLinks(value: string): ValueSegment[] {
  const segments: ValueSegment[] = []
  let last = 0
  for (const m of value.matchAll(LINK_RE)) {
    if (m.index > last) segments.push({ text: value.slice(last, m.index) })
    // 라벨이 비어 있으면([]( )) 주소를 대신 보여준다 — 클릭할 게 없으면 링크가 아니다
    segments.push({ text: m[1] || m[2], href: m[2] })
    last = m.index + m[0].length
  }
  if (last < value.length) segments.push({ text: value.slice(last) })
  return segments
}

// test()/exec()로 판정하지 않는다 — /g 정규식은 lastIndex가 남아 뒤이은 splitLinks가 값 중간부터
// 훑게 된다. matchAll은 원본 regex를 건드리지 않으므로 같은 경로를 두 번 타는 편이 안전하다.
function hasLink(value: string): boolean {
  return splitLinks(value).some((seg) => seg.href !== undefined)
}

// 세로 6점 그립 — 드래그 핸들임을 알린다 (노션식)
function GripIcon() {
  useUiLocale()
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.2" />
      <circle cx="7" cy="3" r="1.2" />
      <circle cx="3" cy="7" r="1.2" />
      <circle cx="7" cy="7" r="1.2" />
      <circle cx="3" cy="11" r="1.2" />
      <circle cx="7" cy="11" r="1.2" />
    </svg>
  )
}
