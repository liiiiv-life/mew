import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { createApiApp } from './api.ts'
import { isLocalAssetPath, moveAssetIntoProject } from './localAssets.ts'
import { WORKSPACE_ROOT, resolveProjectPath } from './paths.ts'

test('moveAssetIntoProject: 프로젝트 .mew/assets에 바이트를 옮기고 안전한 확장자만 보존한다', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-asset-'))
  const tempPath = path.join(tempDir, 'upload')
  const project = `ztest-asset-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const projectRoot = path.join(WORKSPACE_ROOT, project)
  fs.mkdirSync(projectRoot)
  fs.writeFileSync(tempPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  let relPath = ''
  try {
    relPath = moveAssetIntoProject(project, tempPath, '../../Photo.PNG', 'image/png')
    assert.match(relPath, /^\.mew\/assets\/[0-9a-f-]+\.png$/)
    assert.equal(fs.existsSync(tempPath), false)
    assert.deepEqual(fs.readFileSync(resolveProjectPath(project, relPath)), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('moveAssetIntoProject: 확장자 없는 붙여넣기는 MIME으로 렌더 가능한 확장자를 붙인다', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-asset-mime-'))
  const tempPath = path.join(tempDir, 'upload')
  const project = `ztest-asset-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const projectRoot = path.join(WORKSPACE_ROOT, project)
  fs.mkdirSync(projectRoot)
  fs.writeFileSync(tempPath, '<svg xmlns="http://www.w3.org/2000/svg"/>')

  try {
    const relPath = moveAssetIntoProject(project, tempPath, 'clipboard', 'image/svg+xml')
    assert.match(relPath, /^\.mew\/assets\/[0-9a-f-]+\.svg$/)
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test('isLocalAssetPath: UUID asset만 공개하고 다른 .mew 파일과 경로 변형은 막는다', () => {
  assert.equal(isLocalAssetPath('.mew/assets/123e4567-e89b-42d3-a456-426614174000.webp'), true)
  assert.equal(isLocalAssetPath('.mew/assets/comments.json'), false)
  assert.equal(isLocalAssetPath('.mew/assets/../comments.json'), false)
  assert.equal(isLocalAssetPath('notes/image.webp'), false)
})

test('GET /asset: 프로젝트 .mew/assets의 UUID 파일만 공개한다', async () => {
  const project = `ztest-asset-route-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const projectRoot = path.join(WORKSPACE_ROOT, project)
  const relPath = '.mew/assets/123e4567-e89b-42d3-a456-426614174000.png'
  fs.mkdirSync(path.dirname(path.join(projectRoot, relPath)), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, relPath), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  const app = express()
  app.use('/api', createApiApp())
  const listener = app.listen(0)

  try {
    const address = listener.address()
    assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}/api/asset?project=${encodeURIComponent(project)}&path=${encodeURIComponent(relPath)}`
    const response = await fetch(base)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const denied = await fetch(`http://127.0.0.1:${address.port}/api/asset?project=${encodeURIComponent(project)}&path=${encodeURIComponent('.mew/comments.json')}`)
    assert.equal(denied.status, 404)
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    fs.rmSync(projectRoot, { recursive: true, force: true })
  }
})
