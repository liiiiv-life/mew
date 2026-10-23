export type GraphEdge = { from: number; to: number; commit: boolean }
export type GraphRow = { lane: number; incoming: boolean; edges: GraphEdge[] }

type GraphCommit = { hash: string; parents: string[] }

export function graphLayout(commits: GraphCommit[]): { rows: GraphRow[]; lanes: number } {
  const active: (string | null)[] = []
  let lanes = 1
  const allocate = (hash: string) => {
    const free = active.indexOf(null)
    const lane = free < 0 ? active.length : free
    active[lane] = hash
    return lane
  }
  const rows = commits.map((commit) => {
    let lane = active.indexOf(commit.hash)
    const incoming = lane >= 0
    if (!incoming) lane = allocate(commit.hash)
    const edges: GraphEdge[] = []
    active.forEach((hash, index) => {
      if (hash !== null && index !== lane) edges.push({ from: index, to: index, commit: false })
    })
    active[lane] = null
    commit.parents.forEach((parent, index) => {
      let to = active.indexOf(parent)
      if (to < 0) {
        if (index === 0) {
          to = lane
          active[to] = parent
        } else {
          to = allocate(parent)
        }
      }
      edges.push({ from: lane, to, commit: true })
    })
    lanes = Math.max(lanes, lane + 1, active.length)
    while (active.length && active.at(-1) === null) active.pop()
    return { lane, incoming, edges }
  })
  return { rows, lanes }
}
