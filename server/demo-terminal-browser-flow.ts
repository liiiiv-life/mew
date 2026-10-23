import assert from 'node:assert/strict'
import type { Page } from 'playwright-core'

export async function verifyDemoTerminal(page: Page, width: number): Promise<void> {
  if (width === 390) await page.locator('.mobile-dock [data-dock-item="terminal"]').click()
  const header = page.locator('[data-agent-tab-bar="terminal"]:visible').first()
  const create = page.getByRole('button', { name: '새 터미널', exact: true })
  if (await create.isVisible()) await create.click()
  const input = page.locator('[data-workspace-panel="terminal"] textarea[placeholder]:visible').first()
  await input.waitFor()
  const root = await page.evaluate<string>('globalThis.demoWorkspace.workspaceInfo().path')
  const run = async (command: string) => { await input.fill(command); await input.press('Control+Enter') }
  await run('mkdir -p terminal-demo && cd terminal-demo && echo browser-shell > first.txt')
  await page.waitForFunction(`globalThis.demoWorkspace.repositoryEntries().some(file => file.path.endsWith('terminal-demo/first.txt') && file.content === ${JSON.stringify('browser-shell\n')})`)
  assert.equal(await page.evaluate(`globalThis.demoWorkspace.gitWorkingTree().files.some(file => file.path.endsWith('terminal-demo/first.txt') && file.status === '?')`), true)
  await header.getByRole('button', { name: '새 탭', exact: true }).click()
  await page.locator('[data-workspace-panel="terminal"] textarea[placeholder]:visible').first().waitFor()
  await header.getByRole('tab').first().click()
  await input.waitFor()
  await run('echo resumed > second.txt')
  await page.waitForFunction(`globalThis.demoWorkspace.repositoryEntries().some(file => file.path.endsWith('terminal-demo/second.txt') && file.content === ${JSON.stringify('resumed\n')})`)
  assert.equal(await page.evaluate(`globalThis.demoWorkspace.readFile(${JSON.stringify(`${root}/terminal-demo/second.txt`)}).content`), 'resumed\n')
}
