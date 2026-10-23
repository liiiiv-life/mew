import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCommitResponse, CommitResponseSyntaxError } from './git-commit-response.ts'
import { parseCoverageNotes } from './git-commit-packets.ts'
import { requestedDetails } from './git-commit-analysis.ts'

test('JSON formatting accepts fences, comments and trailing commas without changing string values', () => {
  const value = { title: '한글 "제목"', files: ['path/*literal*/.md', '한글\\파일.md'], description: 'line 1\nline 2 // text' }
  const json = JSON.stringify(value)
  assert.deepEqual(parseCommitResponse(json), value)
  assert.deepEqual(parseCommitResponse('\uFEFF\n```json\n' + json + '\n```\n'), value)
  const formatted = `// formatting only\n${json.slice(0, -1)}, /* trailing comma */ }`
  assert.deepEqual(parseCommitResponse(formatted), value)
  assert.deepEqual(parseCommitResponse('```jsonc\n' + formatted + '\n```'), value)
})

test('malformed or truncated JSON never uses partial parser recovery or exposes raw syntax errors', () => {
  const malformed = [
    '{"files":["one.md" "two.md"]}',
    '{"commits":[] "skipped":[]}',
    '{"files":["one.md"]',
    '{"description":"unescaped "quote""}',
    '{"path":"bad\\qescape"}',
    '{"summary":"line one\nline two"}',
    '{"changes":[]} {"changes":[]}',
    'Here is the plan: {"commits":[],"skipped":[]}',
    '/* unfinished', '',
  ]
  for (const output of malformed) {
    assert.throws(() => parseCommitResponse(output), error => {
      assert.ok(error instanceof CommitResponseSyntaxError)
      assert.match(error.message, /응답 형식을 복구하지 못했습니다/)
      assert.doesNotMatch(error.message, /Expected|position|SyntaxError/)
      return true
    })
  }
})

test('evidence and detail responses share syntax handling while retaining exact coverage validation', () => {
  const changes = [{ sources: [0], summary: '동작 수정', uncertainties: [] }]
  assert.deepEqual(parseCoverageNotes('{"changes":[{"sources":[0,],"summary":"동작 수정","uncertainties":[],},],}', [0]), changes)
  assert.throws(() => parseCoverageNotes('{"changes":[{"sources":[0 1]}]}', [0, 1]), CommitResponseSyntaxError)
  assert.throws(() => parseCoverageNotes(JSON.stringify({ changes }), [0, 1]), /누락/)
  const chunks = [{ id: 0, file: '0.txt', paths: ['file.txt'] }]
  assert.deepEqual(requestedDetails('{"needsDetails":[0,],}', chunks), chunks)
  assert.throws(() => requestedDetails('{"needsDetails":[0 1]}', chunks), CommitResponseSyntaxError)
  assert.throws(() => requestedDetails('{"needsDetails":[0,0]}', chunks, 2), /올바르지/)
})
