import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { descriptionCatalog, readDescription } from './document-descriptions.ts'

test('catalog reads YAML descriptions without body fields and excludes cold or linked trees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-descriptions-'))
  try {
    for (const dir of ['history', 'archives', '.hidden', 'current']) fs.mkdirSync(path.join(root, dir))
    const raw = '---\r\ndescription: >-\r\n  PDF 필기와\r\n  저장 계약\r\n---\r\n본문 description: secret body\n'
    fs.writeFileSync(path.join(root, 'current/PDF.md'), raw)
    for (const dir of ['history', 'archives', '.hidden']) fs.writeFileSync(path.join(root, dir, 'old.md'), '---\ndescription: 이전 계약\n---\n')
    fs.symlinkSync(path.join(root, 'archives'), path.join(root, 'alias'))
    assert.deepEqual(descriptionCatalog(root), { entries: [['current/PDF.md', 'PDF 필기와 저장 계약']], errors: [] })
    assert.equal(descriptionCatalog(root, true).entries.length, 2)
    for (const header of ['description: ""', 'desc: old', 'description: [array]', 'description: one\ndescription: two']) {
      fs.writeFileSync(path.join(root, 'bad.md'), `---\n${header}\n---\ndescription: body\n`)
      assert.equal(descriptionCatalog(root).errors.length, 1)
    }
    fs.writeFileSync(path.join(root, 'bad.md'), '# No header\ndescription: body\n')
    assert.throws(() => readDescription(path.join(root, 'bad.md')), /Missing frontmatter/)
    const long = '설명'.repeat(2500)
    fs.writeFileSync(path.join(root, 'long.md'), `---\ndescription: ${long}\n---\n`)
    assert.equal(readDescription(path.join(root, 'long.md')), long, 'UTF-8 headers spanning chunks remain intact')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
