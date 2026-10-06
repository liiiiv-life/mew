import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'yaml'
import { changeFrontmatterType, frontmatterSelections, frontmatterType, joinFrontmatter, splitFrontmatter, type FrontmatterField } from './frontmatter.ts'

test('field settings survive serialization, renaming and ordering without changing YAML property values', () => {
  const fields: FrontmatterField[] = [
    { key: 'status', value: 'Draft', type: 'select', options: ['Draft', 'Published', 'With "quotes"', 'Text # mew:field {"type":"text"}'] },
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
