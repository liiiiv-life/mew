import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import type { Editor } from '@tiptap/react'

// 테이블 행/열 추가·제거 십자 툴팁 — 커서를 중앙에 두고 방향키와 같은 방향에 버튼 배치
export function TableTooltip({
  editor,
  position,
  onClose,
  mode,
}: {
  editor: Editor | null
  position: { top: number; left: number }
  onClose: () => void
  mode: 'add' | 'remove'
}) {
  useUiLocale()
  const handleCommand = (cmd: string) => {
    switch (cmd) {
      case 'addRowBefore':
        editor?.chain().focus().addRowBefore().run()
        break
      case 'addRowAfter':
        editor?.chain().focus().addRowAfter().run()
        break
      case 'addColBefore':
        editor?.chain().focus().addColumnBefore().run()
        break
      case 'addColAfter':
        editor?.chain().focus().addColumnAfter().run()
        break
      case 'removeRow':
        editor?.chain().focus().deleteRow().run()
        break
      case 'removeCol':
        editor?.chain().focus().deleteColumn().run()
        break
    }
    onClose()
  }

  const buttonStyle = {
    pointerEvents: 'auto',
    backgroundColor: 'var(--color-surface-raised)',
    border: '1px solid var(--color-edge-bright)',
    color: 'var(--color-ink)',
    padding: '4px 8px',
    borderRadius: '3px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    cursor: 'pointer',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  } as const

  const [up, down, left, right] =
    mode === 'add'
      ? ([
          ['addRowBefore', uiText("↑ 행 추가")],
          ['addRowAfter', uiText("↓ 행 추가")],
          ['addColBefore', uiText("← 열 추가")],
          ['addColAfter', uiText("→ 열 추가")],
        ] as const)
      : ([
          ['removeRow', uiText("↑ 행 제거")],
          ['removeRow', uiText("↓ 행 제거")],
          ['removeCol', uiText("← 열 제거")],
          ['removeCol', uiText("→ 열 제거")],
        ] as const)

  return (
    <div
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        display: 'grid',
        gridTemplateColumns: 'auto auto auto',
        gridTemplateRows: 'auto auto auto',
        gap: '6px',
        pointerEvents: 'none',
      }}
    >
      <button onMouseDown={() => handleCommand(up[0])} style={{ ...buttonStyle, gridColumn: 2, gridRow: 1, justifySelf: 'center' }}>
        {up[1]}
      </button>
      <button onMouseDown={() => handleCommand(left[0])} style={{ ...buttonStyle, gridColumn: 1, gridRow: 2, alignSelf: 'center' }}>
        {left[1]}
      </button>
      <button onMouseDown={() => handleCommand(right[0])} style={{ ...buttonStyle, gridColumn: 3, gridRow: 2, alignSelf: 'center' }}>
        {right[1]}
      </button>
      <button onMouseDown={() => handleCommand(down[0])} style={{ ...buttonStyle, gridColumn: 2, gridRow: 3, justifySelf: 'center' }}>
        {down[1]}
      </button>
    </div>
  )
}
