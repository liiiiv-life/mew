export { Editor, type EditorHandle, type EditorViewAnchor } from './Editor'
export { DatabasePanel } from './database/DatabasePanel'
export { DbGlyph } from './database/DatabaseTable'
export type {
  TreeNode,
  EditorApi,
  DocumentBacklinksData,
  FrontmatterOptionsApi,
  EditorCollab,
  TableWidths,
  EditorDbApi,
  DbColumn,
  DbColumnType,
  DbRow,
  DbView,
  DbSummary,
  DbEvent,
} from './types'
export { flattenFiles, fuzzyScore, prefixMatch, isExternalHref, relativeLinkPath, resolveRelativePath } from './utils/fuzzy'
export { makeCommentAnchor, resolveCommentAnchor, type CommentAnchor } from './utils/commentAnchor'
export type { CommentThreadInput } from './editor/commentHighlight'
export {
  splitFrontmatter,
  joinFrontmatter,
  todayDate,
  nextFieldKey,
  type FrontmatterData,
  type FrontmatterField,
  type FrontmatterType,
} from './utils/frontmatter'
