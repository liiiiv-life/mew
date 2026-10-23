import { layoutIconSvg, normalizeLayoutSnapshot } from '../src/utils/layout-presets.ts'

// Read a layout snapshot from stdin and emit a portable SVG to stdout.
let input = ''
for await (const chunk of process.stdin) {
  input += chunk
  if (input.length > 1_000_000) throw new Error('Layout input is too large')
}
try {
  const value = JSON.parse(input)
  if (value?.version !== 1 || !value.dock) throw new Error('Expected a version 1 layout snapshot')
  process.stdout.write(layoutIconSvg(normalizeLayoutSnapshot(value)) + '\n')
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Invalid layout'}\n`)
  process.exitCode = 1
}
