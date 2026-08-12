import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectRoot } from './paths.ts'

// 파일 댓글 — 본문(.md·코드)에는 아무 흔적도 남기지 않고, 그 프로젝트의
// <프로젝트>/.mew/comments.json 에 문서 경로별 스레드로 저장한다(table-layout.json과 같은 자리·같은 이유).
//
// 앵커는 줄·오프셋이 아니라 **텍스트 문맥**이다: { text(선택 텍스트, 한 글자 이상), prefix(앞 문맥),
// line(만들 당시 줄 — 동점 처리용 힌트) }. 화면이 열릴 때마다 에디터가 지금 본문에서 다시 찾는다
// (packages/editor의 resolveCommentAnchor). 본문이 크게 바뀌어 못 찾으면 하이라이트만 사라지고,
// 댓글 목록 팝업에는 그대로 남는다 — 문서를 고쳤다고 댓글이 지워지는 것보다 낫다.

export interface CommentAnchor {
  text: string
  prefix: string
  line: number
}

export interface Comment {
  id: string
  /** 로그인 이메일 — 세션에서 온다 */
  author: string
  time: number
  text: string
  /** 마지막 수정 시각 — 수정한 적 없으면 없음 */
  edited?: number
}

export interface CommentThread {
  id: string
  anchor: CommentAnchor
  comments: Comment[]
}

interface CommentsFile {
  version: 1
  docs: Record<string, CommentThread[]>
}

const MEW_DIR = '.mew'
const FILE_NAME = 'comments.json'
const MAX_DOCS = 2000
const MAX_THREADS = 300
const MAX_COMMENTS = 200
const MAX_TEXT = 4000
const MAX_ANCHOR_TEXT = 2000
const MAX_PREFIX = 200

export class CommentsError extends Error {}

function commentsFile(project: string): string {
  return path.join(projectRoot(project), MEW_DIR, FILE_NAME)
}

function load(project: string): CommentsFile {
  let raw: string
  try {
    raw = fs.readFileSync(commentsFile(project), 'utf-8')
  } catch {
    return { version: 1, docs: {} }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 깨진 JSON은 덮어쓰기 전에 사본을 남긴다 — "없음"으로 오해해 그 위에 쓰면 스레드가 통째로 사라진다
    const backup = `${commentsFile(project)}.corrupt-${Date.now()}`
    try {
      fs.copyFileSync(commentsFile(project), backup)
    } catch {
      /* 사본까지 실패하면 어쩔 수 없다 */
    }
    return { version: 1, docs: {} }
  }
  const docs = (parsed as { docs?: unknown } | null)?.docs
  if (!docs || typeof docs !== 'object') return { version: 1, docs: {} }
  const out: Record<string, CommentThread[]> = {}
  for (const [key, value] of Object.entries(docs as Record<string, unknown>)) {
    const threads = (Array.isArray(value) ? value : []).filter(isThread)
    if (threads.length) out[key] = threads
  }
  return { version: 1, docs: out }
}

function isThread(value: unknown): value is CommentThread {
  const t = value as CommentThread | null
  return (
    !!t &&
    typeof t.id === 'string' &&
    !!t.anchor &&
    typeof t.anchor.text === 'string' &&
    typeof t.anchor.prefix === 'string' &&
    typeof t.anchor.line === 'number' &&
    Array.isArray(t.comments)
  )
}

function save(project: string, data: CommentsFile): void {
  const file = commentsFile(project)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, file) // 쓰는 도중 읽어도 빈 파일을 보지 않도록 (tableLayout.save와 같은 이유)
}

function sanitizeAnchor(value: unknown): CommentAnchor {
  const a = value as Partial<CommentAnchor> | null
  if (!a || typeof a.text !== 'string' || typeof a.prefix !== 'string') throw new CommentsError('앵커가 필요합니다')
  // 댓글은 고른 글자에만 붙는다 — 빈 선택(옛 커서 댓글)은 여기서 막는다(ADR 0051)
  if (!a.text) throw new CommentsError('댓글을 달 곳을 선택해 주세요')
  const line = Math.round(Number(a.line))
  return {
    text: a.text.slice(0, MAX_ANCHOR_TEXT),
    prefix: a.prefix.slice(-MAX_PREFIX),
    line: Number.isFinite(line) && line > 0 ? line : 1,
  }
}

