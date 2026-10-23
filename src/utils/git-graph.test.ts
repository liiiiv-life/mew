import assert from 'node:assert/strict'
import test from 'node:test'
import { graphLayout } from './git-graph.ts'

const commit = (hash: string, ...parents: string[]) => ({ hash, parents })

test('a new branch tip preserves existing lane positions and starts at its dot', () => {
  const { rows, lanes } = graphLayout([
    commit('a', 'base'), commit('b', 'b2'), commit('b2', 'base'), commit('base'),
  ])
  assert.equal(lanes, 2)
  assert.deepEqual(rows.map(row => [row.lane, row.incoming]), [[0, false], [1, false], [1, true], [0, true]])
  assert.deepEqual(rows[1].edges, [
    { from: 0, to: 0, commit: false }, { from: 1, to: 1, commit: true },
  ])
  assert.deepEqual(rows[2].edges, [
    { from: 0, to: 0, commit: false }, { from: 1, to: 0, commit: true },
  ])
})

test('merges, octopus parents and reused lanes keep every row boundary connected', () => {
  const commits = [
    commit('merge', 'a', 'b', 'c'), commit('a', 'base'), commit('b', 'base'),
    commit('tip', 'c'), commit('c', 'base'), commit('base'), commit('orphan'),
  ]
  const { rows } = graphLayout(commits)
  let boundary = new Map<number, string>()
  rows.forEach((row, index) => {
    const entry = commits[index]
    const top = new Map<number, string>()
    if (row.incoming) top.set(row.lane, entry.hash)
    row.edges.filter(edge => !edge.commit).forEach(edge => top.set(edge.from, boundary.get(edge.from)!))
    assert.deepEqual(top, boundary, `incoming connections at ${entry.hash}`)
    const bottom = new Map<number, string>()
    let parentIndex = 0
    row.edges.forEach(edge => {
      const parent = edge.commit ? entry.parents[parentIndex++] : boundary.get(edge.from)!
      if (bottom.has(edge.to)) assert.equal(bottom.get(edge.to), parent)
      bottom.set(edge.to, parent)
    })
    boundary = bottom
  })
  assert.deepEqual(boundary, new Map())
  assert.equal(rows[3].lane, 1, 'a freed lane is reused without moving the remaining lanes')
})

test('root commits have no phantom incoming or outgoing lines; truncated history retains parents', () => {
  assert.deepEqual(graphLayout([]), { rows: [], lanes: 1 })
  assert.deepEqual(graphLayout([commit('root')]).rows, [{ lane: 0, incoming: false, edges: [] }])
  assert.deepEqual(graphLayout([commit('tip', 'older')]).rows, [{
    lane: 0, incoming: false, edges: [{ from: 0, to: 0, commit: true }],
  }])
})
