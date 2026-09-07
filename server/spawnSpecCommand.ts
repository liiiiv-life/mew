import type { SpawnSpec } from './agentRuntimes.ts'

function shellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/** 서버 등록표의 spawn spec을 사용자의 셸에서 그대로 실행할 안전한 한 줄로 만든다. */
export function spawnSpecCommand(spec: SpawnSpec): string {
  const envArgs: string[] = []
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (value === undefined) envArgs.push('-u', key)
    else envArgs.push(`${key}=${value}`)
  }
  const command = [spec.cmd, ...spec.args].map(shellArg)
  return envArgs.length > 0
    ? ['env', ...envArgs.map(shellArg), ...command].join(' ')
    : command.join(' ')
}
