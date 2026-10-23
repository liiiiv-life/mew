import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DATA_DIR } from './dataDir.ts'
import { AGENT_GUIDANCE_PATH, GuidanceError, agentGuidanceSettings, ensureAgentGuidance, readAgentGuidance, updateAgentGuidance } from './agent-guidance.ts'
import { agentContextText } from './agent-context.ts'
import { runWithAgentAccount } from './agent-account-settings.ts'
import { guidanceOptions } from '../shared/agent-guidance.ts'
import { BRANCH_NAME_MAX_LENGTH, BRANCH_PREFIX_MAX_LENGTH, branchGuidanceText, branchGuidanceValidationError, defaultBranchGuidance, type BranchGuidanceSettings } from '../shared/branch-guidance.ts'
import { legacyBranchGuidanceText } from '../shared/branch-guidance-v1.ts'
import { previousBranchGuidanceText } from '../shared/branch-guidance-v2.ts'

const start = '<!-- mew:agent-setting:branch -->'
const end = '<!-- /mew:agent-setting:branch -->'
const block = (value: BranchGuidanceSettings) => `${start}\n${branchGuidanceText(value)}\n${end}`
const updateBranch = (changes: Partial<BranchGuidanceSettings> = {}) => updateAgentGuidance({ key: 'branch', value: { ...defaultBranchGuidance, ...changes }, revision: agentGuidanceSettings().revision })

test('GitHub Flow defaults are read-only for existing Markdown and legacy guidance, and template metadata stays exact', () => {
  fs.rmSync(AGENT_GUIDANCE_PATH, { force: true })
  const preview = readAgentGuidance()
  assert.ok(preview.includes(block(defaultBranchGuidance)))
  assert.equal(defaultBranchGuidance.workflow, 'local')
  assert.match(preview, /This selection authorizes creating a task branch/)
  assert.match(preview, /Do not fetch, push, or create a remote pull request unless the user explicitly requests it/)
  assert.doesNotMatch(preview, /Remote automation also authorizes/)
  assert.equal(fs.existsSync(AGENT_GUIDANCE_PATH), false)
  let state = agentGuidanceSettings()
  assert.deepEqual(state.branch, { value: defaultBranchGuidance, custom: false })
  assert.ok(state.content.includes(block(defaultBranchGuidance)), 'the seed template must match generated text exactly')

  const original = '# My instructions\n\nKeep the existing project conventions.\n'
  fs.writeFileSync(AGENT_GUIDANCE_PATH, original)
  state = agentGuidanceSettings()
  assert.equal(state.content, original)
  assert.deepEqual(state.branch, { value: defaultBranchGuidance, custom: false })
  assert.ok(readAgentGuidance().includes(block(defaultBranchGuidance)))
  ensureAgentGuidance()
  assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), original)

  fs.rmSync(AGENT_GUIDANCE_PATH)
  const legacy = path.join(DATA_DIR, 'agent-guidance.txt')
  fs.writeFileSync(legacy, original)
  assert.ok(readAgentGuidance().includes(block(defaultBranchGuidance)))
  assert.equal(fs.existsSync(AGENT_GUIDANCE_PATH), false)
  ensureAgentGuidance()
  assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), original)
  fs.rmSync(legacy)
})

test('branch strategy and all detailed preferences round-trip atomically, preserve other settings, and reach every project', () => {
  const original = '# Handwritten instructions\n\nKeep this exact text.\n'
  fs.writeFileSync(AGENT_GUIDANCE_PATH, original)
  let state = agentGuidanceSettings()
  state = updateAgentGuidance({ key: 'commit', value: 'requested', revision: state.revision })
  const stale = state.revision
  const choices: BranchGuidanceSettings[] = [
    { ...defaultBranchGuidance, baseBranch: 'stable', branchPrefix: 'task-', worktree: 'always', mergeMethod: 'merge', cleanup: true },
    { ...defaultBranchGuidance, strategy: 'git-flow', baseBranch: 'production', developmentBranch: 'next', branchPrefix: 'feature/', worktree: 'never', mergeMethod: 'rebase' },
    { ...defaultBranchGuidance, strategy: 'trunk', branchPrefix: '' },
  ]
  for (const value of choices) {
    state = updateAgentGuidance({ key: 'branch', value, revision: state.revision })
    assert.deepEqual(state.branch, { value, custom: false })
    assert.equal(state.settings.commit, 'requested')
    assert.ok(state.content.startsWith(original))
    for (const name of ['branch-project-a', 'branch-project-b']) {
      const root = path.join(DATA_DIR, name)
      fs.mkdirSync(root, { recursive: true })
      const context = agentContextText({ projectRoot: root, docsRoot: path.join(root, 'docs') }, root)
      assert.ok(context.includes(branchGuidanceText(value)))
      assert.equal(context.includes(guidanceOptions.commit.requested), value.workflow === 'manual')
      assert.equal(context.split(start).length - 1, 1, 'a saved strategy must suppress the fallback default')
    }
  }
  assert.throws(() => updateAgentGuidance({ key: 'branch', value: defaultBranchGuidance, revision: stale }), (error: unknown) => error instanceof GuidanceError && error.status === 409)
  assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), state.content)
  state = updateAgentGuidance({ key: 'language', value: 'ko', revision: state.revision })
  assert.deepEqual(state.branch.value, choices.at(-1))
  assert.equal(state.settings.language, 'ko')
})

