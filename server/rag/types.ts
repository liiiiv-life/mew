export type RagTier = 'current' | 'history'

export interface RagChunk {
  index: number
  lineStart: number
  lineEnd: number
  title: string
  heading: string
  content: string
  tier: RagTier
}

export interface EmbeddedChunk extends RagChunk {
  id: string
  project: string
  path: string
  fingerprint: string
  vector: number[]
}

export interface EmbeddingProvider {
  readonly id: string
  readonly dimensions: number
  embedPassages(texts: string[]): Promise<number[][]>
  embedQuery(text: string): Promise<number[]>
}

export interface RagMatch {
  path: string
  line: number
  lineEnd: number
  title: string
  heading: string
  text: string
  reveal: string
  tier: RagTier
  score: number
}

export interface RagSearchResponse {
  results: RagMatch[]
  indexedFiles: number
  indexedChunks: number
  updatedFiles: number
  model: string
}

export interface RagStatus {
  enabled: boolean
  model: string
  ready: boolean
  indexedFiles: number
  indexedChunks: number
}
