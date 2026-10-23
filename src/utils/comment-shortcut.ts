import { getBinding, matchesShortcut } from '@mew/shortcuts'

function textEditorTarget(event: KeyboardEvent): HTMLElement | null {
  let target = event.target instanceof Element ? event.target : document.activeElement
  if (!target || target === document.body || target === document.documentElement) {
    const active = document.activeElement
    if (active && active !== document.body && active !== document.documentElement) target = active
    else {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) return null
      const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement
      const editor = anchor?.closest<HTMLElement>('.ProseMirror, .cm-editor')
      if (!editor || !selection.focusNode || !editor.contains(selection.focusNode)) return null
      target = editor
    }
  }
  if (!target?.isConnected || target.closest('input, textarea, select, button, [role="dialog"], [aria-modal="true"], [inert], [data-agent-session], .xterm, [data-login-desktop]')) return null
  const editor = target.closest<HTMLElement>('.ProseMirror, .cm-editor')
  if (!editor?.closest('[data-workspace-panel="editor"]') || !editor.checkVisibility({ visibilityProperty: true })) return null
  return editor
}

/** Comment commands capture only the focused file editor, before editor and browser handlers. */
export function captureCommentShortcut({ enabled, startComment }: {
  enabled: () => boolean
  startComment: () => boolean
}): () => void {
  const keyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !enabled() || !matchesShortcut(event, getBinding('addComment')) || !textEditorTarget(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    // A missing selection still consumes the key so it cannot open browser inspection tools.
    if (!event.repeat && !event.isComposing) startComment()
  }
  window.addEventListener('keydown', keyDown, true)
  return () => window.removeEventListener('keydown', keyDown, true)
}
