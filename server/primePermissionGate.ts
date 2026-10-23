// Prime의 공식 RPC에는 ACP 권한 모드가 없어서, Mew가 공식 extension hook으로 같은 경계를 만든다.
// 상태 파일은 어댑터 프로세스마다 private temp dir에 두며, tool_call 직전에만 읽는다.
import fs from 'node:fs'

type ExtensionAPI = { on: (name: string, callback: (event: any, ctx: any) => unknown) => void }

const stateFile = process.env.MEW_PRIME_PERMISSION_FILE

function mode(): 'ask' | 'full-access' | 'disabled' {
  try {
    const value = JSON.parse(fs.readFileSync(stateFile!, 'utf8')).mode
    return value === 'ask' || value === 'disabled' ? value : 'full-access'
  } catch {
    return 'ask'
  }
}

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', async (event, ctx) => {
    const permission = mode()
    if (permission === 'full-access') return undefined
    if (permission === 'disabled') return { block: true, reason: 'Mew에서 Prime 도구 사용을 껐습니다' }
    const input = JSON.stringify(event.input)
    const allowed = ctx.hasUI && await ctx.ui.confirm(`Prime 도구 실행: ${event.toolName}`, input.slice(0, 2_000))
    return allowed ? undefined : { block: true, reason: 'Mew에서 도구 실행을 허용하지 않았습니다' }
  })
}
