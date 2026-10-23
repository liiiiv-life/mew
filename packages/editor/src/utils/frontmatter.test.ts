import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'yaml'
import { changeFrontmatterType, frontmatterSelections, frontmatterType, joinFrontmatter, splitFrontmatter, type FrontmatterField } from './frontmatter.ts'

test('field settings survive serialization, renaming and ordering without changing YAML property values', () => {
  const fields: FrontmatterField[] = [
    { key: 'status', value: 'Draft', type: 'select', options: ['Draft', 'Published', 'With "quotes"', 'Text # mew:field {"type":"text"}'], optionColors: { Draft: 210, Published: 130 } },
    { key: 'tags', value: JSON.stringify(['One, two', 'Three']), type: 'multi-select', options: ['One, two', 'Three'] },
    { key: 'reference', value: '[Guide](../guide.md)', type: 'link' },
    { key: 'count', value: '42', type: 'number' },
    { key: 'due', value: '2026-10-02', type: 'date' },
  ]
  const original = { title: 'Typed document', fields }
  const content = joinFrontmatter(original, '# Body')
  assert.deepEqual(splitFrontmatter(content).frontmatter, original)
  assert.equal(splitFrontmatter(content).body, '# Body')
  const yaml = parse(content.split('---')[1])
  assert.equal(yaml.status, 'Draft')
  assert.equal(yaml.reference, '[Guide](../guide.md)')
  assert.equal(yaml.count, '42')
  assert.deepEqual(JSON.parse(yaml.tags), ['One, two', 'Three'])
  const reordered = { ...original, fields: [...fields].reverse().map(f => ({ ...f, key: `renamed-${f.key}` })) }
  assert.deepEqual(splitFrontmatter(joinFrontmatter(reordered, '# Body')).frontmatter, reordered)
})

test('field line numbers honor comments, blank lines and title location', () => {
  const content = '---\n# Comment: keep numbering\n\ncount: 42\ntitle: Doc\ndue: 2026-10-02\n---\n\nBody'
  const result = splitFrontmatter(content)
  assert.deepEqual(result.lineNumbers, { title: 5, fields: [4, 6] })
  assert.deepEqual(result.frontmatter?.fields.map(frontmatterType), ['number', 'date'])
})

test('type changes preserve scalar punctuation and multiple selections', () => {
  const original = { key: 'tags', value: 'One, two' }
  const multi = changeFrontmatterType(original, 'multi-select')
  assert.deepEqual(frontmatterSelections(multi.value), ['One, two'])
  assert.equal(changeFrontmatterType(multi, 'text').value, original.value)
  const selected = { ...multi, value: JSON.stringify(['A', 'B']) }
  const scalar = changeFrontmatterType(selected, 'select')
  assert.equal(scalar.value, selected.value)
  assert.equal(changeFrontmatterType({ key: 'x', value: 'invalid number' }, 'number').value, 'invalid number')
})

test('text resembling a settings marker does not become metadata', () => {
  const original = { title: 'Doc', fields: [{ key: 'text', value: 'literal # mew:field {"type":"number"}' }] }
  assert.deepEqual(splitFrontmatter(joinFrontmatter(original, 'Body')).frontmatter, original)
})

test('body edits preserve block and flow YAML collections, multiline values and field line numbers', () => {
  const header = 'title: Task\ntags:\n  - 기능 # keep tag comment\n  - 검증\nassignees:\n  - alice@example.test\ncustom:\n  nested: retained\ndescription: >-\n  multiple\n  lines\nflow: [one, two]'
  const original = `---\n${header}\n---\n\nBody`
  const parsed = splitFrontmatter(original)
  assert.ok(parsed.frontmatter)
  assert.deepEqual(parsed.lineNumbers, { title: 2, fields: [3, 6, 8, 10, 13] })
  assert.deepEqual(JSON.parse(parsed.frontmatter.fields[0].value), ['기능', '검증'])
  assert.equal(parsed.frontmatter.fields[3].value, 'multiple lines')
  let content = original
  for (let index = 0; index < 3; index++) {
    const data = splitFrontmatter(content).frontmatter!
    content = joinFrontmatter(data, `Edited body ${index}`)
    const yaml = parse(content.split('---')[1])
    assert.deepEqual(yaml.tags, ['기능', '검증'])
    assert.deepEqual(yaml.assignees, ['alice@example.test'])
    assert.deepEqual(yaml.custom, { nested: 'retained' })
    assert.equal(yaml.description, 'multiple lines')
    assert.deepEqual(yaml.flow, ['one', 'two'])
    assert.ok(content.includes(header.slice(header.indexOf('\n') + 1)))
  }
})

