import path from 'node:path'
import { DATA_DIR } from '../dataDir.ts'
import type { EmbeddingProvider } from './types.ts'

export const DEFAULT_RAG_MODEL = process.env.MEW_RAG_MODEL?.trim() || 'Xenova/multilingual-e5-small'

type Extractor = (
  texts: string | string[],
  options: { pooling: 'mean'; normalize: true },
) => Promise<{ tolist(): number[][] }>

export class LocalE5Embeddings implements EmbeddingProvider {
  readonly dimensions = 384
  readonly id: string
  private extractorPromise: Promise<Extractor> | null = null
  private readonly model: string
  private readonly cacheDir: string

  constructor(
    model = DEFAULT_RAG_MODEL,
    cacheDir = path.join(DATA_DIR, 'rag', 'models'),
  ) {
    this.model = model
    this.cacheDir = cacheDir
    this.id = `${model}:q8:mean-normalized`
  }

  private extractor(): Promise<Extractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = import('@huggingface/transformers').then(async ({ env, pipeline }) => {
        // Collaboration installs a DOM for its editor; RAG still runs on Node with disk caches.
        env.allowLocalModels = true
        env.useFS = true
        env.useFSCache = true
        env.useBrowserCache = false
        env.cacheDir = this.cacheDir
        return (await pipeline('feature-extraction', this.model, { dtype: 'q8', device: 'cpu' })) as unknown as Extractor
      }).catch(error => {
        this.extractorPromise = null
        throw error
      })
    }
    return this.extractorPromise
  }

  private async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return []
    const extractor = await this.extractor()
    const result = await extractor(texts, { pooling: 'mean', normalize: true })
    return result.tolist()
  }

  embedPassages(texts: string[]): Promise<number[][]> {
    return this.embed(texts)
  }

  async embedQuery(text: string): Promise<number[]> {
    return (await this.embed([`query: ${text}`]))[0]
  }
}