test('explicit inherit persists an empty guidance block and does not silently re-enable branch instructions', () => {
  fs.writeFileSync(AGENT_GUIDANCE_PATH, 'My rules\n')
  let state = updateBranch({ strategy: 'inherit', worktree: 'always' })
  assert.equal(state.branch.value.strategy, 'inherit')
  assert.ok(state.content.includes(start))
  assert.doesNotMatch(readAgentGuidance(), /Use GitHub Flow|Use a separate Git worktree for task work/)
  ensureAgentGuidance()
  state = updateAgentGuidance({ key: 'detail', value: 'concise', revision: state.revision })
  assert.equal(state.branch.value.strategy, 'inherit')
  assert.doesNotMatch(readAgentGuidance(), /Use GitHub Flow/)
  state = updateBranch()
  assert.equal(state.branch.value.strategy, 'github-flow')
  assert.match(readAgentGuidance(), /Use GitHub Flow/)
})

test('handwritten branch guidance and metadata edits stay custom until explicitly replaced', () => {
  const customCases = [
    `${start}\nFollow our team workflow.\n${end}`,
    block(defaultBranchGuidance).replace('Use GitHub Flow:', 'Use our custom workflow:'),
    `${start}\n<!-- mew:branch-guidance:v2 {} -->\nKeep this.\n${end}`,
    `${start}\n<!-- mew:branch-guidance:v3 {} -->\nKeep this.\n${end}`,
    `${start}\n<!-- mew:branch-guidance:v1 {"strategy":"github-flow"} -->\nKeep this.\n${end}`,
  ]
  for (const custom of customCases) {
    fs.writeFileSync(AGENT_GUIDANCE_PATH, `Preserve my prose.\n\n${custom}\n`)
    let state = agentGuidanceSettings()
    assert.equal(state.branch.custom, true)
    assert.equal(readAgentGuidance().split(start).length - 1, 1)
    assert.ok(readAgentGuidance().includes(custom))
    state = updateAgentGuidance({ key: 'language', value: 'en', revision: state.revision })
    assert.ok(state.content.includes(custom), 'changing another preference must keep handwritten branch rules')
    state = updateAgentGuidance({ key: 'branch', value: { ...defaultBranchGuidance, strategy: 'trunk' }, revision: state.revision })
    assert.equal(state.branch.custom, false)
    assert.equal(state.branch.value.strategy, 'trunk')
    assert.ok(state.content.startsWith('Preserve my prose.'))
    assert.ok(!state.content.includes(custom))
  }
})

test('missing, duplicated, nested, and overlapping markers reject every write without losing content', () => {
  const languageStart = '<!-- mew:agent-setting:language -->', languageEnd = '<!-- /mew:agent-setting:language -->'
  for (const damaged of [
    `${start}\nMissing end`, end, `${end}${start}`,
    `${block(defaultBranchGuidance)}\n${block(defaultBranchGuidance)}`,
    `${start}${languageStart}Keep this.${end}${languageEnd}`,
    `${languageStart}${block(defaultBranchGuidance)}${languageEnd}`,
    `${start}${languageStart}Keep this.${languageEnd}${end}`,
  ]) {
    fs.writeFileSync(AGENT_GUIDANCE_PATH, damaged)
    const state = agentGuidanceSettings()
    assert.equal(readAgentGuidance().split(start).length - 1, damaged.split(start).length - 1)
    for (const [key, value] of [['branch', defaultBranchGuidance], ['detail', 'detailed']] as const) {
      assert.throws(() => updateAgentGuidance({ key, value, revision: state.revision }), (error: unknown) => error instanceof GuidanceError && error.status === 409)
      assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), damaged)
    }
  }
})

