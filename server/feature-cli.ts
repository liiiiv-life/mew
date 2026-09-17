import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FeatureStore } from './features.ts'

/** Runtime-neutral bridge. JSON arrives on stdin, so request text is never shell code. */
export async function featureCli(args: string[], input: () => string = () => fs.readFileSync(0, 'utf8')) {
  const [storeDirectory, workspace, runId, action] = args
  if (!storeDirectory || !path.isAbsolute(storeDirectory) || !workspace || !path.isAbsolute(workspace) || !runId) throw new Error('Usage: feature-cli.ts <store> <workspace> <request-id> list|assign|report')
  const store = new FeatureStore(storeDirectory)
  await store.prepare(workspace)
  const data = store.read(workspace)
  if (!data.runs.some(run => run.id === runId)) throw new Error('Unknown feature request')
  if (action === 'list') return { features: data.features, request: data.runs.find(run => run.id === runId) }
  if (action === 'assign') return store.assign(workspace, runId, JSON.parse(input()))
  if (action === 'report') return store.report(workspace, runId, JSON.parse(input()))
  throw new Error('Use list, assign or report')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await featureCli(process.argv.slice(2))) + '\n') }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1 }
}