function sanitizeText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) throw new CommentsError('내용이 필요합니다')
  if (text.length > MAX_TEXT) throw new CommentsError('댓글이 너무 깁니다')
  return text.trim()
}

export function listThreads(project: string, relPath: string): CommentThread[] {
  return load(project).docs[relPath] ?? []
}

export function addThread(project: string, relPath: string, anchor: unknown, author: string, text: unknown): CommentThread {
  if (!relPath) throw new CommentsError('문서 경로가 필요합니다')
  const data = load(project)
  if (!(relPath in data.docs) && Object.keys(data.docs).length >= MAX_DOCS) throw new CommentsError('댓글이 달린 문서가 너무 많습니다')
  const threads = (data.docs[relPath] ??= [])
  if (threads.length >= MAX_THREADS) throw new CommentsError('이 문서의 스레드가 너무 많습니다')
  const thread: CommentThread = {
    id: randomUUID(),
    anchor: sanitizeAnchor(anchor),
    comments: [{ id: randomUUID(), author, time: Date.now(), text: sanitizeText(text) }],
  }
  threads.push(thread)
  save(project, data)
  return thread
}

export function addComment(project: string, relPath: string, threadId: string, author: string, text: unknown): CommentThread {
  const data = load(project)
  const thread = (data.docs[relPath] ?? []).find((t) => t.id === threadId)
  if (!thread) throw new CommentsError('스레드를 찾을 수 없습니다')
  if (thread.comments.length >= MAX_COMMENTS) throw new CommentsError('이 스레드의 댓글이 너무 많습니다')
  thread.comments.push({ id: randomUUID(), author, time: Date.now(), text: sanitizeText(text) })
  save(project, data)
  return thread
}

/** 수정은 작성자 본인 또는 owner만 — 판정에 쓸 isOwner는 호출 쪽(라우트)이 세션에서 뽑아 넘긴다 */
export function editComment(
  project: string,
  relPath: string,
  threadId: string,
  commentId: string,
  by: { email: string; isOwner: boolean },
  text: unknown,
): CommentThread {
  const data = load(project)
  const thread = (data.docs[relPath] ?? []).find((t) => t.id === threadId)
  const comment = thread?.comments.find((c) => c.id === commentId)
  if (!thread || !comment) throw new CommentsError('댓글을 찾을 수 없습니다')
  if (comment.author !== by.email && !by.isOwner) throw new CommentsError('본인 댓글만 고칠 수 있습니다')
  comment.text = sanitizeText(text)
  comment.edited = Date.now()
  save(project, data)
  return thread
}

/** 마지막 댓글을 지우면 스레드(하이라이트)도 같이 사라진다 */
export function deleteComment(
  project: string,
  relPath: string,
  threadId: string,
  commentId: string,
  by: { email: string; isOwner: boolean },
): CommentThread | null {
  const data = load(project)
  const threads = data.docs[relPath] ?? []
  const thread = threads.find((t) => t.id === threadId)
  const comment = thread?.comments.find((c) => c.id === commentId)
  if (!thread || !comment) throw new CommentsError('댓글을 찾을 수 없습니다')
  if (comment.author !== by.email && !by.isOwner) throw new CommentsError('본인 댓글만 지울 수 있습니다')
  thread.comments = thread.comments.filter((c) => c.id !== commentId)
  if (thread.comments.length === 0) {
    data.docs[relPath] = threads.filter((t) => t.id !== threadId)
    if (data.docs[relPath].length === 0) delete data.docs[relPath]
    save(project, data)
    return null
  }
  save(project, data)
  return thread
}
