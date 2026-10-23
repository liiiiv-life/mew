import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { hostPaths } from './platform/index.mjs'

export function parseOptions(args, { env = process.env, cwd = process.cwd() } = {}) {
  const locations = hostPaths(env)
  const configPath = path.join(locations.config, 'config.env')
  const saved = fs.existsSync(configPath) ? parseEnv(fs.readFileSync(configPath, 'utf8')) : {}
  const values = { ...saved, ...env }
  const options = {
    workspace: path.resolve(cwd),
    dataDir: path.resolve(cwd, values.MEW_DATA_DIR || locations.data),
    cacheDir: path.join(locations.cache, 'runtimes'),
    port: Number(values.MEW_TEAM_PORT || 5000),
    ownerEmail: '', open: true, help: false, version: false,
    legacyPidfile: path.join(locations.state, 'mew.pid'),
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--version' || arg === '-v') options.version = true
    else if (arg === '--no-open') options.open = false
    else if (['--workspace', '--data-dir', '--cache-dir', '--port', '--owner-email'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`${arg} 값을 입력하세요.`)
      if (arg === '--port') options.port = Number(value)
      else if (arg === '--owner-email') options.ownerEmail = value
      else options[{ '--workspace': 'workspace', '--data-dir': 'dataDir', '--cache-dir': 'cacheDir' }[arg]] = path.resolve(cwd, value)
    } else throw new Error(`알 수 없는 옵션: ${arg}. --help로 사용법을 확인하세요.`)
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('포트는 0~65535 정수여야 합니다. 0은 사용 가능한 포트를 자동으로 선택합니다.')
  if (!options.help && !options.version && !fs.statSync(options.workspace).isDirectory()) throw new Error('워크스페이스는 폴더여야 합니다.')
  return options
}