test('preserved YAML fields can still be explicitly edited, renamed, reordered and deleted', () => {
  const original = splitFrontmatter('---\ntitle: Task\ntags:\n  - 기능\n  - 검증\n---\n\nBody').frontmatter!
  const tags = original.fields[0]
  assert.equal(parse(joinFrontmatter({ ...original, fields: [{ ...tags, value: '' }] }, 'Body').split('---')[1]).tags, '')
  const selected = changeFrontmatterType(tags, 'multi-select')
  assert.deepEqual(frontmatterSelections(selected.value), ['기능', '검증'])
  const edited = { ...selected, value: JSON.stringify(['기능', '추가']) }
  assert.deepEqual(JSON.parse(parse(joinFrontmatter({ ...original, fields: [edited] }, 'Body').split('---')[1]).tags), ['기능', '추가'])
  const renamed = parse(joinFrontmatter({ ...original, fields: [{ ...tags, key: 'labels' }] }, 'Body').split('---')[1])
  assert.equal(renamed.tags, undefined)
  assert.deepEqual(JSON.parse(renamed.labels), ['기능', '검증'])
  assert.equal(parse(joinFrontmatter({ ...original, fields: [] }, 'Body').split('---')[1]).tags, undefined)
})

test('indentless lists and escaped collection text survive repeated body edits', () => {
  const raw = '---\ntitle: Task\ntags:\n- 기능\n# list comment\n- 검증\ncustom: ["quoted\\\" value", "C:\\\\folder"]\n---\n\nBody'
  const original = splitFrontmatter(raw).frontmatter!
  const edited = joinFrontmatter({ ...original, fields: original.fields.map(field => ({ ...field, key: `renamed-${field.key}` })) }, 'Edited')
  const parsed = parse(edited.split('---')[1])
  assert.deepEqual(JSON.parse(parsed['renamed-tags']), ['기능', '검증'])
  assert.deepEqual(JSON.parse(parsed['renamed-custom']), ['quoted" value', 'C:\\folder'])
  const next = joinFrontmatter(splitFrontmatter(edited).frontmatter!, 'Edited again')
  assert.deepEqual(parse(next.split('---')[1]), parsed)
})

test('database row page body and property edits preserve native numbers and multiple selections', () => {
  const content = `---
title: 송상훈
나이: 27 # mew:field {"type":"number"}
태그: [개발, "쉼표, 항목"] # mew:field {"type":"multi-select","options":["개발","쉼표, 항목","검토"]}
상태: 초안 # mew:field {"type":"select","options":["초안","진행"]}
코드: "007" # mew:field {"type":"text"}
마감: 2026-10-20 # mew:field {"type":"date"}
_mew_database: database-id
_mew_row: row-id
---

Body`
  let current = content
  for (let index = 0; index < 3; index++) {
    current = joinFrontmatter(splitFrontmatter(current).frontmatter!, `Edited body ${index}`)
    const yaml = parse(current.split('---')[1])
    assert.equal(yaml.나이, 27)
    assert.deepEqual(yaml.태그, ['개발', '쉼표, 항목'])
    assert.equal(yaml.상태, '초안')
    assert.equal(yaml.코드, '007')
    assert.equal(yaml.마감, '2026-10-20')
    assert.equal(yaml._mew_database, 'database-id')
    assert.equal(yaml._mew_row, 'row-id')
  }
  const data = splitFrontmatter(current).frontmatter!
  const edited = { ...data, fields: data.fields.map(field => ({ ...field,
    value: field.key === '나이' ? '31' : field.key === '태그' ? JSON.stringify(['검토', 'With "quotes"']) : field.value,
  })) }
  const saved = joinFrontmatter(edited, 'Edited properties')
  const yaml = parse(saved.split('---')[1])
  assert.equal(yaml.나이, 31)
  assert.deepEqual(yaml.태그, ['검토', 'With "quotes"'])
  const reparsed = splitFrontmatter(saved).frontmatter!
  assert.equal(reparsed.fields.find(field => field.key === '나이')?.value, '31')
  assert.deepEqual(frontmatterSelections(reparsed.fields.find(field => field.key === '태그')!.value), ['검토', 'With "quotes"'])
  assert.deepEqual(reparsed.fields.find(field => field.key === '태그')?.options, ['개발', '쉼표, 항목', '검토'])
})

test('database row page null fields stay empty in controls and serialize as native null', () => {
  const data = splitFrontmatter(`---
title: Empty row
나이: null # mew:field {"type":"number"}
태그: null # mew:field {"type":"multi-select","options":["개발"]}
상태: null # mew:field {"type":"select","options":["초안"]}
마감: null # mew:field {"type":"date"}
메모: null # mew:field {"type":"text"}
_mew_database: database-id
_mew_row: row-id
---

Body`).frontmatter!
  for (const field of data.fields.filter(field => field.type)) assert.equal(field.value, '')
  const yaml = parse(joinFrontmatter(data, 'Edited body').split('---')[1])
  for (const key of ['나이', '태그', '상태', '마감', '메모']) assert.equal(yaml[key], null)
  const edited = { ...data, fields: data.fields.map(field => field.key === '태그' ? { ...field, value: '[]' } : field) }
  assert.deepEqual(parse(joinFrontmatter(edited, 'Cleared choices').split('---')[1]).태그, [])
})
