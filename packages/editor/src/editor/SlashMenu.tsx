import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
// 슬래시(/) 커맨드 메뉴 — '/' 입력 시 뜨고 이어 타이핑하면 실시간으로 필터된다 (노션식).
// 선택은 클릭/탭(onMouseDown) 또는 키보드(↑↓·Enter, Editor.tsx의 handleKeyDown 참고)로 한다.
import type { Editor as TiptapEditor } from '@tiptap/react'

export interface SlashCommand {
  id: string
  title: string
  description: string
  // 검색어 매칭용 별칭 (한글·영문)
  keywords: string[]
  // range는 '/query' 텍스트 범위 — run 안에서 deleteRange(range)로 지운 뒤 실제 동작을 넣는다
  run: (editor: TiptapEditor, range: { from: number; to: number }) => void
}

export function SlashMenu({
  position,
  commands,
  selectedIndex,
  onSelect,
}: {
  position: { top: number; left: number }
  commands: SlashCommand[]
  selectedIndex: number
  onSelect: (command: SlashCommand) => void
}) {
  useUiLocale()
  return (
    <div
      style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 1000 }}
      className="max-h-72 w-64 overflow-y-auto rounded border border-edge-bright bg-surface-raised p-1 shadow-lg"
    >
      {commands.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-ink-muted">{uiText("일치하는 명령 없음")}</div>
      ) : (
        commands.map((command, i) => (
          <button
            key={command.id}
            type="button"
            onMouseDown={() => onSelect(command)}
            className={`block w-full rounded px-2 py-1 text-left ${
              i === selectedIndex ? 'bg-accent text-ink-on-accent' : 'text-ink hover:bg-surface-hover'
            }`}
          >
            <div className="truncate text-xs font-medium">{command.title}</div>
            <div className="truncate text-[10px] opacity-70">{command.description}</div>
          </button>
        ))
      )}
    </div>
  )
}
