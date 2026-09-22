import '../config.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Local shell access has the same authority as an agent's existing file tools. */
export async function ragCli(args: string[], input = fs.readFileSync(0, 'utf8')) {
  const [data, workspace, docs] = args
  if (!data || !path.isAbsolute(data) || !workspace || !path.isAbsolute(workspace)) throw new Error('Usage: rag/cli.ts <data-directory> <project-root> <documents-root>; JSON query on stdin')
  if (!docs || !path.isAbsolute(docs) || !path.resolve(docs).startsWith(path.resolve(workspace) + path.sep)) throw new Error('Documents must be inside the project root')
  const request = JSON.parse(input)
  if (typeof request.query !== 'string' || !request.query.trim() || request.query.length > 2000) throw new Error('query must contain 1–2000 characters')
  const project = request.project ?? 'docs'
  if (project !== 'docs' || (request.history !== undefined && typeof request.history !== 'boolean')) throw new Error('RAG scope must be docs; history must be boolean')
  process.env.MEW_DATA_DIR = data
  const [{ setWorkspaceRoot, setDocsDir, projectRoot }, { RagIndex }, { LocalE5Embeddings }, { readRagSettings }, { buildTreeAsync }, { flattenTextFiles }] = await Promise.all([
    import('../paths.ts'), import('./index.ts'), import('./embeddings.ts'), import('./settings.ts'), import('../tree.ts'), import('../search.ts'),
  ])
  const settings = readRagSettings(data)
  if (!settings.enabled || settings.environmentDisabled) throw new Error('RAG is disabled')
  setWorkspaceRoot(workspace)
  setDocsDir(path.relative(workspace, docs))
  const root = projectRoot(project)
  const index = new RagIndex(workspace, new LocalE5Embeddings(undefined, path.join(data, 'rag/models')), data, () => root)
  const files = flattenTextFiles(await buildTreeAsync(project))
  return { root, ...(await index.search(project, files, request.query.trim(), request.history === true)) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await ragCli(process.argv.slice(2))) + '\n') }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1 }
}
