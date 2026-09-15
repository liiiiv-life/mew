import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { pdfAssetsPlugin } from './pdf-assets-plugin.ts'

test('PDF worker, CJK maps, fonts, decoders and licenses are emitted under the installed version', () => {
  const plugin = pdfAssetsPlugin()
  const assets: { fileName: string; source: Uint8Array }[] = []
  const generate = plugin.generateBundle as (this: unknown) => void
  generate.call({ emitFile: (asset: { fileName: string; source: Uint8Array }) => assets.push(asset) })
  const version = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../node_modules/pdfjs-dist/package.json'), 'utf8')).version
  const names = new Set(assets.map(asset => asset.fileName))
  for (const name of ['pdf.worker.mjs', 'cmaps/Adobe-Korea1-UCS2.bcmap', 'standard_fonts/LiberationSans-Regular.ttf', 'wasm/openjpeg.wasm', 'wasm/jbig2.wasm', 'iccs/CGATS001Compat-v2-micro.icc', 'LICENSE', 'wasm/LICENSE_OPENJPEG']) assert.ok(names.has(`pdf-assets/${version}/${name}`), name)
  assert.ok(assets.every(asset => asset.source.byteLength > 0))
})
