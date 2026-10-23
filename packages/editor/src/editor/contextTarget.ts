import type { ReactNode } from 'react'

/** A menu session owns its mapped selection until the host disposes it. */
export interface EditorContextTarget {
  hasSelection: boolean
  editable: boolean
  canComment: boolean
  restoreSelection(): boolean
  selectCommentTarget(): boolean
  copy(): Promise<boolean>
  cut(): Promise<boolean>
  paste(): Promise<boolean>
  deleteSelection(): boolean
  selectAll(): boolean
  extraItems?: ReactNode
  dispose(): void
}

export interface EditorClipboardContent {
  text: string
  html?: string
  files?: File[]
}

export async function writeEditorClipboard(content: EditorClipboardContent): Promise<boolean> {
  try {
    if (content.html && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([content.text], { type: 'text/plain' }),
        'text/html': new Blob([content.html], { type: 'text/html' }),
      })])
      return true
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content.text)
      return true
    }
  } catch {
    // HTTP and denied Clipboard API environments can still support an explicit copy command.
  }
  const copy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    event.clipboardData.setData('text/plain', content.text)
    if (content.html) event.clipboardData.setData('text/html', content.html)
    event.preventDefault()
  }
  document.addEventListener('copy', copy)
  try { return document.execCommand('copy') }
  catch { return false }
  finally { document.removeEventListener('copy', copy) }
}

export async function readEditorClipboard(): Promise<EditorClipboardContent | null> {
  try {
    if (navigator.clipboard?.read) {
      const content: EditorClipboardContent = { text: '', files: [] }
      for (const item of await navigator.clipboard.read()) {
        for (const type of item.types) {
          if (type === 'text/plain') content.text = await (await item.getType(type)).text()
          else if (type === 'text/html') content.html = await (await item.getType(type)).text()
          else if (type.startsWith('image/')) {
            const blob = await item.getType(type)
            content.files!.push(new File([blob], `clipboard.${type.split('/')[1]?.replace('+xml', '') || 'png'}`, { type }))
          }
        }
      }
      return content
    }
  } catch {
    // Some browsers expose read() but permit only readText().
  }
  try {
    if (navigator.clipboard?.readText) return { text: await navigator.clipboard.readText() }
  } catch { /* Permission failures are reported by the host menu. */ }
  return null
}

export function clipboardPlainText(content: EditorClipboardContent): string {
  if (content.text || !content.html) return content.text
  const element = new DOMParser().parseFromString(content.html, 'text/html').body
  element.querySelectorAll('br').forEach((line) => line.replaceWith('\n'))
  element.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6').forEach((block) => block.append('\n'))
  return (element.textContent ?? '').replace(/\n$/, '')
}
