import assert from 'node:assert/strict'
import test from 'node:test'
import { userProfile, validateAvatarDataUrl, validateDisplayName, type UserRecord } from './auth.ts'

const record: UserRecord = {
  hash: 'not-used',
  role: 'member',
  mustChangePassword: false,
  createdAt: 0,
  passwordChangedAt: 0,
}

test('기존 계정은 이메일 앞부분을 표시 이름으로 쓴다', () => {
  assert.deepEqual(userProfile('hello@example.com', record), {
    email: 'hello@example.com',
    displayName: 'hello',
    avatarDataUrl: null,
  })
})

test('표시 이름과 프로필 사진 입력을 제한한다', () => {
  assert.equal(validateDisplayName('  홍길동  '), '홍길동')
  assert.equal(validateDisplayName(''), null)
  assert.equal(validateDisplayName('a\nname'), null)

  const png = `data:image/png;base64,${Buffer.from('image').toString('base64')}`
  assert.equal(validateAvatarDataUrl(png), png)
  assert.equal(validateAvatarDataUrl('data:image/svg+xml;base64,PHN2Zy8+'), undefined)
  assert.equal(validateAvatarDataUrl(`data:image/png;base64,${Buffer.alloc(512 * 1024 + 1).toString('base64')}`), undefined)
})
