// copyPathInto — 파일·폴더를 다른 폴더 안으로 복사(붙여넣기)한다. 실제 프로젝트(docs) 안에
// 임시 하위 폴더를 만들어 검증하고 끝나면 지운다. 이름 충돌·폴더 재귀·자기 자신 복사 금지를 본다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT } from './paths.ts'
import { resolveProjectPath } from './paths.ts'
import { ConflictError, copyPathInto, createDocument, writeFileInto } from './documents.ts'

const rand = () => `ztest${process.pid}${Math.random().toString(36).slice(2, 6)}`

test('createDocument: 확장자를 보존하고 일반 파일은 빈 내용으로, 마크다운만 문서로 생성한다', () => {
  const root = rand()
  const rootAbs = resolveProjectPath(DEFAULT_PROJECT, root)
  try {
    fs.mkdirSync(rootAbs, { recursive: true })
    const moc = '# Map\n'
    fs.writeFileSync(path.join(rootAbs, 'MOC.md'), moc)
    for (const name of ['script.ts', 'config.json', 'LICENSE', '.gitignore']) {
      const relPath = `${root}/${name}`
      assert.deepEqual(createDocument(DEFAULT_PROJECT, relPath, name), { relPath, mocRelPath: null })
      assert.equal(fs.readFileSync(path.join(rootAbs, name), 'utf-8'), '')
      assert.equal(fs.existsSync(path.join(rootAbs, `${name}.md`)), false)
      assert.equal(fs.readFileSync(path.join(rootAbs, 'MOC.md'), 'utf-8'), moc)
      assert.throws(() => createDocument(DEFAULT_PROJECT, relPath, name), ConflictError)
    }
    for (const name of ['note.md', 'UPPER.MD']) {
      const relPath = `${root}/${name}`
      assert.deepEqual(createDocument(DEFAULT_PROJECT, relPath, 'Note'), { relPath, mocRelPath: null })
      assert.match(fs.readFileSync(path.join(rootAbs, name), 'utf-8'), /title: "Note"/)
      assert.equal(fs.readFileSync(path.join(rootAbs, 'MOC.md'), 'utf-8'), moc)
      assert.match(fs.readFileSync(path.join(rootAbs, name), 'utf-8'), /description: "Note"/)
    }
  } finally {
    fs.rmSync(rootAbs, { recursive: true, force: true })
  }
})

test('copyPathInto: 파일을 다른 폴더로 복사하면 원래 이름을 유지하고, 같은 폴더면 " copy"를 붙인다', () => {
  const root = rand()
  const rootAbs = resolveProjectPath(DEFAULT_PROJECT, root)
  try {
    fs.mkdirSync(path.join(rootAbs, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(rootAbs, 'note.md'), '# n\n', 'utf-8')

    // 다른 폴더로 → 이름 유지
    const rel1 = copyPathInto(DEFAULT_PROJECT, `${root}/note.md`, `${root}/sub`)
    assert.equal(rel1, `${root}/sub/note.md`)
    assert.ok(fs.existsSync(path.join(rootAbs, 'sub', 'note.md')))

    // 같은 폴더로 → " copy" 비켜쓰기
    const rel2 = copyPathInto(DEFAULT_PROJECT, `${root}/note.md`, root)
    assert.equal(rel2, `${root}/note copy.md`)
    const rel3 = copyPathInto(DEFAULT_PROJECT, `${root}/note.md`, root)
    assert.equal(rel3, `${root}/note copy 2.md`)
  } finally {
    fs.rmSync(rootAbs, { recursive: true, force: true })
  }
})

test('writeFileInto: 놓은 폴더에 원래 이름으로 저장하고, 같은 이름이면 " copy"로 비켜 쓴다', () => {
  const root = rand()
  const rootAbs = resolveProjectPath(DEFAULT_PROJECT, root)
  try {
    fs.mkdirSync(rootAbs, { recursive: true })
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // 바이너리도 그대로 — 텍스트 변환 없음

    const rel1 = writeFileInto(DEFAULT_PROJECT, root, 'shot.png', data)
    assert.equal(rel1, `${root}/shot.png`)
    assert.deepEqual(fs.readFileSync(path.join(rootAbs, 'shot.png')), data)

    const rel2 = writeFileInto(DEFAULT_PROJECT, root, 'shot.png', data)
    assert.equal(rel2, `${root}/shot copy.png`)

    // 파일명은 바깥 값이다 — 경로 조각은 떨어져 나가고 이름만 남는다
    const rel3 = writeFileInto(DEFAULT_PROJECT, root, '../../etc/passwd', data)
    assert.equal(rel3, `${root}/passwd`)
    assert.throws(() => writeFileInto(DEFAULT_PROJECT, root, '..', data), ConflictError)
  } finally {
    fs.rmSync(rootAbs, { recursive: true, force: true })
  }
})

test('copyPathInto: 폴더를 재귀 복사하고, 자기 자신·하위로의 복사는 거부한다', () => {
  const root = rand()
  const rootAbs = resolveProjectPath(DEFAULT_PROJECT, root)
  try {
    fs.mkdirSync(path.join(rootAbs, 'src', 'deep'), { recursive: true })
    fs.mkdirSync(path.join(rootAbs, 'dest'), { recursive: true })
    fs.writeFileSync(path.join(rootAbs, 'src', 'deep', 'a.md'), '# a\n', 'utf-8')

    const rel = copyPathInto(DEFAULT_PROJECT, `${root}/src`, `${root}/dest`)
    assert.equal(rel, `${root}/dest/src`)
    assert.ok(fs.existsSync(path.join(rootAbs, 'dest', 'src', 'deep', 'a.md')), '폴더가 재귀적으로 복사돼야 한다')

    assert.throws(() => copyPathInto(DEFAULT_PROJECT, `${root}/src`, `${root}/src`), ConflictError)
    assert.throws(() => copyPathInto(DEFAULT_PROJECT, `${root}/src`, `${root}/src/deep`), ConflictError)
  } finally {
    fs.rmSync(rootAbs, { recursive: true, force: true })
  }
})
