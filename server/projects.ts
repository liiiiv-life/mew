// 프로젝트(=워크스페이스 루트의 최상위 폴더) 생성·개명·삭제. owner만 호출한다(라우트에서 requireRole).
// 삭제는 폴더를 통째로 지우는 되돌릴 수 없는 작업이라, 기본(docs)과 앱 자신은 보호한다.
import fs from 'node:fs'
import path from 'node:path'
import { WORKSPACE_ROOT, isProtectedProject, isValidProjectName, projectRoot } from './paths.ts'
import { ConflictError } from './documents.ts'
import { readProjectIcon } from './projectIcons.ts'
import { readProjectLayout, writeProjectLayout } from './projectLayout.ts'

export class ProjectNameError extends Error {}

function assertValidName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !isValidProjectName(name)) {
    throw new ProjectNameError(`올바른 프로젝트 이름이 아닙니다: ${String(name)}`)
  }
}

/** 워크스페이스 루트에 새 최상위 폴더(=프로젝트)를 만든다. git 레포가 아니라 저장만 되고 커밋은 안 남는다. */
export function createProject(name: string): { name: string } {
  assertValidName(name)
  const dir = path.join(WORKSPACE_ROOT, name)
  if (fs.existsSync(dir)) throw new ConflictError(`이미 존재하는 프로젝트입니다: ${name}`)
  fs.mkdirSync(dir)
  return { name }
}

/** 프로젝트 폴더 이름을 바꾸고, 프로젝트 아이콘 파일·공용 배치를 함께 옮긴다. */
export function renameProject(oldName: string, newName: string): { name: string } {
  assertValidName(oldName)
  assertValidName(newName)
  if (isProtectedProject(oldName)) throw new ProjectNameError(`보호된 프로젝트(${oldName})는 이름을 바꿀 수 없습니다`)
  if (newName === oldName) return { name: newName }
  const from = projectRoot(oldName) // 존재 확인 (없으면 UnknownProjectError)
  const to = path.join(WORKSPACE_ROOT, newName)
  if (fs.existsSync(to)) throw new ConflictError(`이미 존재하는 프로젝트입니다: ${newName}`)
  readProjectIcon(from) // Migrate legacy sidebar data before moving the project.
  fs.renameSync(from, to)

  // 배치 키 이동
  const layout = readProjectLayout()
  if (oldName in layout) {
    layout[newName] = layout[oldName]
    delete layout[oldName]
    writeProjectLayout(layout)
  }
  return { name: newName }
}

/** 프로젝트 폴더를 통째로(재귀) 삭제한다 — 되돌릴 수 없다. 기본·앱 프로젝트는 지울 수 없다. */
export function deleteProject(name: string): void {
  assertValidName(name)
  if (isProtectedProject(name)) throw new ProjectNameError(`보호된 프로젝트(${name})는 삭제할 수 없습니다`)
  const dir = projectRoot(name) // 존재 확인 (없으면 UnknownProjectError)

  // 배치 정리를 먼저 — 상태 파일이 깨져 저장이 막힌 상황이라면 폴더를 지우기 전에 멈춘다
  const layout = readProjectLayout()
  if (name in layout) {
    delete layout[name]
    writeProjectLayout(layout)
  }
  fs.rmSync(dir, { recursive: true, force: true })
}
