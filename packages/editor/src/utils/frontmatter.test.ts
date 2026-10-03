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
