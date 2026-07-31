// 명령어 버튼 설정 읽기(.mew/cmd-button.json)와 세션 이름 생성 — 임시 프로젝트 폴더에 파일을 깔고 검증한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { WORKSPACE_ROOT } from './paths.ts'
import { createProject, deleteProject } from './projects.ts'
import { CmdButtonError, commandSessionName, normalizeCmdButtons, readCmdButtons, writeCmdButtons } from './cmdButtons.ts'

const rand = () => `ztest${process.pid}${Math.random().toString(36).slice(2, 6)}`

function withProject(fn: (name: string, dir: string) => void) {
  const name = rand()
  const dir = path.join(WORKSPACE_ROOT, name)
  createProject(name)
  try {
    fn(name, dir)
  } finally {
    try {
      deleteProject(name)
    } catch {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

function writeCmd(dir: string, json: string) {
  const mew = path.join(dir, '.mew')
  fs.mkdirSync(mew, { recursive: true })
  fs.writeFileSync(path.join(mew, 'cmd-button.json'), json, 'utf-8')
}

test('readCmdButtons: { commands: [...] } 를 이름·명령 쌍으로 읽는다', () => {
  withProject((name, dir) => {
    writeCmd(dir, JSON.stringify({ commands: [
      { name: '빌드', command: 'npm run build' },
      { name: '개발 서버', command: 'npm run dev' },
    ] }))
    const buttons = readCmdButtons(name)
    assert.equal(buttons.length, 2)
    assert.deepEqual(buttons[0], { name: '빌드', command: 'npm run build' })
    assert.equal(buttons[1].command, 'npm run dev')
  })
})

test('readCmdButtons: .mew/cmd-button.json 이 없으면 빈 목록', () => {
  withProject((name) => {
    assert.deepEqual(readCmdButtons(name), [])
  })
})

test('readCmdButtons: 깨진 JSON은 빈 목록으로 폴백한다', () => {
  withProject((name, dir) => {
    writeCmd(dir, '{ this is not json')
    assert.deepEqual(readCmdButtons(name), [])
  })
})

test('readCmdButtons: 이름·명령이 빠진 항목은 건너뛰고 공백은 트림한다', () => {
  withProject((name, dir) => {
    writeCmd(dir, JSON.stringify({ commands: [
      { name: '  다듬기  ', command: '  echo hi  ' },
      { name: '', command: 'nope' },
      { name: 'no-cmd' },
      { command: 'no-name' },
      'not-an-object',
    ] }))
    const buttons = readCmdButtons(name)
    assert.equal(buttons.length, 1)
    assert.deepEqual(buttons[0], { name: '다듬기', command: 'echo hi' })
  })
})

test('readCmdButtons: 최상위가 배열이어도 관대하게 받는다', () => {
  withProject((name, dir) => {
    writeCmd(dir, JSON.stringify([{ name: 'A', command: 'ls' }]))
    assert.deepEqual(readCmdButtons(name), [{ name: 'A', command: 'ls' }])
  })
})

test('writeCmdButtons: .mew 폴더가 없어도 만들고, 읽기와 왕복한다', () => {
  withProject((name, dir) => {
    writeCmdButtons(name, [{ name: '빌드', command: 'npm run build' }])
    assert.ok(fs.existsSync(path.join(dir, '.mew', 'cmd-button.json')))
    assert.deepEqual(readCmdButtons(name), [{ name: '빌드', command: 'npm run build' }])
    // 손으로 고친 파일과 같은 자리를 쓰므로 다시 저장하면 통째로 대체된다
    writeCmdButtons(name, [])
    assert.deepEqual(readCmdButtons(name), [])
  })
})

test('normalizeCmdButtons: 공백을 다듬고 이름·명령이 비면 거부한다', () => {
  assert.deepEqual(normalizeCmdButtons([{ name: '  빌드 ', command: ' npm run build ' }]), [
    { name: '빌드', command: 'npm run build' },
  ])
  assert.throws(() => normalizeCmdButtons([{ name: '', command: 'ls' }]), CmdButtonError)
  assert.throws(() => normalizeCmdButtons([{ name: 'A', command: '   ' }]), CmdButtonError)
  assert.throws(() => normalizeCmdButtons('배열 아님'), CmdButtonError)
})

test('normalizeCmdButtons: 이름이 겹치면 거부한다 (세션 이름이 이름 해시라 세션을 공유하게 된다)', () => {
  assert.throws(
    () => normalizeCmdButtons([{ name: 'A', command: 'ls' }, { name: 'A', command: 'pwd' }]),
    CmdButtonError,
  )
})

test('commandSessionName: 결정적이고 세션 이름 규칙을 만족하며 프로젝트·버튼명으로 갈린다', () => {
  const a = commandSessionName('proj', '빌드')
  assert.equal(a, commandSessionName('proj', '빌드')) // 결정적
  assert.match(a, /^mewcmd-[a-z0-9]+$/) // 특수 프리픽스 + hex
  assert.match(a, /^[a-zA-Z0-9_-]{1,50}$/) // tmux 세션 이름 규칙
  assert.notEqual(a, commandSessionName('other', '빌드')) // 프로젝트가 다르면 다름
  assert.notEqual(a, commandSessionName('proj', '테스트')) // 버튼명이 다르면 다름
})
