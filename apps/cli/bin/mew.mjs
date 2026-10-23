#!/usr/bin/env node
import fs from 'node:fs/promises'
import { parseOptions } from '../src/options.mjs'
import { runtimeTarget, prepareRuntime } from '../src/runtime.mjs'
import { launch } from '../src/launcher.mjs'

const { version } = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
const help = `mew ${version}

사용법: npx @liiiiv/mew-cli@latest [옵션]

  --workspace <폴더>    열 작업 폴더 (기본: 현재 폴더)
  --data-dir <폴더>     계정·대화·기기 등록 저장 위치
  --cache-dir <폴더>    실행 패키지 캐시 위치
  --port <번호>        로컬 포트 (기본: 설정값 또는 5000, 0: 자동 선택)
  --owner-email <메일>  첫 owner 계정 이메일
  --no-open            브라우저 자동 열기 생략
  -h, --help           사용법
  -v, --version        버전

Node.js 24가 필요합니다. Linux glibc 2.35+, macOS 15+, Windows 10 1809+/11을 지원합니다.
Ctrl+C로 종료하고 같은 명령을 다시 실행하면 최신 릴리스를 사용합니다.
기존 clone의 .data를 쓰려면 --data-dir <기존 설치 경로>/.data를 지정하세요.`

try {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) console.log(help)
  else if (options.version) console.log(version)
  else process.exitCode = await launch({ prepare: prepareRuntime, options, version, target: runtimeTarget() })
} catch (error) {
  console.error(`[mew] ${error.message}`)
  process.exitCode = 1
}
