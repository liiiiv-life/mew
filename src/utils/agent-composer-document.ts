import { uploadedAttachmentTokens } from './agent-attachments.ts'

const pendingPattern = /\[\[mew-upload:[^\]\n]+\]\]/g

/** Keep an attachment's editing identity stable while its uploaded path changes. */
export class ComposerDocument {
  private readonly pending = new Set<string>()
  private readonly resolve: (token: string) => string | undefined
  constructor(resolve: (token: string) => string | undefined) { this.resolve = resolve }

  remember(text: string) {
    for (const match of text.matchAll(pendingPattern)) this.pending.add(match[0])
  }

  canonical(text: string): string {
    return text.replace(pendingPattern, token => this.resolve(token) ?? token)
  }

  editor(text: string): string {
    const identities = new Map<string, string>()
    for (const token of this.pending) {
      const result = this.resolve(token)
      if (result) identities.set(result, token)
    }
    let previous = 0, result = ''
    for (const ref of uploadedAttachmentTokens(text)) {
      result += text.slice(previous, ref.from) + (identities.get(ref.token) ?? ref.token)
      previous = ref.to
    }
    return result + text.slice(previous)
  }

  canonicalPosition(text: string, position: number): number {
    let delta = 0
    for (const match of text.matchAll(pendingPattern)) {
      if (position <= match.index) break
      const replacement = this.resolve(match[0]) ?? match[0]
      if (position < match.index + match[0].length) return match.index + delta + (position - match.index < match[0].length / 2 ? 0 : replacement.length)
      delta += replacement.length - match[0].length
    }
    return position + delta
  }

  editorPosition(text: string, position: number): number {
    let delta = 0
    for (const match of text.matchAll(pendingPattern)) {
      const replacement = this.resolve(match[0]) ?? match[0]
      const start = match.index + delta
      if (position <= start) break
      if (position < start + replacement.length) return match.index + (position - start < replacement.length / 2 ? 0 : match[0].length)
      delta += replacement.length - match[0].length
    }
    return position - delta
  }
}