test('API validates complete settings, ref rules, safe text, lengths and enums before touching the file', () => {
  fs.writeFileSync(AGENT_GUIDANCE_PATH, 'Keep original\n')
  const state = agentGuidanceSettings()
  const invalid: unknown[] = [null, [], {}, { ...defaultBranchGuidance, extra: true }, { ...defaultBranchGuidance, strategy: '__proto__' }, { ...defaultBranchGuidance, worktree: 'sometimes' }, { ...defaultBranchGuidance, mergeMethod: 'force' }, { ...defaultBranchGuidance, cleanup: 'true' }, { ...defaultBranchGuidance, developmentBranch: '' }]
  for (const ref of ['HEAD', '-main', 'foo bar', 'foo\nbar', '/main', 'main/', 'foo//bar', 'foo..bar', '.main', 'foo/.main', 'foo.lock', 'foo.lock/bar', 'main.', 'foo@{bar', 'foo~1', 'foo^', 'foo:bar', 'foo?bar', 'foo[bar', 'foo\\bar', '$(id)', '`id`', 'foo;bar', 'foo"bar', 'foo<!--bar', 'x'.repeat(BRANCH_NAME_MAX_LENGTH + 1)]) {
    invalid.push({ ...defaultBranchGuidance, baseBranch: ref })
    invalid.push({ ...defaultBranchGuidance, developmentBranch: ref })
  }
  for (const prefix of ['-task', 'foo//', '.hidden/', 'foo.lock/', 'foo..', 'foo\n', '$(id)', 'x'.repeat(BRANCH_PREFIX_MAX_LENGTH + 1)]) invalid.push({ ...defaultBranchGuidance, branchPrefix: prefix })
  for (const value of invalid) {
    assert.ok(branchGuidanceValidationError(value), `invalid input ${JSON.stringify(value)}`)
    assert.throws(() => updateAgentGuidance({ key: 'branch', value, revision: state.revision }), (error: unknown) => error instanceof GuidanceError && error.status === 400)
    assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), state.content)
  }
  for (const ref of ['main', 'release/1.2', '작업/브랜치', 'team/my_task-1', 'x'.repeat(BRANCH_NAME_MAX_LENGTH)]) {
    assert.equal(branchGuidanceValidationError({ ...defaultBranchGuidance, baseBranch: ref, developmentBranch: ref }), null)
    execFileSync('git', ['check-ref-format', '--branch', ref], { stdio: 'pipe' })
  }
  for (const prefix of ['', 'feat/', 'task-', '작업/', 'x'.repeat(BRANCH_PREFIX_MAX_LENGTH)]) assert.equal(branchGuidanceValidationError({ ...defaultBranchGuidance, branchPrefix: prefix }), null)
})

test('generated policies distinguish strategy bases, safe isolation, integration and authorization', () => {
  const github = branchGuidanceText(defaultBranchGuidance)
  assert.match(github, /short-lived task branch/)
  assert.match(github, /reviewed pull request/)
  assert.match(github, /locally recorded origin\/HEAD/)
  assert.match(github, /existing local main or master/)
  assert.match(github, /Do not contact a remote/)
  assert.match(github, /Preserve all existing staged and unstaged work/)
  assert.match(github, /Never automatically stash, reset, clean/)
  assert.match(github, /checkout is shared, unrelated changes exist/)
  assert.match(github, /If the folder is not a Git repository, skip/)
  assert.match(github, /required local base is missing/)
  assert.match(github, /Local automation authorizes local integration only/)
  assert.match(github, /Keep task branches and worktrees after completion/)
  assert.match(github, /<primary-checkout>\/\.worktrees\/<safe-branch-slug>/)
  assert.match(github, /follow an explicit user or repository location first/)
  assert.match(github, /shared Git directory and registered worktrees/)
  assert.match(github, /never create nested worktrees or sibling folders/)
  assert.match(github, /replacing \/ with -/)
  assert.match(github, /verify that \/\.worktrees\/ is ignored in the primary checkout/)
  assert.match(github, /add that entry to its \.gitignore if missing while preserving existing edits/)
  assert.match(github, /Keep existing worktrees at their current paths unless the user requests relocation/)
  assert.match(github, /use git worktree move after confirming that no running process or session depends on its old path/)
  const gitflow = branchGuidanceText({ ...defaultBranchGuidance, strategy: 'git-flow', baseBranch: 'production', developmentBranch: 'next', cleanup: true, workflow: 'manual' })
  assert.match(gitflow, /existing local branch "production"/)
  assert.match(gitflow, /existing local development branch "next"/)
  assert.match(gitflow, /release\/ branches from that development branch and hotfix\/ branches from the primary base/)
  assert.match(gitflow, /do not run git flow init/)
  assert.match(gitflow, /its deletion is authorized/)
  assert.match(gitflow, /Never delete the current branch, a protected branch, or a remote branch automatically/)
  const trunk = branchGuidanceText({ ...defaultBranchGuidance, strategy: 'trunk', worktree: 'never', mergeMethod: 'rebase' })
  assert.match(trunk, /very small and short-lived/)
  assert.match(trunk, /Do not create a Git worktree automatically/)
  assert.match(trunk, /Do not rewrite shared or published history or force-push/)
})

