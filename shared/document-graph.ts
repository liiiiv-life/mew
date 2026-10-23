export interface DocumentGraphNode {
  path: string
  title: string
  group: string
}

/** Edges are directed and unique; indices refer to nodes in this response. */
export interface DocumentGraphData {
  nodes: DocumentGraphNode[]
  edges: [number, number][]
  skipped: number
}
