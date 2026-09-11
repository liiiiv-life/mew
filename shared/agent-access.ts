export type AccessIssue = 'subscription_required' | 'quota_exhausted' | 'credits_exhausted'

/** Only explicit provider billing failures override an authentication wrapper. */
export function accessIssueFromError(error: unknown): AccessIssue | null {
  const value = error && typeof error === 'object' ? error as { message?: unknown; data?: unknown } : null
  const message = typeof value?.message === 'string' ? value.message : typeof error === 'string' ? error : ''
  let details = ''
  try { details = value?.data ? JSON.stringify(value.data) : '' } catch { /* local errors may have circular metadata */ }
  const text = `${message} ${details}`.slice(0, 16_000)
  if (/insufficient[_ ](?:credit|balance)|(?:credit|balance)s? (?:are |is )?(?:exhausted|depleted|insufficient)|credit balance is too low/i.test(text)) return 'credits_exhausted'
  if (/subscription (?:is )?required|(?:no|without an?|inactive|expired) (?:active |paid )?subscription|(?:requires?|need) (?:an? )?(?:paid |active )?(?:plan|subscription)|not subscribed/i.test(text)) return 'subscription_required'
  if (/insufficient_quota|usage_limit_reached|(?:reached|exceeded|exhausted).{0,45}(?:usage limit|quota)|(?:usage limit|quota).{0,45}(?:reached|exceeded|exhausted)|out of (?:usage|quota)|exceeded your current quota/i.test(text)) return 'quota_exhausted'
  return null
}

export type RuntimeAccount = {
  runtime: string
  account: string | null
  plan: string | null
  authentication: 'connected' | 'signed_out' | 'unknown' | 'api_key'
  subscription: 'free' | 'paid' | 'unknown'
  issue: AccessIssue | null
  subscriptionUrl: string | null
  note: string | null
  checkedAt: string
}

export const SUBSCRIPTION_URLS: Record<string, string> = {
  kimi: 'https://www.kimi.com/membership/subscription?tab=quota',
  codex: 'https://chatgpt.com/codex/settings/usage',
  claude: 'https://claude.ai/settings/billing',
  cursor: 'https://cursor.com/dashboard',
}