test('v1 settings use the local-only default at request time and preserve their exact source', () => {
  const { workflow: ignored, ...legacy } = { ...defaultBranchGuidance, baseBranch: 'stable', branchPrefix: 'task/', cleanup: true }
  assert.equal(ignored, 'local')
  const legacyBlock = `${start}\n${legacyBranchGuidanceText(legacy)}\n${end}`
  const original = `# Keep my rules\n\n${legacyBlock}\n`
  fs.writeFileSync(AGENT_GUIDANCE_PATH, original)
  let state = agentGuidanceSettings()
  assert.deepEqual(state.branch, { value: { ...legacy, workflow: 'local' }, custom: false })
  assert.equal(readAgentGuidance().includes(legacyBlock), false, 'the old manual instructions are replaced only in the effective request')
  assert.match(readAgentGuidance(), /Local automation authorizes local integration only/)
  assert.doesNotMatch(readAgentGuidance(), /Remote automation also authorizes/)
  assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), original)
  state = updateAgentGuidance({ key: 'detail', value: 'concise', revision: state.revision })
  assert.ok(state.content.includes(legacyBlock), 'unrelated settings never migrate the saved block')
  state = updateAgentGuidance({ key: 'branch', value: { ...state.branch.value, workflow: 'local' }, revision: state.revision })
  assert.equal(state.branch.custom, false)
  assert.equal(state.branch.value.baseBranch, 'stable')
  assert.equal(state.branch.value.workflow, 'local')
  assert.match(state.content, /mew:branch-guidance:v3/)
  fs.writeFileSync(AGENT_GUIDANCE_PATH, original.replace('Use GitHub Flow:', 'Use our team workflow:'))
  assert.equal(agentGuidanceSettings().branch.custom, true, 'handwritten v1 text is preserved as custom')
})

test('saved v2 strategies and automation preferences receive current worktree guidance without rewriting their source', () => {
  for (const strategy of ['github-flow', 'git-flow', 'trunk', 'inherit'] as const) {
    for (const workflow of ['manual', 'local', 'remote'] as const) {
      for (const worktree of ['auto', 'always', 'never'] as const) {
        const settings: BranchGuidanceSettings = { ...defaultBranchGuidance, strategy, workflow, worktree, baseBranch: 'stable', developmentBranch: 'integration', branchPrefix: 'task/', cleanup: true, mergeMethod: 'merge' }
        const originalBlock = `${start}\n${previousBranchGuidanceText(settings)}\n${end}`
        const original = `# Keep my instructions\n\n${originalBlock}\n`
        fs.writeFileSync(AGENT_GUIDANCE_PATH, original)
        let state = agentGuidanceSettings()
        assert.deepEqual(state.branch, { value: settings, custom: false })
        assert.equal(state.content, original)
        const effective = readAgentGuidance()
        assert.ok(effective.includes(block(settings)))
        assert.equal(effective.includes('<primary-checkout>/.worktrees/<safe-branch-slug>'), strategy !== 'inherit')
        assert.equal(effective.includes('Remote automation also authorizes'), strategy !== 'inherit' && workflow === 'remote')
        assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), original)

        state = updateAgentGuidance({ key: 'detail', value: 'concise', revision: state.revision })
        assert.ok(state.content.includes(originalBlock), 'unrelated settings must preserve the saved v2 block')
        assert.deepEqual(state.branch, { value: settings, custom: false })
        state = updateAgentGuidance({ key: 'branch', value: state.branch.value, revision: state.revision })
        assert.ok(state.content.includes(block(settings)), 'explicit branch saves use the current version')
      }
    }
  }
})

