import test from 'node:test'
import assert from 'node:assert/strict'
import { canOpenEditorFile } from './editor-open-policy.ts'
import { editorTabPath } from './editor-files.ts'
import { externalTabPath } from './externalFiles.ts'

test('documents, source code, configuration and supported viewers can open', () => {
  for (const path of ['note.md', 'README', 'Dockerfile', '.env.local', 'source.cpp', 'main.tsx', 'settings.yaml', 'diagram.svg', 'photo.PNG', 'video.mp4', 'sound.mp3', 'report.pdf', 'sheet.xlsx', 'table.csv']) {
    assert.equal(canOpenEditorFile(path), true, path)
    assert.equal(canOpenEditorFile(editorTabPath('docs', path)), true, path)
    assert.equal(canOpenEditorFile(externalTabPath(`/outside/${path}`)), true, path)
  }
})

test('executables, archives and unknown data never become text editor tabs', () => {
  for (const path of ['installer.EXE', 'library.dll', 'app.apk', 'app.aab', 'archive.zip', 'bundle.tar.gz', 'disk.iso', 'data.bin', 'database.sqlite', 'font.woff2', 'mystery', 'file.unknown', 'image.png.exe']) {
    assert.equal(canOpenEditorFile(path), false, path)
    assert.equal(canOpenEditorFile(editorTabPath('docs', path)), false, path)
    assert.equal(canOpenEditorFile(externalTabPath(`/outside/${path}`)), false, path)
  }
})
