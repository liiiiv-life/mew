import Link from '@tiptap/extension-link'
import { isExternalHref } from '../utils/fuzzy.ts'

// Derive presentation from href without adding persisted mark attributes or changing Markdown.
export const EditorLink = Link.extend({
  renderHTML(props) {
    const href = String(props.HTMLAttributes.href ?? '').trim()
    const fileLink = href !== '' && !href.startsWith('#') && !href.startsWith('?') && !isExternalHref(href)
    // Keep the standard Link renderer's URI validation and anchor semantics.
    return this.parent!({
      ...props,
      HTMLAttributes: {
        ...props.HTMLAttributes,
        'data-file-link': fileLink ? '' : null,
      },
    })
  },
})
