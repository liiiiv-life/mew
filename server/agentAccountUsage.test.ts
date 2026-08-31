import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeAccountUsage } from './agentAccountUsage.ts'

test('summarizeAccountUsage reads remaining limits and reset times', () => {
  assert.deepEqual(
    summarizeAccountUsage('│  5h limit: 84% left (resets 09:10 on 3 Sep) │\n│ Weekly limit: 63% remaining │\nCredits: 12'),
    {
      limits: [
        { label: '5h limit', percentLeft: 84, resetsAt: '09:10 on 3 Sep' },
        { label: 'Weekly limit', percentLeft: 63, resetsAt: null },
      ],
      refreshPending: false,
    },
  )
})

test('summarizeAccountUsage does not invent a limit while Codex refreshes', () => {
  assert.deepEqual(summarizeAccountUsage('Limits: refresh requested; run /status again shortly.'), { limits: [], refreshPending: true })
})

test('summarizeAccountUsage ignores malformed or impossible percentages', () => {
  assert.deepEqual(summarizeAccountUsage('Weekly: 101% left\nCredits: 50'), { limits: [], refreshPending: false })
})
