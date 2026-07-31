import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 설정 파일 로딩. **다른 모든 서버 모듈보다 먼저 평가되어야 한다** — 진입점(serve.ts·plugin.ts·
// usersCli.ts)에서 `import './config.ts'`를 첫 줄에 둔다. ESM import는 소스 순서대로 실행되므로,
// 이 파일이 먼저 오면 dataDir.ts 같은 모듈이 상수를 계산할 때 이미 env가 채워져 있다.
// (뒤에 두면 `MEW_DATA_DIR`을 설정 파일에 써도 조용히 무시된다 — 실제로 그랬다.)

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function xdg(envKey: string, fallback: string): string {
  const base = process.env[envKey]
  return base && path.isAbsolute(base) ? base : path.join(os.homedir(), fallback)
}

/** 뒤에 오는 파일이 앞을 덮는다 — 레포 `.env`가 마지막이라 개발 중 임시 덮어쓰기로 쓸 수 있다 */
export function configFiles(): string[] {
  return [path.join(xdg('XDG_CONFIG_HOME', '.config'), 'mew', 'config.env'), path.join(APP_ROOT, '.env')]
}

/** 계정·세션 등 서버 상태의 기본 위치. 레포 안 `.data/`가 이미 있으면 그대로 쓴다 —
 *  이전 설치의 계정이 갑자기 "없는" 상태가 되면 안 되기 때문. 새 설치는 XDG 경로로 간다. */
export function defaultDataDir(): string {
  const legacy = path.join(APP_ROOT, '.data')
  if (fs.existsSync(legacy)) return legacy
  return path.join(xdg('XDG_DATA_HOME', '.local/share'), 'mew')
}

/** 로그·pid 같은 실행 중 부산물 */
export function stateDir(): string {
  return path.join(xdg('XDG_STATE_HOME', '.local/state'), 'mew')
}

for (const file of configFiles()) {
  if (fs.existsSync(file)) process.loadEnvFile(file)
}
