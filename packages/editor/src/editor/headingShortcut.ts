import { Extension } from '@tiptap/core'

// Alt+1~6 — 커서가 있는 줄을 그 레벨 제목으로 바꾼다 (마크다운의 `# `~`###### `).
// 같은 레벨을 다시 누르면 본문으로 돌아온다. Heading 기본 단축키 Mod-Alt-N은 그대로 남는다.
export const HeadingShortcut = Extension.create({
  name: 'headingShortcut',
  addKeyboardShortcuts() {
    return Object.fromEntries(
      ([1, 2, 3, 4, 5, 6] as const).map((level) => [
        `Alt-${level}`,
        () => this.editor.commands.toggleHeading({ level }),
      ]),
    )
  },
})
