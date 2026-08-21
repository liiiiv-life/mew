import fs from 'node:fs'
import { buildTree } from '../tree.ts'
import { flattenTextFiles } from '../search.ts'
import { currentRagIndex } from './index.ts'

interface EvalCase {
  question: string
  expectedPaths: string[]
}

const cases = JSON.parse(
  fs.readFileSync(new URL('./eval-cases.json', import.meta.url), 'utf-8'),
) as EvalCase[]
const files = flattenTextFiles(buildTree('docs'))
const index = currentRagIndex()
let hits = 0

for (const item of cases) {
  const response = await index.search('docs', files, item.question, false, 5)
  const paths = response.results.map((result) => result.path)
  const hit = item.expectedPaths.some((expected) => paths.includes(expected))
  if (hit) hits++
  console.log(`${hit ? 'PASS' : 'FAIL'} ${item.question}`)
  console.log(`  ${paths.join(' · ')}`)
}

const recall = hits / cases.length
console.log(`RAG recall@5: ${hits}/${cases.length} (${(recall * 100).toFixed(0)}%)`)
if (recall < 0.8) process.exitCode = 1
