import path from 'node:path'
import { parseArgs } from 'node:util'
import { applyProjectSetup, defaultAgentSettings, planProjectSetup, readProjectAgentSettings } from './project-setup.ts'
import { projectDocsDir } from './project-agent-settings.ts'

try {
  const { values } = parseArgs({ options: {
    project: { type: 'string' }, docs: { type: 'string' }, entry: { type: 'string', multiple: true },
    instructions: { type: 'string' }, enable: { type: 'boolean' }, disable: { type: 'boolean' },
    'init-docs': { type: 'boolean' }, 'export-agents': { type: 'boolean' }, create: { type: 'boolean' },
    apply: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } })
  if (values.help) {
    console.log(`Usage: npm run project:setup -- --project /absolute/path [options]

Defaults to a read-only preview. Add --apply to write the plan.
  --docs <relative-path>    Connect Documents inside the project
  --entry <relative.md>     Additional entrypoint (repeatable; replaces saved list)
  --instructions <text>    Additional project guidance (empty string clears it)
  --enable / --disable     Enable or disable automatic context
  --init-docs              Create missing documentation entrypoints and README
  --export-agents          Create AGENTS.md for external tools, if absent
  --create                Create a new project directory
  --apply                 Apply the previewed changes; existing docs stay intact`)
  } else {
    if (!values.project || !path.isAbsolute(values.project)) throw new Error('--project에 프로젝트 절대 경로를 입력하세요')
    if (values.enable && values.disable) throw new Error('--enable과 --disable 중 하나를 선택하세요')
    const projectRoot = path.resolve(values.project)
    const settings = readProjectAgentSettings(projectRoot) ?? defaultAgentSettings(projectDocsDir(projectRoot))
    if (values.docs !== undefined) settings.docsDir = values.docs
    if (values.entry !== undefined) settings.entrypoints = values.entry
    if (values.instructions !== undefined) settings.instructions = values.instructions
    if (values.enable || values.disable) settings.enabled = values.enable === true
    const input = { projectRoot, settings, initDocs: values['init-docs'], exportAgents: values['export-agents'], create: values.create }
    const plan = planProjectSetup(input)
    console.log(JSON.stringify({ applied: values.apply === true, ...(values.apply ? applyProjectSetup(input, plan.revision) : plan) }, null, 2))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
