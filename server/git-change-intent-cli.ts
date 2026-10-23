import { recordChangeIntent } from './git-change-intent.ts'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--cwd' || !args[1]) throw new Error('Usage: node git-change-intent-cli.ts --cwd <repository directory>; JSON on stdin: {"purpose":"why","files":["root-relative path"],"verification":"actually performed checks (optional)"}')
let input = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) {
  input += chunk
  if (input.length > 32_000) throw new Error('변경 목적 입력이 너무 큽니다')
}
process.stdout.write(`${await recordChangeIntent(args[1], JSON.parse(input))}\n`)
