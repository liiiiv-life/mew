import test from 'node:test'
import assert from 'node:assert/strict'
import { parseHeadings } from './toc.ts'

test('annotation metadata stays out of the outline without changing later heading targets', () => {
  const headings = parseHeadings('# Body\n\n# $Annotations$\n\n1. Note\n\n# Next\n\n## $Annotations$\n\n```md\n# Hidden example\n```')
  assert.deepEqual(headings.map(({ text, index }) => ({ text, index })), [{ text: 'Body', index: 0 }, { text: 'Next', index: 2 }])
  assert.equal(headings[1].children[0].text, '$Annotations$')
  assert.equal(headings[1].children[0].index, 3)
})
