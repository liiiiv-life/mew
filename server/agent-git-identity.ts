import { getUser, normalizeEmail, userProfile } from './auth.ts'
import { gitConnections } from './git-connections.ts'
import { workspaceContext } from './paths.ts'

export function agentGitEnv(base: NodeJS.ProcessEnv, account = workspaceContext.getStore()?.account): NodeJS.ProcessEnv {
  if (!account) return { ...base }
  const email = normalizeEmail(account)
  const user = getUser(email)
  if (!user) throw new Error('에이전트를 시작한 로그인 계정을 확인하세요.')
  const identity = gitConnections.get(email)?.identity ?? { name: userProfile(email, user).displayName, email }
  const name = Array.from(identity.name).filter(char => char >= ' ' && char !== '\u007f' && char !== '<' && char !== '>').join('').trim() || email.split('@')[0]
  const env = { ...base }
  for (const key of Object.keys(env)) if (/^GIT_(AUTHOR|COMMITTER)_/.test(key)) delete env[key]
  return { ...env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: identity.email }
}
