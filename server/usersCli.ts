import './config.ts' // 반드시 첫 줄 — 설정 파일을 다른 모듈보다 먼저 읽는다
import {
  ACCOUNT_ROLES,
  generateTempPassword,
  getUser,
  hashPassword,
  isAccountRole,
  isValidEmail,
  listUsers,
  normalizeEmail,
  removeUser,
  upsertUser,
} from './auth.ts'

// 팀 배포(5000) 승인 리스트 관리 — 내부 서버에서만 실행한다.
//   npm run users -- add <email> [role]   임시 비밀번호를 만들어 등록 (첫 로그인 때 변경 강제, role 생략 시 member)
//   npm run users -- role <account-id> <role>  기존 계정의 역할 변경 (이메일 계정은 이메일이 ID)
//   npm run users -- reset <email>        임시 비밀번호 재발급 + 기존 세션 전부 무효화
//   npm run users -- remove <account-id> 삭제 (해당 세션·Mewlink 연결도 즉시 무효화)
//   npm run users -- list

const [command, rawAccountId, rawRole] = process.argv.slice(2)

function requireEmail(): string {
  const email = normalizeEmail(rawAccountId)
  if (!isValidEmail(email)) {
    console.error('올바른 이메일을 입력하세요')
    process.exit(1)
  }
  return email
}

function requireExistingAccount() {
  const id = normalizeEmail(rawAccountId), user = getUser(id)
  if (!user) {
    console.error(`${id || '계정'} 은 등록돼 있지 않습니다`)
    process.exit(1)
  }
  return { id, user }
}

function requireRoleArg(): 'owner' | 'manager' | 'member' {
  if (!isAccountRole(rawRole)) {
    console.error(`역할은 ${ACCOUNT_ROLES.join('|')} 중 하나여야 합니다`)
    process.exit(1)
  }
  return rawRole
}

switch (command) {
  case 'add': {
    const email = requireEmail()
    if (getUser(email)) {
      console.error(`${email} 은 이미 등록돼 있습니다 — 비밀번호 재발급은 reset을 쓰세요`)
      process.exit(1)
    }
    const role = rawRole ? requireRoleArg() : 'member'
    const tempPassword = generateTempPassword()
    const now = Date.now()
    upsertUser(email, {
      hash: hashPassword(tempPassword),
      role,
      mustChangePassword: true,
      createdAt: now,
      passwordChangedAt: now,
    })
    console.log(`등록 완료: ${email} (역할: ${role})`)
    console.log(`임시 비밀번호: ${tempPassword}`)
    console.log('본인에게 안전한 채널로 전달하세요 — 첫 로그인 때 변경이 강제됩니다')
    break
  }
  case 'role': {
    const { id, user } = requireExistingAccount()
    const role = requireRoleArg()
    upsertUser(id, { ...user, role })
    console.log(`역할 변경 완료: ${id} → ${role}`)
    break
  }
  case 'reset': {
    const candidate = normalizeEmail(rawAccountId)
    if (!isValidEmail(candidate) && getUser(candidate)?.hasPassword === false) {
      console.error('Mewlink 전용 계정은 비밀번호를 재발급할 수 없습니다 — Mewlink 계정 연결로 접속하세요')
      process.exit(1)
    }
    const email = requireEmail()
    const user = getUser(email)
    if (!user) {
      console.error(`${email} 은 등록돼 있지 않습니다`)
      process.exit(1)
    }
    const tempPassword = generateTempPassword()
    upsertUser(email, {
      ...user,
      hash: hashPassword(tempPassword),
      mustChangePassword: true,
      passwordChangedAt: Date.now(), // 이전 세션 전부 무효화
    })
    console.log(`재발급 완료: ${email} — 기존 로그인 세션은 모두 끊깁니다`)
    console.log(`임시 비밀번호: ${tempPassword}`)
    break
  }
  case 'remove': {
    const { id } = requireExistingAccount()
    removeUser(id)
    console.log(`삭제 완료: ${id} — 해당 세션과 Mewlink 접속은 즉시 무효화됩니다`)
    break
  }
  case 'list': {
    const users = listUsers()
    if (users.length === 0) {
      console.log('등록된 사용자가 없습니다')
      break
    }
    for (const { email, record } of users) {
      const created = new Date(record.createdAt).toISOString().slice(0, 10)
      const temp = record.mustChangePassword ? ' [임시 비밀번호 — 변경 대기]' : ''
      const name = record.displayName?.trim() ? ` (${record.displayName.trim()})` : ''
      const identityOnly = record.hasPassword === false ? ' [Mewlink 전용]' : ''
      console.log(`${email}${name}  [${record.role}]  (등록 ${created})${temp}${identityOnly}`)
    }
    break
  }
  default:
    console.log('사용법: npm run users -- <add|role|reset|remove|list> [email|account-id] [role]')
    process.exit(command ? 1 : 0)
}