test('handwritten v2 worktree policies remain custom and reach the request unchanged', () => {
  const settings: BranchGuidanceSettings = { ...defaultBranchGuidance, workflow: 'manual', worktree: 'always' }
  const originalBlock = `${start}\n${previousBranchGuidanceText(settings).replace('Use a separate Git worktree for task work;', 'Use ../custom-worktrees for task work;')}\n${end}`
  const original = `# Keep my instructions\n\n${originalBlock}\n`
  fs.writeFileSync(AGENT_GUIDANCE_PATH, original)
  let state = agentGuidanceSettings()
  assert.deepEqual(state.branch, { value: settings, custom: true })
  assert.ok(readAgentGuidance().includes(originalBlock))
  assert.doesNotMatch(readAgentGuidance(), /<primary-checkout>\/\.worktrees/)
  state = updateAgentGuidance({ key: 'language', value: 'ko', revision: state.revision })
  assert.ok(state.content.includes(originalBlock))
  assert.ok(readAgentGuidance().includes(originalBlock))
})

test('selected automation grants only its scope, suppresses conflicting standard commit text at request time and preserves saved choices', () => {
  fs.writeFileSync(AGENT_GUIDANCE_PATH, '# Keep my independent instructions\n')
  let state = agentGuidanceSettings()
  state = updateAgentGuidance({ key: 'commit', value: 'requested', revision: state.revision })
  for (const workflow of ['local', 'remote', 'manual'] as const) {
    state = updateAgentGuidance({ key: 'branch', value: { ...defaultBranchGuidance, workflow, cleanup: true }, revision: state.revision })
    const effective = readAgentGuidance()
    assert.equal(state.settings.commit, 'requested', 'automation never overwrites the stored commit preference')
    assert.ok(state.content.includes(guidanceOptions.commit.requested))
    assert.equal(effective.includes(guidanceOptions.commit.requested), workflow === 'manual')
    assert.equal(effective.includes('This selection authorizes creating a task branch'), workflow !== 'manual')
    assert.equal(effective.includes('Remote automation also authorizes fetch and ordinary push'), workflow === 'remote')
    assert.equal(effective.includes('Do not fetch, push, or create a remote pull request'), workflow !== 'remote')
    if (workflow !== 'manual') {
      assert.match(effective, /without asking for each Git step/)
      assert.match(effective, /Do not finish by handing the user an unmerged task branch/)
      assert.match(effective, /If checks fail or unrelated changes make integration unsafe/)
      assert.match(effective, /cleanup setting authorizes removing this task/)
      assert.match(effective, /including patch equivalence after a squash merge/)
      assert.match(effective, /never remove the checkout in which this agent session is still running/)
    }
    assert.equal(fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8'), state.content)
    ensureAgentGuidance()
    assert.equal(agentGuidanceSettings().branch.value.workflow, workflow, 'explicit manual or remote selections override the local default')
  }
  state = updateBranch({ workflow: 'remote' })
  const custom = state.content.replace(guidanceOptions.commit.requested, 'Do not commit our generated reports.')
  fs.writeFileSync(AGENT_GUIDANCE_PATH, custom)
  assert.match(readAgentGuidance(), /Do not commit our generated reports/)
  state = agentGuidanceSettings()
  state = updateAgentGuidance({ key: 'branch', value: { ...state.branch.value, strategy: 'inherit' }, revision: state.revision })
  assert.match(readAgentGuidance(), /Do not commit our generated reports/)
  assert.doesNotMatch(readAgentGuidance(), /The user selected Git automation/)
  for (const workflow of [null, true, 'all', '__proto__']) {
    assert.throws(() => updateBranch({ workflow } as unknown as Partial<BranchGuidanceSettings>), GuidanceError)
  }
})

test('branch preferences stay isolated by Mew account', () => {
  runWithAgentAccount('branch-alice@example.test', () => updateBranch({ strategy: 'git-flow', developmentBranch: 'integration' }))
  runWithAgentAccount('branch-bob@example.test', () => {
    assert.deepEqual(agentGuidanceSettings().branch.value, defaultBranchGuidance)
    updateBranch({ strategy: 'inherit' })
  })
  runWithAgentAccount('branch-alice@example.test', () => {
    assert.equal(agentGuidanceSettings().branch.value.strategy, 'git-flow')
    assert.match(readAgentGuidance(), /development branch "integration"/)
  })
  runWithAgentAccount('branch-bob@example.test', () => assert.doesNotMatch(readAgentGuidance(), /Use Git Flow|Use GitHub Flow/))
})
