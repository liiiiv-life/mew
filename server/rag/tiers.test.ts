import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { docsTierMap, tierForFile } from './tiers.ts'

test('MOC Current와 History/raw 링크를 tier로 분류한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-rag-tier-'))
  try {
    fs.writeFileSync(path.join(root, 'MOC.md'), '## Current\n- [현재](current.md)\n\n## History / raw\n- [이전](old.md)\n')
    fs.writeFileSync(path.join(root, 'current.md'), 'current')
    fs.writeFileSync(path.join(root, 'old.md'), 'old')
    const tiers = docsTierMap(root, ['MOC.md', 'current.md', 'old.md'])
    assert.equal(tiers.get('current.md'), 'current')
    assert.equal(tiers.get('old.md'), 'history')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('폐기·대체 ADR은 MOC 정보가 없어도 history다', () => {
  assert.equal(tierForFile('decisions/0001-old.md', '- 상태: 대체됨: 0002'), 'history')
  assert.equal(tierForFile('product.md', '- 상태: 채택'), 'current')
})
