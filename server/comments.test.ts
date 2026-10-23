// 파일 댓글(.mew/comments.json) — 임시 프로젝트 폴더에서 스레드 왕복·권한·정리를 검증한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { WORKSPACE_ROOT } from './paths.ts'
import { createProject, deleteProject } from './projects.ts'
import { addComment, addThread, CommentsError, deleteComment, editComment, listThreads } from './comments.ts'

const rand = () => `ztest${process.pid}${Math.random().toString(36).slice(2, 6)}`

function withProject(fn: (name: string, dir: string) => void) {
  const name = rand()
  const dir = path.join(WORKSPACE_ROOT, name)
  createProject(name)
  try {
    fn(name, dir)
  } finally {
    try {
      deleteProject(name)
    } catch {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

const anchor = { text: '이 문장', prefix: '앞 문맥 ', line: 3 }

test('addThread → listThreads 왕복 — .mew/comments.json에 남는다', () => {
  withProject((name, dir) => {
    const thread = addThread(name, 'a.md', anchor, 'a@x.com', '첫 댓글')
    const threads = listThreads(name, 'a.md')
    assert.equal(threads.length, 1)
    assert.equal(threads[0].id, thread.id)
    assert.deepEqual(threads[0].anchor, anchor)
    assert.equal(threads[0].comments[0].text, '첫 댓글')
    assert.equal(threads[0].comments[0].author, 'a@x.com')
    assert.ok(fs.existsSync(path.join(dir, '.mew', 'comments.json')))
  })
})

test('같은 스레드에 댓글이 이어 붙는다', () => {
  withProject((name) => {
    const thread = addThread(name, 'a.md', anchor, 'a@x.com', '첫')
    addComment(name, 'a.md', thread.id, 'b@x.com', '둘')
    const [got] = listThreads(name, 'a.md')
    assert.deepEqual(got.comments.map((c) => c.text), ['첫', '둘'])
  })
})

test('수정·삭제는 작성자 본인만 — owner는 예외', () => {
  withProject((name) => {
    const thread = addThread(name, 'a.md', anchor, 'a@x.com', '원문')
    const commentId = thread.comments[0].id
    assert.throws(
      () => editComment(name, 'a.md', thread.id, commentId, { email: 'b@x.com', isOwner: false }, '가로채기'),
      CommentsError,
    )
    editComment(name, 'a.md', thread.id, commentId, { email: 'b@x.com', isOwner: true }, 'owner 수정')
    const [got] = listThreads(name, 'a.md')
    assert.equal(got.comments[0].text, 'owner 수정')
    assert.ok(got.comments[0].edited)
  })
})

test('마지막 댓글을 지우면 스레드도 사라진다', () => {
  withProject((name) => {
    const thread = addThread(name, 'a.md', anchor, 'a@x.com', '하나뿐')
    const result = deleteComment(name, 'a.md', thread.id, thread.comments[0].id, { email: 'a@x.com', isOwner: false })
    assert.equal(result, null)
    assert.deepEqual(listThreads(name, 'a.md'), [])
  })
})

test('빈 내용·없는 스레드는 거부한다', () => {
  withProject((name) => {
    assert.throws(() => addThread(name, 'a.md', anchor, 'a@x.com', '   '), CommentsError)
    assert.throws(() => addComment(name, 'a.md', 'no-such', 'a@x.com', '내용'), CommentsError)
  })
})

test('빈 선택(옛 커서 댓글)은 거부한다 — 댓글은 고른 글자에만 붙는다 (ADR 0051)', () => {
  withProject((name) => {
    assert.throws(() => addThread(name, 'a.md', { text: '', prefix: '앞 문맥 ', line: 3 }, 'a@x.com', '내용'), CommentsError)
    // 띄어쓰기 한 자라도 고르면 통과한다
    const thread = addThread(name, 'a.md', { text: ' ', prefix: '앞', line: 3 }, 'a@x.com', '내용')
    assert.equal(thread.anchor.text, ' ')
  })
})
