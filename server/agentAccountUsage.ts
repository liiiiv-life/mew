export interface AccountUsageLimit {
  label: string
  percentLeft: number
  resetsAt: string | null
}

export interface AccountUsageSummary {
  limits: AccountUsageLimit[]
  refreshPending: boolean
}

/**
 * CLI 원문은 공급자 소유이라, 확실한 `N% left|remaining` 줄만 읽는다.
 * 나머지 값은 원문에서 확인하게 두고, 형식이 바뀌어도 잘못된 수치를 만들지 않는다.
 */
export function summarizeAccountUsage(output: string): AccountUsageSummary {
  const limits: AccountUsageLimit[] = []
  const seen = new Set<string>()

  for (const line of output.split('\n')) {
    // Codex가 `╭─│ ... │─╯` 상자 안에 상태를 그려도 줄 안의 값은 같다.
    const plainLine = line.replace(/^\s*[│|]\s*/, '').replace(/\s*[│|]\s*$/, '')
    const match = /^\s*(.+?):\s*(\d+(?:\.\d+)?)%\s+(?:left|remaining)(?:\s*\((?:resets?|refreshes?)\s+([^)]+)\))?\s*$/i.exec(plainLine)
    if (!match) continue
    const label = match[1].trim()
    const percentLeft = Number(match[2])
    if (!label || !Number.isFinite(percentLeft) || percentLeft < 0 || percentLeft > 100) continue
    const key = label.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    limits.push({ label, percentLeft, resetsAt: match[3]?.trim() || null })
  }

  return {
    limits,
    refreshPending: /limits:\s*refresh requested/i.test(output),
  }
}
