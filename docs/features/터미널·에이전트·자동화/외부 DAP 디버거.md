---
id: "mew-debugger"
parent: "mew-agents"
title: "외부 DAP 디버거"
status: "implemented"
created: "2026-10-07"
updated: "2026-10-08"
files: ["src/components/debugger-panel.tsx", "src/components/debugger-source-field.tsx", "src/components/debugger-settings.tsx", "src/components/debugger-controls.tsx", "src/components/debugger-helpers.ts", "server/debugger.ts", "server/debugger-dap.ts", "server/debugger-routes.ts", "server/debugger-commands.ts", "server/debugger-profiles.ts", "server/debugger-browser.ts", "server/debugger-mcp.ts", "server/debugger-mcp-stdio.ts", "server/agentWs.ts", "src/utils/debugger-editor.ts", "src/components/debugger-variable.tsx", "src/components/debugger-inspector.tsx", "src/components/debugger-browser.tsx", "src/components/debugger-artifacts.tsx"]
commits: []
description: "외부 DAP 디버거의 설정·프로필·복합 세션, 실행 상태와 접는 도구 영역·컴팩트 소스 파일 선택 목록, 에디터 중단점, 단계 실행·변수·메모리·중단 기록과 Chromium 분석·파일 가져오기·선택적 에이전트 MCP 연결의 사용법·지원 조건·검증 범위를 정의한다. Zed·DAP 조사 당시 계획과 현재 구현, 외부 엔진·협업·Wasm 등 남은 범위를 구분한다."
---

## 요구사항

[디버거 만들기](../../tasks/디버거%20만들기.md)의 브레이크포인트, 변수 변화 우선 표시, 변수 고정 요구를 외부 Debug Adapter Protocol(DAP) 어댑터로 제공한다. mew에는 디버거 엔진이나 언어 런타임을 번들하지 않는다.

### 설정과 설치

- **설정 → 디버거**에서 어댑터, 서버 실행 파일, 인수(JSON 문자열 배열), stdio/TCP, TCP 포트, launch/attach, 실행 설정(JSON 객체)을 관리한다. 저장·연결 테스트·디버거 열기를 제공한다. 설정과 브레이크포인트·고정 표현식은 계정과 현재 프로젝트 루트별로 저장한다.
- js-debug(JavaScript/TypeScript/Node.js), debugpy(Python), LLDB DAP와 CodeLLDB(C/C++/Rust), Delve(Go), 사용자 지정 DAP의 프리셋을 제공한다. 실제 지원 언어·실행 설정은 해당 어댑터의 계약을 따른다.
- **js-debug 설치**는 Microsoft 공식 standalone DAP 릴리스 `1.140.0`을 사용한다. 버튼을 누를 때만 내려받고 SHA-256·크기·압축 경로·파일 종류를 검사한 뒤 데이터 폴더의 `debuggers/js-debug-1.140.0/`에 배치한다. VS Code/VSIX나 IDE를 설치하지 않는다. 설치 완료 시 서버의 Node 실행 경로와 어댑터 경로를 해당 계정 설정에 반영한다. 설치에는 서버의 HTTPS 접근과 `tar`가 필요하다. standalone 번들은 CommonJS이므로 어댑터 루트에 `package.json`의 `type: commonjs`를 명시해 상위 mew 프로젝트의 `type: module`을 상속하지 않게 한다. 기존 package.json의 다른 메타데이터는 유지한다. 기존 설치도 설치 버튼 또는 관리형 어댑터 세션 시작 시 다시 다운로드하지 않고 모듈 경계를 보정한다.
- 나머지 어댑터는 서버에 별도로 설치하고 경로·인수를 설정한다. CodeLLDB는 `codelldb --port 56789`, Delve는 `dlv dap --listen=127.0.0.1:56789`, debugpy는 `python3 -m debugpy.adapter`, LLDB DAP는 `lldb-dap` 프리셋을 제공한다. 다른 TCP 디버거와 함께 쓸 때 포트를 변경한다.
- TCP는 `127.0.0.1`에만 연결한다. 실행 파일을 비우면 이미 실행 중인 loopback DAP 서버에 연결한다. 관리형 js-debug는 `0` 포트로 시작하고 stdout에서 실제 포트를 감지한다. 파일 경로는 **mew 서버** 기준이며 소스와 디버깅 대상도 서버에 있어야 한다.

Node.js 실행 설정 예:

```json
{
  "type": "pwa-node",
  "program": "/absolute/project/main.js",
  "cwd": "/absolute/project",
  "console": "internalConsole",
  "args": []
}
```

`launch`는 새 프로그램을 실행하고, `attach`는 이미 실행 중인 대상에 연결한다. attach의 `port`·`processId` 등은 실행 설정에 넣는다. TCP 연결 포트 필드는 **어댑터** 포트이며 디버깅 대상의 포트와 다르다. 실행 설정에서 `${workspaceFolder}`, `${workspaceFolderBasename}`, `${env:NAME}`을 서버 기준으로 치환한다. 저장 파일에는 환경 변수의 치환 결과를 쓰지 않는다. `${command:…}`, `${input:…}` 등 실행형 변수와 자동 build/task는 지원하지 않는다.

### 브라우저 연결과 어댑터 포트 오류

이미 열린 Chromium 탭은 js-debug의 `pwa-chrome` 실행 설정과 `attach`로 연결한다. 실행 설정의 `address`·`port`는 브라우저 CDP 주소·포트, `urlFilter`는 대상 앱 주소, `webRoot`는 앱 소스 루트다. 브라우저 포트는 재시작 시 달라질 수 있다. Vite 개발 서버는 TypeScript 소스 맵을 제공하며, 소스 맵 없는 빌드본에서는 원본 줄 브레이크포인트가 제한된다.

‘어댑터 TCP 포트가 감지되지 않았습니다’는 브라우저에 연결하기 전 어댑터 시작 단계의 오류다. js-debug 실행 파일이 `node`, 인수가 `[]`, TCP 포트가 `0`이면 어댑터 대신 Node 입력 대기 상태가 되어 이 오류가 발생한다. **현재 프로젝트의 설정 → 디버거 → js-debug 설치**를 다시 누르면 설치된 파일을 재사용하면서 서버 Node 경로와 `[dapDebugServer.js 절대 경로, "0", "127.0.0.1"]` 인수·TCP 포트 `0`을 채운다. 그 뒤 실행 방식은 **연결(attach)**, 실행 설정은 `pwa-chrome`으로 확인하고 저장한다. 설치 여부 표시는 서버 공통 파일 존재 여부이며, 계정·프로젝트별 실행 인수가 설정되었다는 뜻은 아니다. 어댑터 선택을 다시 바꾸면 기본 인수로 초기화될 수 있으므로 설치 버튼으로 다시 적용한다. 시스템 Chrome 설치가 없고 Mew가 Playwright Chromium을 사용하는 환경에서는 실행 설정의 `runtimeExecutable`에 실제 Chromium 실행 파일 절대 경로도 지정한다. 그렇지 않으면 어댑터 초기 부팅에서 브라우저 설치를 찾지 못해 연결이 종료될 수 있다.

외부에서 저장 설정을 보정한 경우 열려 있는 설정 화면은 이전 값을 가지고 있을 수 있다. 설정을 닫고 다시 열어 읽은 뒤 시작한다. 실제 환경 경로·브라우저 포트를 문서의 고정값으로 사용하지 않는다.

### 패널과 세션

- 독의 디버거 아이콘이나 설정의 **디버거 열기**로 별도 패널을 연다. 기존 독 배치·모바일 전면 스택·계정별 프로젝트 UI 복원을 따른다. 설정과 패널 컴포넌트는 지연 로드하며 닫힌 패널은 상태를 폴링하지 않는다. 코드 에디터의 거터·실행 위치 표시는 별도로 현재 루트·계정별 폴링을 공유하며 마지막 에디터가 닫히면 취소한다.
- 시작·계속 실행·일시정지·다음 줄·함수 안으로·함수 밖으로·연결 종료를 제공한다. 기본 시작의 중복 실행은 거부하고, **추가 세션 시작** 또는 **복합 실행**으로 계정·프로젝트당 최대 8개 독립 세션을 허용한다. 세션·자식 연결·스레드 선택을 제공하고 각각의 capability와 참조를 분리한다. 어느 세션이든 실행 중이면 연결·실행 프로필 설정 변경을 거부하며 중단점·감시 등 동적 설정은 변경할 수 있다. 설치·설정 조회·패널 열기만으로 어댑터를 실행하지 않는다. **시작** 또는 **연결 테스트** 때만 외부 프로세스를 만든다. 테스트는 initialize 후 연결과 관리 프로세스를 종료한다.
- 브레이크포인트는 패널에서 소스 경로와 1부터 시작하는 줄 번호로 추가·비활성화·삭제한다. 소스 파일 입력칸은 파일명·경로 일부 또는 `@검색어`를 입력하면 기존 파일명 검색 API의 현재 프로젝트 루트 파일 후보를 보여준다. 후보 선택은 상대 경로만 입력하며 중단점을 자동 추가하지 않는다. 경로 직접 입력도 유지한다. 공용 editable `SelectField`를 사용해 방향키·Enter 선택, 클릭·터치, Esc·뒤로가기·바깥 누름 닫기와 portal 목록의 화면 경계를 따른다. 검색 요청은 180ms 지연하고 입력·프로젝트 변경 시 이전 요청을 취소하며 준비·검색 결과 없음·오류를 목록에 표시한다. 별도 Documents 범위의 결과는 제외한다. 상대 소스 경로는 프로젝트 루트 기준이다. 어댑터의 검증 여부와 메시지를 표시하고 실행 중 변경도 전송한다. 코드 에디터의 중단점 거터 클릭과 `F9`도 같은 저장 설정을 사용한다. 편집으로 줄·열이 이동하면 해당 중단점과 의존 중단점 키를 갱신한다. 현재 중단 프레임의 실행 줄을 강조하며, `Shift+F9`는 커서 위치까지 실행한다. 호버 평가는 해당 파일의 현재 최상위 프레임과 `supportsEvaluateForHovers`가 있을 때 단순 식별자에만 수행한다. 원본 편집에 따른 실행 코드 교체는 mew가 수행하지 않는다.
- 중단 이벤트에서 호출 스택을 조회한다. 스택 행을 선택하면 해당 프레임의 변수를 읽고 프로젝트 안의 소스 파일과 줄을 에디터에서 연다. 프로젝트 밖 소스는 현재 에디터에서 열지 않는다.
- 비싼 scope를 제외한 기본 변수를 읽고 객체를 펼칠 때만 자식을 읽는다. 같은 연결·스레드·소스·프레임 이름·scope·변수 이름으로 이전 중단 값을 비교한다. 변경된 기본 변수를 먼저 배치하고 표시한다. 최초 조회는 변경으로 표시하지 않는다. 동일 중단 시점의 재조회에서도 변경 표시를 유지한다.
- 변수의 핀 버튼이나 표현식 입력으로 감시 대상을 고정한다. 매 중단 시 현재 프레임에서 evaluate하고 값 변화도 표시한다. 표현식 오류는 해당 감시 값에 표시한다. 고정 목록은 세션 종료·문서 수정 뒤에도 유지한다.
- 패널 닫기는 세션을 종료하지 않는다. **연결 종료**는 launch 대상 종료를 요청하고 attach 대상은 유지하도록 요청한다. mew가 시작한 어댑터와 터미널 자식 프로세스는 연결 종료·오류·권한 회수 시 정리한다. 서버 프로세스가 재시작되면 DAP 세션을 복원하지 않는다.

### 패널의 표시와 조작

- 헤더에 현재 실행 상태를 표시하고 바로 아래 실행 도구 줄을 본문 스크롤과 분리한다. 주 버튼은 준비 상태의 **시작**, 중단 상태의 **계속**, 실행 상태의 **일시정지**로 바뀐다. 연결 종료·단계 실행·재시작은 기존 capability와 실행 상태 검사를 따른다. 패널 닫기는 공용 `PanelCloseButton`을 사용한다.
- **세션·실행 옵션**에서 프로필·복합 실행·독립 세션·대상·스레드·단계 단위·중단 기록·역방향 제어와 추가 세션을 선택한다. 기본 화면에서는 이 영역을 접어 둔다. 과거 기록을 선택하면 헤더에 과거 기록 상태를 표시하고 실행 제어를 비활성화한다.
- 실행 전에는 소스 중단점 설정을 먼저 배치하고, 중단 중과 과거 기록에서는 호출 스택·변수 값을 먼저 배치한다. 함수·예외·데이터·명령어 중단점은 소스 중단점 안의 **고급 중단점**에서 관리한다. 기본 목록·설정·콘솔·메모리·브라우저·분석 파일의 접기 영역은 같은 헤더와 펼침 표시를 사용하며 키보드로도 조작할 수 있다.
- 목록 제목에 항목 수를 표시한다. 소스 중단점은 파일명과 줄/열을 나누고 전체 경로는 툴팁과 접근성 이름으로 제공한다. 스택은 선택 프레임, 변수는 실제 변경 값과 자료형 색상을 구분하며 고정한 값은 중복 고정 버튼을 비활성화한다. 빈 목록·조회 중·실패·저장 완료를 표시하고 오류·주 버튼은 양 테마의 의미 색상 토큰을 따른다.
- 소스 파일·테스트 파일 선택 목록의 후보 행은 데스크톱 28px, 터치 32px 높이와 12px 글자를 사용한다. 긴 경로는 한 줄 말줄임으로 표시하고 전체 경로는 접근성 이름과 선택 값에 유지한다. 목록은 공용 `SelectField`의 화면 경계·내부 스크롤·키보드 선택·닫기 동작을 따른다.
- 좁은 패널에서도 실행 버튼·입력·긴 경로·값을 패널 안에 배치하고 분석 표·메모리 덤프는 해당 영역에서 스크롤한다. 설정은 어댑터·실행 JSON·프로필·복합 실행으로 묶으며 JSON 입력과 기존 저장·테스트·설치 동작을 유지한다.

### 구현과 경계

- HTTP `/api/debugger` 아래 설정 조회·저장, 설치, 연결 테스트, 세션 시작·종료, 허용된 DAP 명령을 제공한다. 현재 프로젝트 헤더를 검사하며 명령·종료는 세션 ID도 비교한다. 계정·프로젝트별 설정 파일은 데이터 폴더에 원자적으로 저장한다. 어댑터가 TCP 포트를 알리기 전에 종료되면 stderr가 닫힐 때까지 기다려 종료 코드·시그널과 최근 오류 줄을 반환한다. 긴 번들 소스 줄은 오류 요약에서 제외하고 요약은 2,000자로 제한한다.
- DAP 헤더의 바이트 길이와 분할된 UTF-8 프레임을 처리하고 요청 시간 제한·연결 종료 거부를 제공한다. js-debug의 `startDebugging` 역방향 요청은 같은 어댑터에 별도 자식 연결을 만들어 처리한다. `runInTerminal`은 셸 문자열 해석 없이 argv로 실행하며 관리 프로세스로 추적한다.
- owner·manager, 터미널 기능, 해당 프로젝트 전체 파일 읽기·수정 권한이 필요하다. 실행·설치는 서버 OS 권한으로 동작한다. 접속 중 정책 변경과 5초 주기 검사에서 실행 중인 세션을 재검증한다. 자세한 권한 경계는 [계정별 기능·파일 권한](../../development/access-control.md)을 따른다.
- 출력은 최근 64,000자로 제한한다. DAP 메시지는 8MiB, 세션의 연결 수는 16개, 보관 세션은 서버 전체 64개, 브레이크포인트는 설정당 200개, 고정 표현식은 64개로 제한한다. 스택은 40개씩 최대 200개, 각 변수 조회는 최대 200개로 제한한다. 객체의 추가 페이지는 화면에서 최대 2,000개, 연결의 변수 참조는 5,000개로 제한한다. 메모리 요청은 4,096바이트, 디스어셈블은 256개 명령어, 가상 소스는 512KB 이하이다. 임의 DAP 요청과 자동 언어 런타임 설치는 제공하지 않는다.

### 고급 기능의 현재 지원 범위 — 2026-10-07 구현

| 범위 | 제공하는 기능 | 조건과 한계 |
| --- | --- | --- |
| 공통 DAP·에디터 | 소스 검색, 거터·실행 줄, 줄/열 중단점, 임시 중단점으로 지정 위치까지 실행, 중단점 활성/삭제/의존 관계 | 의존 중단점은 실제 `stopped.hitBreakpointIds`로만 활성화한다. ID가 없는 어댑터에서 줄 번호로 발동을 추측하지 않는다. 검증 여부·실제 위치·오류 메시지를 보존한다. |
| 조건부 중단점 | 조건·횟수·로그, 함수, 예외 필터, 데이터 read/write/readWrite, 명령어 주소 | 각 capability가 필요하다. 데이터 중단점은 변수의 추가 버튼으로 `dataBreakpointInfo`를 조회한 뒤 지원하는 접근 방식을 선택한다. 일시적인 dataId는 세션·연결에 묶고 디스크에 저장하지 않는다. 함수·데이터·명령어 중단점의 어댑터 검증 결과도 표시한다. CPU 하드웨어 레지스터 직접 제어는 제공하지 않는다. |
| 실행 제어 | 재시작, 프레임 재시작, 호출 대상 선택, 실행 위치 이동, 이전 단계·역방향 계속, line/statement/instruction 단위, 스레드별 실행 | 해당 capability가 있을 때만 표시한다. 역방향 실행은 어댑터와 record/replay 엔진이 준비된 경우에만 가능하며 mew가 실행을 녹화하지 않는다. 프레임 재시작 금지·스택 label 프레임도 반영한다. |
| 값 탐색·수정 | scope·레지스터 범위, expensive scope 수동 조회, 자식·배열 페이지·속성/요소 필터, 16진수, 변수/표현식 수정, 숫자 배열 표·차트 | `setVariable`/`setExpression`·표시 형식은 capability에 따라 제공한다. readOnly/constant를 반영한다. 차트는 실제 읽은 유한 숫자 값 최대 200개이며 이미지·텐서 전용 변환기는 없다. |
| 디버그 콘솔 | REPL 평가, 객체 결과 펼치기·고정, 자동완성, 예외 상세 | 중단된 현재 프레임에서 평가한다. REPL 평가·값 수정은 대상 상태를 바꿀 수 있다. 객체 참조는 재개·중단/연결 변경·invalidated·메모리 변경에서 폐기한다. |
| 메모리·네이티브 조사 | memoryReference 읽기, 주소/hex/ASCII·읽을 수 없는 범위, 직접 hex 쓰기·쓴 바이트, 범위 binary 내보내기, 디스어셈블·명령어 중단점 | DAP가 반환한 memoryReference를 사용하며 값 문자열을 주소로 추측하지 않는다. 전체 프로세스/힙 덤프 생성은 어댑터 전용 명령·도구가 필요하다. |
| 부가 상태 | 모듈·심볼 상태, 로드된 소스·sourceReference 가상 소스, 진행 상태·취소 | capability가 필요하다. 취소는 어댑터에 요청한 결과이며 대상 종료로 간주하지 않는다. 실제로 받은 현재 연결의 참조만 조회할 수 있다. |
| 기록·공유 자료 | 중단별 스택·읽었던 변수·감시 값 비교, JSON 내보내기·가져오기 | 메모리에 최대 32회·2MB의 읽은 scalar 기록을 보관한다. 과거 기록에서는 실행 제어·변수 평가를 하지 않는다. 당시 펼치지 않은 자식이나 실행 환경을 복원하지 않는다. 기록은 서버 재시작 뒤 복원되지 않는다. |
| 프로필·다중 세션 | 명명된 프로필, JSONC launch.json 가져오기, 복합 실행, 최대 8개 독립 세션, 자식 연결·스레드 전환 | 현재 설정한 하나의 어댑터에 맞는 프로필을 사용한다. 복합 실행은 순서대로 시작하고 일부 실패 시 이번에 만든 세션을 정리한다. 기존 다른 세션은 유지하며 종료는 선택한 세션별이다. `preLaunchTask`·`postDebugTask`·compound `stopAll`은 가져오지 않는다. |
| 테스트 진입점 | Node.js test, Vitest, pytest, Go test의 파일·선택 이름 실행 프로필 생성 | 패널의 **테스트 디버깅**에서 실행기·파일·이름을 선택해 프로필을 만들고 시작한다. 런타임·러너·어댑터는 미리 준비해야 한다. Vitest는 로컬 설치 경로·병렬/timeout 조정·자식 연결 옵션을 사용한다. 테스트 자동 발견·실패 결과 수집은 아직 없다. |
| 프로그램 입력 | `runInTerminal`로 mew가 시작한 대상의 입력·EOF·출력 | 실제 추적 중인 자식 stdin pipe만 사용한다. 대화형 PTY, 터미널 화면, 외부 PID로의 입력은 지원하지 않는다. js-debug에서는 `console: "integratedTerminal"`로 요청한다. |

각 기능의 지원 여부는 선택한 **연결**의 initialize/capabilities 응답을 기준으로 한다. 다른 자식 연결의 capability를 합치지 않는다. 제어·조회에는 세션 ID, 연결 ID, 중단 revision을 대조하고, 재개나 스레드 전환 전에 얻은 프레임·변수·실행 대상 ID를 재사용하지 않는다. 실행 설정과 프로필 JSON은 설정에서 편집하며 프로필은 최대 32개, 전체 설정은 1MB 이하이다.

### Chromium 분석과 외부 분석 파일

디버거 패널의 **브라우저 분석**을 펼치고 본인 계정에서 이미 연 Mew 서버 브라우저 탭을 선택해 연결한다. 이 동작만으로 새 브라우저나 대상 프로그램을 실행하지 않는다. owner·manager의 디버거 권한에 **내부 브라우저** 권한도 필요하며 OAuth 로그인 전용 탭·다른 계정·개인 Chrome은 연결 대상에서 제외한다.

- CDP로 DOM 선택자의 subtree/attribute/node 제거, 이벤트 리스너 이름, XHR URL 포함 문자열 중단점을 설정·제거한다. 중단 시 프레임 선택·단계 실행·콘솔 평가·실제 script source 읽기를 제공한다. 탐색으로 문서가 바뀌면 DOM node 중단점은 폐기하고 새 DOM에서 다시 설정한다.
- CPU 프로파일, 힙 할당 샘플, 정밀 실행 커버리지 수집을 시작·종료하고 힙 스냅샷을 생성해 파일로 내려받는다. CPU·할당·커버리지 수집은 최대 60초이며 자동 종료한 결과도 내려받을 수 있다. 최근 3개·합계 8MB 이하 결과를 연결 메모리에 보관한다. 분석 연결 종료·탭 닫기·권한 회수는 수집·설정한 중단점·CDP 연결을 정리하며 브라우저 탭 자체의 소유권을 가져오지 않는다.
- 이 CDP 화면은 DAP 세션과 별도 조사 상태이다. 같은 탭에 js-debug와 함께 연결한 경우의 중단 동기화·원본 소스 맵·교차 제어는 아직 검증하지 않았으며 공유된 통합 세션으로 표시하지 않는다. 힙 스냅샷 수집·파일은 8MB 이하이며 retained size/dominator 분석·flame graph·Playwright trace.zip 재생은 아직 제공하지 않는다.
- **분석 파일**은 브라우저에서 사용자가 선택한 최대 8MB 파일을 읽는다. `.cpuprofile`의 실제 sample self time, `.heapprofile`의 할당 self size, `.heapsnapshot`의 객체별 self size 합계, V8 coverage의 함수 실행 횟수, OTLP JSON의 span 기간·trace/parent 관계, sanitizer 텍스트의 오류·스택 위치, mew 중단 기록 JSON을 제한된 표와 값 막대로 표시한다. 검색·추가 행·원본 내보내기·프로젝트에서 열 수 있는 소스 경로 이동을 제공하고 파일을 서버에 자동 업로드하거나 문서에 저장하지 않는다.
- CPU/힙 표는 누적/retained size·전체 호출 tree를 계산하지 않는다. 커버리지는 소스 맵 검증이나 편집기 줄 표시를 제공하지 않는다. OTLP는 가져온 파일의 분석이며 collector/서비스 계측·실시간 조회를 생성하지 않는다. sanitizer 보고서를 읽는 기능은 sanitizer 빌드·오류 탐지를 대신하지 않는다.

실제 연결 계약은 [CDP Profiler](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/), [HeapProfiler](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/), [DOMDebugger](https://chromedevtools.github.io/devtools-protocol/tot/DOMDebugger/)를 따른다. 정밀 커버리지나 메모리 수집의 실행 영향은 선택한 엔진의 계약을 따른다.

### 에이전트 디버거 연결

**설정 → 디버거 → 프로젝트 에이전트의 디버거 사용 허용**을 켜고 새 일반 에이전트 탭을 시작하면 `mew-debugger` MCP를 ACP에 전달한다. 기본값은 꺼짐이며 켜기만으로 디버깅 대상을 시작하거나 어댑터를 설치하지 않는다. 이미 실행 중인 독립 감독의 MCP 목록은 교체하지 않으므로 기존 탭 재접속만으로는 추가되지 않는다. 공급자 MCP 설정 파일을 수정하지 않으며 뮤캣의 기존 MCP 목록은 유지한다. 예약·단발 runner의 연결은 이번 범위에 포함하지 않는다.

- `debugger_state`: 계정·프로젝트의 세션 목록과 선택한 세션의 현재 capability·연결·중단 revision·스택 및 이미 읽은 기록을 조회한다. 표현식을 자동 평가하지 않는다.
- `debugger_command`: `sessionId`와 직전에 조회한 `arguments.connectionId`·`arguments.stopRevision`으로 허용된 디버거 명령을 실행한다. 변수/스택 참조·명령별 capability·중단 상태 검사와 크기 한도는 HTTP 경로와 동일하다. 표현식 평가·값/메모리 쓰기·실행 제어는 대상의 상태를 바꿀 수 있으므로 에이전트도 기존 작업·실행 제한을 따른다. 임의 DAP·CDP 요청은 제공하지 않는다.
- `debugger_start` / `debugger_stop`: 저장된 기본 설정 또는 이름으로 지정한 프로필을 시작하고 정확한 세션을 종료한다. 실행 설정 작성·도구 설치·복합 실행은 MCP 도구로 노출하지 않는다. launch/attach 종료 계약은 패널과 같다.

MCP는 계정·프로젝트별 Unix 소켓(파일 `0600`, 디렉터리 `0700`)으로 서버에 중계한다. owner·manager, `agent`·`terminal`, 프로젝트 전체 파일 수정 권한과 공유 옵션을 매 호출 및 정책 변경·5초 주기로 확인한다. 공유 해제·권한 회수·프로젝트 변경에서 중계 연결을 닫는다. 응답은 1.5MB 이하, 상태 조회 출력은 최근 8,000자, 기록은 최근 8개·각 변수 100개로 제한한다. 에이전트 연결 자체와 세션 수명은 [에이전트 세션 계약](../../development/agent-sessions.md#에이전트-디버거-mcp)이 소유한다.

### 추가로 남은 범위

하드웨어 중단점 레지스터·JTAG·커널 원격 디버깅·전체 프로세스 core dump·코드 injection·Wasm/DWARF 엔진·정적 분석 엔진은 mew 자체 기능으로 구현하지 않았다. 준비된 외부 DAP/네이티브 REPL의 기능은 현재 경로로 사용할 수 있지만 장비·OS·엔진 설치와 언어별 실제 검증이 필요하다. 협업의 세션 공유·제어권 이전, 테스트 목록/실패 탐지, E2E trace viewer, telemetry 수집 API는 별도 구현 범위다. 아래 조사 기록의 제안과 현재 지원을 구분한다.

### 확인 기준과 검증

- `server/debugger-install.test.ts`: `type: module` 프로젝트 내부 설치에서 발생하는 CommonJS 실행 실패를 재현하고 설치 재사용·메타데이터 보존·세션 시작 시 기존 설치 보정을 검증한다.
- `server/debugger.test.ts`: UTF-8 분할·다중 메시지·요청 시간 초과·과대 헤더 거부, 초기화/구성 순서, 스택·변수·스텝·감시, 브레이크포인트 삭제와 계정·프로젝트별 저장과 조기 종료 시 코드·stderr 진단을 검증한다.
- `server/debugger-routes.test.ts`: 역할·터미널·전체 파일 권한, 프로젝트/세션 불일치, 계정·프로젝트 분리, 잘못된 설정 보존·실행 중 모드 변경 거부·권한 회수 시 세션 정리를 검증한다.
- `server/debugger-ui.test.ts`: 앱 번들을 만들지 않는 격리 브라우저 픽스처로 데스크톱 다크/320px 모바일 라이트의 설정 오류·연결 테스트·소스 파일 검색과 키보드/터치 선택·프로젝트 밖 결과 제외·빈 결과/오류·Esc 닫기·목록 화면 경계·패널 시작·스텝·변경 우선 표시·핀·종료를 확인한다.
- 2026-10-07: 임시 데이터 폴더에 공식 js-debug standalone을 설치하고 실제 Node.js 프로그램의 자식 DAP 세션·브레이크포인트·스택·변수 평가·계속 실행·종료를 검증했다. 실어댑터 테스트는 `MEW_TEST_JS_DEBUG`에 임시 설치의 `js-debug/src/dapDebugServer.js` 경로를 지정하면 실행한다.
- `server/debugger-features.test.ts`: 조건·발동 중단점, 선택한 연결의 capability, 참조 수명·늦은 응답 거부, 스레드·호출 대상, 큰 배열, 값/메모리 수정, 가상 소스·모듈·예외·자동완성, 읽었던 값 기록을 모의 고급 어댑터로 검증한다.
- `server/debugger-profiles.test.ts`: JSONC·변수 치환, 자동 태스크/실행 변수 거부, 테스트 선택자, 복합 실행·독립 세션·공통 동적 설정을 검증한다.
- `server/debugger-advanced-ui.test.ts`: 실제 라우터·모의 DAP와 데스크톱/320px 모바일에서 에디터 중단점 이동·의존 키·F9·실행 줄, 배열 페이지/차트, 데이터 중단점, 값·메모리 쓰기, 역방향 버튼·과거 기록과 파일 가져오기를 검증한다.
- `server/debugger-browser.test.ts`: 격리 Chromium에서 실제 CPU/힙 할당/커버리지·힙 스냅샷 수집, DOM 중단·호출 스택·객체 변수·스크립트 소스·참조 만료, 이벤트/XHR 중단점 생성·제거와 권한 회수 정리를 검증한다.
- `shared/debugger-analysis.test.ts`: 프로파일 실제 sample/self size, heap snapshot의 self size, OTLP 시간·부모 관계, 커버리지 count, sanitizer 위치·크기/형식 거부를 검증한다.
- 2026-10-07 확장: 기존 내부 설치의 실제 js-debug에서 자식 연결·중단점·스택·감시·계속·일시정지·종료와 `runInTerminal` stdin 입력/EOF를 확인했다. `npx tsc -b`와 디버거 관련 scoped oxlint를 실행했다. 최종 전체 타입 검사는 병행 작업 파일의 타입 오류로 통과하지 못했다. 같은 프로젝트 옵션으로 디버거 서버·UI·에디터 파일을 선택한 별도 타입 검사와 scoped lint는 통과했다. 앱 build·배포·서버 재시작은 수행하지 않았다.
- `server/debugger-mcp.test.ts`: 공유 기본 비활성화, 계정별 소켓 권한·MCP 핸드셰이크, 정확한 세션·연결·중단 revision, 권한 회수 시 연결 거부를 검증한다. 기존 `agentWs.test.ts`·`agentHost.test.ts`·`agentAcp.test.ts` 40개 회귀 검사도 통과했다.
- 2026-10-07 UI 정리: 기존 설정·패널 UI 검사와 고급 UI 검사 2개를 통과했다. 320px 모바일 라이트·768/1366px 데스크톱과 고급 기능의 모바일 다크를 확인하고 파일 검색·핀·값 변경·메모리·기록 선택·배열·소스 중단점 경로를 유지했다. `npx tsc -b`, 변경 범위 oxlint, description 검사, 변경 diff 공백 검사를 통과했다. Impeccable 기계 검사 결과는 지적 없음이었다. 빌드·서버 재시작·커밋은 수행하지 않았다.
- Python·LLDB·CodeLLDB·Go는 연결 프리셋과 공통 DAP 경로를 제공하며 각 실제 언어 환경의 실행 검증은 아직 수행하지 않았다.

공식 계약: [DAP](https://microsoft.github.io/debug-adapter-protocol/overview.html), [js-debug](https://github.com/microsoft/vscode-js-debug), [debugpy](https://github.com/microsoft/debugpy), [CodeLLDB](https://github.com/vadimcn/codelldb), [Delve DAP](https://github.com/go-delve/delve/blob/master/Documentation/usage/dlv_dap.md).

### 2026-10-07 설치 위치에 따른 연결 실패 수정

최초 실제 어댑터 검증은 임시 폴더에서 실행해 mew 내부 `.data` 설치가 상위 ES 모듈 설정을 상속하는 조건을 놓쳤다. 내부 설치의 조기 종료를 재현한 뒤 CommonJS 패키지 경계를 추가하고 기존 설치를 보정했다. 실제 내부 설치 경로로 Node.js 브레이크포인트·스택·변수 평가·계속 실행·일시정지·종료를 다시 검증했다. 회귀 테스트로 같은 설치 조건을 유지한다.

### 디버깅 연습: 학생 성적 집계

[examples/debugger/grades.cjs](../../../examples/debugger/grades.cjs)는 배열·객체·함수·반복문·조건문만 사용하는 1~2학년 수준의 Node.js 프로그램이다. 학생 세 명의 평균과 80점 이상 통과 여부를 집계한다. 외부 패키지·입력·파일 쓰기가 없으며 계산 후 종료한다. 기본 모드에는 연습용 평균 계산 오류가 하나 들어 있다.

설정에서 js-debug와 launch를 선택하고 실행 설정에 아래 JSON을 넣어 저장한다. 아래 절대 경로는 현재 mew 저장소 위치이며 다른 서버에서는 실제 예제 경로로 바꾼다. 어댑터 인수가 아닌 **실행 설정**의 `args`가 예제 프로그램의 인수다.

```json
{
  "type": "pwa-node",
  "program": "/home/saens/dev/liiiiv/mew/examples/debugger/grades.cjs",
  "cwd": "/home/saens/dev/liiiiv/mew",
  "console": "internalConsole",
  "args": []
}
```

1. 디버거 패널에서 소스 `examples/debugger/grades.cjs`, 줄 **15**를 브레이크포인트로 추가한 뒤 시작한다. `index`, `score`, `total`을 관찰·고정하고 계속 실행하면 점수 합산 과정이 반복된다. 첫 두 중단에서 `score`는 85→90, `total`은 0→85로 바뀐다. 브레이크포인트는 해당 줄 실행 **전**에 멈춘다.
2. 줄 **28**에서 시작하고 함수 안으로를 누르면 `analyzeStudents → calculateAverage` 호출과 스택·지역 변수의 차이를 확인할 수 있다. 줄 **19**에서는 `total`, `count`를 비교해 평균이 예상보다 낮은 이유를 찾는다.
3. 세션을 종료하고 실행 설정의 `args`를 `["--fixed"]`로 바꾸면 정상 모드와 비교할 수 있다. 정상 평균은 민수 90, 지연 70, 서준 95이고 통과 인원은 2명이다. 기본 오류 모드는 평균 67.50, 52.50, 71.25와 통과 인원 0명을 출력한다. 프로그램의 잘못된 나누는 수를 직접 고쳐 확인해도 된다.

터미널에서도 `node examples/debugger/grades.cjs`와 `node examples/debugger/grades.cjs --fixed`로 결과를 비교한다. 2026-10-07에 두 모드 실행·출력을 확인하고 실제 js-debug로 15줄 중단, 스택 조회와 두 반복의 `total`·`score` 변화를 검증했다. 실행할 파일만 추가했으므로 앱 빌드는 필요하지 않다.


## 확장 조사와 구현 후보 — 2026-10-07 (조사 당시 계획)

이 절은 구현 전 사용자 요청에 따른 조사와 제안 기록이다. 현재 구현 여부는 위의 **고급 기능의 현재 지원 범위**·**추가로 남은 범위**가 기준이며, 아래의 ‘미구현’·‘추가 작업’은 조사 당시 상태다. 앞 절의 현재 기능·실제 검증과 구분하며, 프론트매터 `implemented`는 현재 제공 범위에만 적용한다. 이번 작업에서는 코드·권한·설치 방식·네트워크 경계를 변경하지 않았다. 아래의 추가 기능은 구현·실어댑터 검증 전까지 지원으로 표시하지 않는다.

### 조사 범위와 판단 기준

2026-10-07에 Zed 공식 문서, 공개 저장소의 디버거 UI·프로젝트 세션·DAP 명령·메모리 처리와 Microsoft DAP 스키마를 확인했다. Zed 코드는 main의 [72d073d6423b0bf7e04aa87567a308d19617b7f2](https://github.com/zed-industries/zed/commit/72d073d6423b0bf7e04aa87567a308d19617b7f2), DAP는 [c10f18c3332ca04cece1081aa00232a9d882438d의 스키마](https://github.com/microsoft/debug-adapter-protocol/blob/c10f18c3332ca04cece1081aa00232a9d882438d/debugAdapterProtocol.json)를 기준으로 고정했다. main 코드 확인은 Zed 정식 배포판의 탑재 여부나 모든 언어에서의 동작 검증을 뜻하지 않는다. 외부 어댑터를 새로 설치하거나 대상 프로그램·Zed를 실행하지 않았다.

추가 가능 여부는 다음 세 범주로 분류한다. DAP 명령을 전달하는 것만으로 사용 가능한 기능이 되지는 않으며, 상태·설정·UI·어댑터별 검증까지 필요하다.

- **공통 확장**: 현재 DAP 연결과 기본 명령을 재사용해 mew 안에서 구현 가능한 기능.
- **어댑터 조건부**: 표준 DAP 기능이 있으나 연결한 어댑터의 capability·대상·OS·빌드 정보에 따라 가능 여부가 달라지는 기능.
- **별도 연동**: DAP 공통 요청만으로 완결되지 않아 런타임 API·디버거 전용 명령·외부 서비스·장비·분석 엔진이 필요한 기능.

### Zed에서 확인한 구현과 참고 지점

| 참고 대상 | 확인한 내용 | mew에 적용할 부분 |
| --- | --- | --- |
| [공식 디버거 문서](https://zed.dev/docs/debugger#breakpoints) | 거터 중단점, 조건·횟수·로그, 예외 중단점, 실행 프로필과 단계 실행 단위 | 패널 입력과 에디터 거터를 같은 중단점 저장소에 연결하고 조건부 옵션을 제공 |
| [변수 목록](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/debugger_ui/src/session/running/variable_list.rs) | capability에 따른 변수 수정·데이터 중단점·메모리 이동 메뉴 | 부모 변수 참조와 선택 프레임을 유지하고 항목별 가능한 작업만 표시 |
| [메모리 UI](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/debugger_ui/src/session/running/memory_view.rs)와 [페이지 처리](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/project/src/debugger/memory.rs) | 메모리 조회·수정·주소 범위 중단점, 읽을 수 없는 영역을 포함한 페이지 관리 | 주소 범위별 지연 로드, 읽기 불가 표시, 변경 후 관련 캐시 무효화 |
| [콘솔](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/debugger_ui/src/session/running/console.rs) | 사용자 표현식 실행·기록, 어댑터 자동완성과 변수 기반 대안 | 현재 출력 영역에 명시적인 REPL 입력과 결과 탐색 추가 |
| [실행 UI](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/debugger_ui/src/session/running.rs)와 [세션](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/project/src/debugger/session.rs) | 스레드 선택·계속 실행, 단계 단위, 재시작, step-back 요청, 임시 중단점으로 지정 위치까지 실행 | 스레드·자식 연결별 상태 분리, capability 검사와 임시 중단점 정리 |
| [스택 목록](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/debugger_ui/src/session/running/stack_frame_list.rs) | 프레임 선택·재시작, 해당 프레임의 가능 여부 검사 | 프레임 재시작을 일반 step-out과 별도 동작으로 제공 |
| [모듈 목록](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/debugger_ui/src/session/running/module_list.rs)·[로드 소스](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/debugger_ui/src/session/running/loaded_source_list.rs)·[DAP 명령](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/project/src/debugger/dap_command.rs) | 별도 정보 패널과 기능별 요청·응답 처리 | 거대한 단일 패널 대신 필요할 때 여는 조회 영역과 명령별 서버 검증 |

조사한 Zed 파일에서 디스어셈블 전용 UI·instruction breakpoint 관리·범용 힙 덤프·커널/JTAG 제어는 확인하지 못했다. 이를 Zed 구현 완료로 간주하지 않는다. 디스어셈블과 instruction breakpoint의 mew 확장 가능성은 DAP·어댑터 계약에서 판단한다.

Zed의 [debugger_ui](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/debugger_ui/Cargo.toml), [dap](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/dap/Cargo.toml), [project](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/project/Cargo.toml)는 `GPL-3.0-or-later`로 명시되어 있다. mew의 MIT 코드에 그대로 복사하는 계획은 두지 않는다. 이번 조사에서는 동작·상태 처리와 공개 프로토콜을 참고해 TypeScript/React에서 별도로 구현하는 방향을 제안하며, 실제 소스 재사용을 선택할 때는 해당 라이선스와 배포 조건을 따로 검토한다.

### 사용자 요청 항목과 추가 가능 범위

| 기능 | 현재 mew | 추가 분류와 구현 방향 |
| --- | --- | --- |
| 소스 단계 실행·step-in/out | 기본 지원 | **공통 확장**: 실행 위치 강조, 바로 소스 열기, 단축키·선택 위치까지 실행 |
| 문장·기계어 단위 실행 | 단위 선택 없음 | **어댑터 조건부**: `granularity`를 지원하는 어댑터에서 statement/line/instruction 선택 |
| 소스 중단점 | 파일·줄·활성화 지원 | **공통 확장**: 거터 클릭·전체 일시 비활성화·편집 중 위치 이동. **어댑터 조건부**: 조건·횟수·로그·함수 중단점 |
| 하드웨어 중단점 | 방식 선택 없음 | **별도 연동**: 네이티브 어댑터 설정·전용 명령을 통해 선택 가능한지 실증. CPU 레지스터를 mew가 직접 제어하지 않음 |
| 소프트웨어 중단점 | 일반 중단점 요청 지원 | 엔진의 구현 방식에 맡김. Node/Python의 소스 중단점을 CPU 코드 패치와 동일하게 설명하지 않음 |
| 메모리 접근 Watch | 미지원 | **어댑터 조건부**: 데이터 중단점으로 읽기·쓰기·양쪽 접근 감지. 변수 또는 지원되는 주소 범위에 설정 |
| 표현식 Watch | 고정 감시 지원 | **공통 확장**: 객체 결과 펼치기·타입·프레임 범위·감시 오류 분리. 상시 실행 중 추적은 별도 기능 |
| Stack trace | 현재 중단 스택 지원 | **공통 확장**: 스레드 선택·추가 프레임 조회·중단 이유. **어댑터 조건부**: 예외 상세·프레임 재시작 |
| Memory Dump | 미지원 | **어댑터 조건부**: 제한된 메모리 범위 읽기·파일 내보내기. **별도 연동**: 전체 힙 스냅샷·프로세스/core dump 생성·분석 |
| Injection | 전용 기능 없음 | **어댑터 조건부**: 명시적인 표현식 실행·변수 수정·메모리 쓰기. **별도 연동**: DLL/원격 코드 주입·바이너리 패치·핫 리로드 |
| Debug Server / Client | 브라우저→mew 서버→loopback DAP 지원 | **어댑터 조건부/별도 연동**: 원격 대상 attach·소스 매핑·SSH 터널. 커널/JTAG/시리얼은 대상별 백엔드 필요 |
| Static Analysis | 디버거 전용 기능 없음 | **어댑터 조건부**: 디스어셈블·모듈·심볼 조회로 일부 보완. **별도 연동**: 정적 분석기·바이너리 CFG·역컴파일·악성코드 분석 |
| Dynamic Analysis | 중단·스텝·변수 조회 지원 | **공통/어댑터 확장**: 로그포인트·예외·데이터 중단점으로 실행 분석 강화. **별도 연동**: 프로파일러·장기 실행 추적·record/replay |
| 역방향 실행 | 미지원 | **어댑터 조건부**: step-back/reverse-continue. 기록·재생 가능한 대상 백엔드도 필요 |

`instruction breakpoint`는 명령어 주소를 지정하는 중단점이며 하드웨어 구현을 보장하는 옵션이 아니다. 중단점의 실제 구현·하드웨어 슬롯 수는 엔진과 CPU에 의존한다.

### DAP 기반 확장 후보와 지원 조건

아래는 mew에 추가할 요청·필드의 목록이다. 명령·capability 이름은 고정한 [DAP 스키마](https://github.com/microsoft/debug-adapter-protocol/blob/c10f18c3332ca04cece1081aa00232a9d882438d/debugAdapterProtocol.json)를 기준으로 한다. 가능한 UI와 구현 난도·순서는 mew 코드에 대한 판단이며, 특정 어댑터의 실제 지원을 보장하는 표가 아니다.

| 추가 기능 | DAP 요청·필드 | 확인할 capability 또는 조건 |
| --- | --- | --- |
| 조건·횟수·로그 중단점 | `setBreakpoints`: `condition`, `hitCondition`, `logMessage` | `supportsConditionalBreakpoints`, `supportsHitConditionalBreakpoints`, `supportsLogPoints` |
| 함수 중단점 | `setFunctionBreakpoints` | `supportsFunctionBreakpoints` |
| 예외 중단·상세 | `setExceptionBreakpoints`, `exceptionInfo` | `exceptionBreakpointFilters`와 옵션 지원, `supportsExceptionInfoRequest` |
| 데이터 중단점 | `dataBreakpointInfo`, `setDataBreakpoints` | `supportsDataBreakpoints`; 주소·바이트 범위는 `supportsDataBreakpointBytes` |
| 명령어 주소 중단점 | `setInstructionBreakpoints` | `supportsInstructionBreakpoints` |
| 단계 단위·호출 대상 선택 | `next`/`stepIn`/`stepOut`: `granularity`, `stepInTargets` | `supportsSteppingGranularity`, `supportsStepInTargetsRequest` |
| 실행 재시작·프레임 재시작 | `restart`, `restartFrame` | `supportsRestartRequest`, `supportsRestartFrame`·프레임 `canRestart` |
| 이전 단계·역방향 계속 | `stepBack`, `reverseContinue` | `supportsStepBack`와 기록·재생 백엔드 |
| 스레드별 제어 | `threads`·실행 요청의 `threadId`, `singleThread` | `supportsSingleThreadExecutionRequests`; 스레드마다 실행/중단 상태 관리 |
| 디버그 콘솔·자동완성 | `evaluate`의 `repl`, `completions` | REPL의 언어별 의미 확인, `supportsCompletionsRequest` |
| 변수·표현식 수정 | `setVariable`, `setExpression` | `supportsSetVariable`, `supportsSetExpression` |
| 메모리 조회·수정 | `readMemory`, `writeMemory` | `supportsReadMemoryRequest`, `supportsWriteMemoryRequest`; client 메모리 참조 지원 선언 |
| 디스어셈블 | `disassemble` | `supportsDisassembleRequest`, 프레임의 명령어 위치 정보 |
| 모듈·로드 소스·가상 소스 | `modules`, `loadedSources`, `source` | `supportsModulesRequest`, `supportsLoadedSourcesRequest`; 파일 대신 `sourceReference`인 소스 지원 |
| 실행 위치 변경 | `gotoTargets`, `goto` | `supportsGotoTargetsRequest`; 부작용과 대상 제약을 표시하는 별도 동작 |

지정 위치까지 실행은 기존 `setBreakpoints`와 `continue`로 임시 중단점을 만들 수 있다. 현재 줄부터 그 위치까지의 코드를 실제로 실행하며, 실행 위치만 옮기는 `goto`와 구분한다. 중간의 다른 중단점·예외·종료에서도 임시 중단점을 정리하고 기존 중단점을 보존해야 한다.

### 표준 DAP 밖의 추가 연동

- **네이티브 확장**: [CodeLLDB 설명](https://github.com/vadimcn/codelldb/blob/master/MANUAL.md#debugger-features)은 데이터 중단점·디스어셈블을 다루며, [역방향 실행](https://github.com/vadimcn/codelldb/blob/master/MANUAL.md#reverse-debugging)은 rr 같은 백엔드를 전제로 한다. 일반 LLDB 설치만으로 되감기를 제공한다고 표시하지 않는다. 어댑터·OS·버전을 고정한 실기 검증이 필요하다.
- **사후 덤프 분석**: [lldb-dap](https://lldb.llvm.org/use/lldbdap.html#attach-configurations)의 `coreFile`·attach 설정을 활용할 수 있다. 이미 생성된 core를 여는 것, core를 새로 만드는 것, 제한된 메모리 영역을 저장하는 것은 별도 기능이다. 덤프 세션에는 실행·계속·쓰기처럼 불가능한 동작을 제공하지 않는다.
- **Node/브라우저 힙 분석**: Node의 [V8 heap snapshot API](https://nodejs.org/api/v8.html#v8writeheapsnapshotfilename-options) 등 런타임 기능을 연결해야 한다. 메모리 영역을 읽는 DAP 기능만으로 힙 객체 그래프·참조 관계·누수 분석이 완성되지 않는다. 파일 생성·크기·대상 일시정지·실패·삭제를 다루는 별도 수집/분석 흐름이 필요하다.
- **원격·임베디드·커널**: mew 서버의 DAP 어댑터가 원격 대상 엔진에 연결하는 구성이 우선 후보다. 기존 DAP TCP는 loopback을 유지하고 필요한 경우 별도 SSH 터널·어댑터 설정을 사용한다. [OpenOCD의 GDB 연동](https://openocd.org/doc/html/GDB-and-OpenOCD.html)은 외부 서버와 타깃 구성이 필요한 예다. GDB remote와 DAP는 같은 프로토콜이 아니므로 OpenOCD 포트를 mew의 DAP 포트에 그대로 넣지 않는다. JTAG 장비·드라이버·커널 백엔드·권한은 대상별 별도 범위이며 이번 조사에서 실제 검증하지 않았다.
- **추가 언어와 설치**: Zed의 [언어별 어댑터 목록](https://zed.dev/docs/debugger#supported-languages)을 참고해 Java·PHP·Ruby·Swift 등의 DAP 어댑터 연결을 후보로 둔다. 공통 DAP 지원과 언어별 실행 프로필·확장 의존성을 구분한다. 선택 설치를 확대한다면 현재 js-debug 설치의 OS별 배포·버전 고정·무결성 검사·라이선스 고지·설치 재사용 계약을 어댑터마다 정의하며, 언어 런타임과 IDE를 일괄 번들하지 않는다.
- **정적 분석·주입·핫 리로드**: 분석기나 런타임별 별도 통합으로 분리한다. REPL에서 함수 호출이나 대입이 가능한 경우도 있지만, 이를 범용 코드 주입 지원으로 표현하지 않는다. 현재 고정 감시의 `evaluate`도 어댑터에 따라 부작용이 가능하므로 ‘조회만 해서 안전한 표현식’이라고 보장하지 않는다.

### mew 구현 전제와 변경 지점

1. **연결별 capability와 선택 상태**: 현재 `server/debugger.ts`는 루트·자식 연결의 capability를 하나의 snapshot에 합친다. 확장 기능은 선택한 연결별 capability·thread·frame으로 판정해야 한다. `capabilities` 이벤트에 따른 변경을 처리하고, 미지원 동작은 서버에서도 거부한다. 단일 상태값으로 모든 스레드·자식 프로세스를 실행 중 또는 중단됨으로 묶지 않는다.
2. **명령별 계약**: `/command`의 문자열 허용목록만 늘리지 않는다. 요청마다 세션·연결·중단 상태·프레임/변수 참조·입력 크기·응답 범위를 검증한다. 현재 [접근 권한](../../development/access-control.md#외부-디버거), 프로젝트 헤더·세션 ID 검사와 정책 변경 시 정리를 유지한다. 실행 위치 변경·수정·덤프 저장은 명시적인 사용자 동작으로 구분한다.
3. **참조 수명과 데이터 형식**: `shared/debugger.ts`에 연결·스레드·소스 참조·메모리 참조·중단점 옵션·평가 결과 타입을 확장한다. 변수/프레임 참조는 실행 재개 시 폐기한다. 데이터 중단점은 `dataId: null`, 지원 접근 방식·`canPersist`를 반영하고 임시 참조를 다음 세션에 그대로 저장하지 않는다. 등록된 데이터 중단점의 수명과 조회에 사용한 참조의 수명은 별도로 관리한다.
4. **메모리 조회와 쓰기**: 메모리 참조는 opaque 문자열로 보존하고 64비트 주소를 JS `Number`로 강제 변환하지 않는다. 주소 표시·계산이 필요하면 별도 파싱·`BigInt`를 사용한다. 제한된 페이지를 읽고 읽기 불가·부분 응답·실제 쓰인 바이트를 표시한다. 쓰기 후 변수·감시·메모리를 갱신하고 비정상 응답을 성공으로 처리하지 않는다.
5. **에디터 연동**: `packages/editor`의 코드 편집 호스트와 mew의 호스트 API에 거터·현재 실행 위치·호버 평가를 연결한다. 편집으로 바뀐 중단점 위치, 미확인/실제 이동 위치, 소스 맵, 여러 열린 패널과 프로젝트 전환을 처리한다. DAP 가상 소스는 프로젝트 파일로 덮어쓰지 않고 세션 범위의 읽기 전용 문서로 표시한다.
6. **수정과 평가 구분**: 고정 감시는 자동 조회 대상으로 유지하고, 사용자 REPL·변수/메모리 수정은 별도 액션으로 제공한다. REPL 결과도 객체 펼치기를 지원한다. 스텝·쓰기·프레임 재시작·`invalidated`/`memory` 이벤트 뒤에 관련 조회 상태를 무효화한다. 실제 처리하는 client capability만 initialize에 선언한다.
7. **프로필과 수명**: 계정·프로젝트별 저장을 유지하며 여러 실행 프로필, 명시적인 `.vscode/launch.json` 가져오기, 제한된 경로/환경 변수 치환을 검토한다. 가져온 프로필을 즉시 실행하지 않는다. `runInTerminal`의 현재 pipe 실행을 사용자 입력 가능한 PTY로 확장하고, 다중 세션·자식 프로세스 선택·재시작·연결 종료의 소유 프로세스 정리를 설계한다. mew 저장소의 빌드·서버 실행 제한을 자동 빌드 기능으로 우회하지 않는다.
8. **변경량과 한계**: 콘솔·예외·스레드·메모리·모듈은 별도 컴포넌트로 지연 로드한다. 변수·메모리는 페이지 조회, 출력은 범주별 제한, DAP 진단은 명시적으로 켜는 세션 한정 기록으로 둔다. 값·환경변수·덤프·DAP 로그를 문서나 영구 공용 기록에 자동 저장하지 않는다.

### 제안 구현 순서와 완료 기준

| 단계 | 범위 | 완료 기준 |
| --- | --- | --- |
| 1. 공통 기반과 일상 디버깅 | 연결별 지원 기능·상태, 거터/실행 위치, 조건·횟수·로그·예외, 콘솔, 스레드 선택, 감시 결과 펼치기 | 기존 Node 예제 회귀 유지, 조건·로그·예외·REPL의 실제 js-debug 검증, 미지원 옵션 서버 거부, PC·모바일 조작과 소스 위치 확인 |
| 2. 데이터·변수·메모리 | 데이터 중단점, 변수/표현식 수정, 메모리 읽기·쓰기·제한 범위 내보내기 | 네이티브 어댑터 실기로 쓰기 순간 중단과 재조회, 읽기 불가·부분 쓰기·참조 만료 처리. 해당 capability가 없는 대상에는 기능을 지원으로 표시하지 않음 |
| 3. 고급 실행·진단 | 단계 단위·디스어셈블·명령어 중단점, 프레임 재시작·step-in 대상, 모듈·가상 소스, 프로필·PTY·자식 세션 선택 | 해당 capability가 있는 실어댑터로 개별 검증, 종료/재시작 정리, 소스 없는 대상과 큰 데이터·다중 스레드에서 정상 동작 |
| 4. 대상별 통합 | core 분석·heap snapshot·원격 프리셋, 기록/재생·역방향 실행, 추가 언어 어댑터 | 기능별 외부 도구·OS·버전·설정 명시, 수집과 분석 구분, 지원/미지원 사례 기록. 커널·JTAG·범용 주입·역컴파일은 별도 요구사항 확정 뒤 진행 |

세부 검증 계획:

- 가짜 DAP 테스트: capability 없음/false/변경, 루트와 자식의 지원 불일치, 중단점 전체 교체·삭제·옵션, 데이터 중단점 정보 없음·참조 수명, 재시작·역방향 실행 이벤트, 큰/부분/오류 응답을 검사한다.
- 실제 언어 검증: js-debug(Node·브라우저), debugpy, LLDB DAP 또는 CodeLLDB, Delve를 각각 설치 버전·OS와 함께 확인한다. 프리셋 존재나 가짜 응답 테스트만으로 실지원이라고 표시하지 않는다. 역방향 실행은 별도의 record/replay 환경에서 검사한다.
- 브라우저 검증: 다크/라이트·PC/좁은 모바일의 거터·키보드·터치, 조건 편집·콘솔·변수 수정·메모리 페이지, 미지원 설명·오류 회복, 중단 중 프로젝트 전환을 검사한다.
- 권한/수명 검증: 기존 계정·프로젝트·세션 격리와 권한 회수에 새 읽기·쓰기·저장 작업도 포함한다. 취소·연결 종료·프로세스 오류·PTY 종료 시 자식 연결·임시 중단점·조회 참조를 정리한다.

이번 조사 작업의 검증은 출처와 현재 구현의 대조·문서 검사다. 위 계획의 기능 테스트나 실제 어댑터 확장 검증을 수행했다는 뜻이 아니다.

### 추가 조사: 실행 흐름·테스트·성능·협업

앞 표에 없던 후보와 기존 후보의 구체적인 사용 흐름을 추가로 조사했다. VS Code·js-debug·Vitest·Chromium CDP·Playwright·Clang·OpenTelemetry·Live Share의 공식 문서/코드가 근거다. 아래 mew 적용안은 구현 가능성에 대한 제안이며 설치·실행 검증이나 지원 확정을 뜻하지 않는다. 기존 다중 세션·heap snapshot·프로파일러 계획을 구체화한 항목은 별도로 표시한다.

#### 실행 설정으로 이미 전달 가능한 옵션

현재 mew는 실행 설정 JSON을 어댑터에 그대로 전달하므로 아래 js-debug 옵션을 전달할 경로가 있다. 전용 설정 UI와 사례별 실검증은 추가 작업이며, 다른 언어의 어댑터에 같은 옵션을 적용하지 않는다. 기준은 관리형 설치 버전인 [js-debug v1.140.0의 OPTIONS.md](https://github.com/microsoft/vscode-js-debug/blob/v1.140.0/OPTIONS.md)다.

| 옵션 | 얻을 수 있는 동작 | 추가할 부분과 제약 |
| --- | --- | --- |
| `skipFiles` | Node 내부·외부 라이브러리 등 지정한 경로를 단계 실행에서 건너뛰기 | ‘내 코드 위주로 실행’ 설정과 제외 경로 편집. 명시적 중단점·예외와의 상호작용은 어댑터 계약 확인 필요 |
| `smartStep` | 소스 맵으로 원본에 대응되지 않는 생성 코드에서 자동으로 다음 위치로 진행 | TypeScript 변환 코드 사례 안내. 소스 맵 자체가 없는 파일의 원본 위치를 복원하는 기능은 아님 |
| `showAsyncStacks` | 현재 호출로 이어진 비동기 호출 경로를 어댑터가 스택에 포함 | 비동기 경계·인공 프레임 구분, 스택 추가 조회. 과거의 비동기 호출 프레임에 현재 지역 변수가 존재한다고 가정하지 않음 |

[Node 디버깅 문서](https://code.visualstudio.com/docs/nodejs/nodejs-debugging#skipping-uninteresting-code)와 대조했다. 실제 파일·경로·소스 맵을 사용하고 현재 mew에 없는 `${workspaceFolder}` 치환에 의존하지 않는다. ‘원래 스택’과 비동기 호출 관계는 UI에서 구분한다. DAP `StackFrame.presentationHint: label/subtle`을 보존하고 어댑터가 평가할 수 없는 프레임은 변수 조회 대상으로 강제하지 않는다.

#### mew·DAP 경로를 확장할 후보

| 추가 후보 | 사용자에게 제공할 동작 | 가능 범위·구현 조건과 근거 |
| --- | --- | --- |
| 줄 안의 중단점·중단 가능 위치 | 한 줄의 여러 문장 중 정확한 열에 중단점을 놓고 가능한 위치 표시 | **어댑터 조건부**. `SourceBreakpoint.column`, `breakpointLocations`와 `supportsBreakpointLocationsRequest`. 열은 UTF-16 위치와 `columnsStartAt1` 계약을 따름. [VS Code inline breakpoint](https://code.visualstudio.com/docs/debugtest/debugging#inline-breakpoints), 고정 DAP 스키마 |
| 다른 중단점 이후 활성화 | A를 거친 뒤에만 B에서 멈추기 | **공통 확장 + 이벤트 조건**. mew가 B의 활성 상태를 관리하고 `stopped.hitBreakpointIds`의 실제 어댑터 ID로 A를 식별. 이 필드는 선택 사항이므로 ID가 없으면 정확한 발동을 보장할 수 없음. 줄 번호 추측으로 대체하지 않음. [Triggered breakpoint](https://code.visualstudio.com/docs/debugtest/debugging#triggered-breakpoints) |
| 중단 시점 기록·비교 | 이전 중단의 호출 경로·읽었던 변수·감시 값을 선택하고 두 시점 비교 | **공통 확장**. Zed의 `SessionSnapshot`, `push_to_history`, `historic_snapshots`는 이미 읽은 데이터를 제한된 기록으로 보관함. mew도 별도 기록 모델·개수/용량 제한 필요. [Zed 세션 코드](https://github.com/zed-industries/zed/blob/72d073d6423b0bf7e04aa87567a308d19617b7f2/crates/project/src/debugger/session.rs) |
| 값 표시와 큰 자료 탐색 | 16진수 전환, 레지스터 scope, 큰 배열 페이지, 읽기 전용·지연 평가 표시 | **공통/어댑터 조건부**. `format.hex`와 `supportsValueFormattingOptions`, `Scope.presentationHint`, `VariablePresentationHint`, `variables`의 `filter/start/count`. 실제 paging을 구현한 뒤 client `supportsVariablePaging` 선언. 값 문자열만으로 숫자·주소를 추측하지 않음. 고정 DAP 스키마 |
| 값의 표·차트 보기 | 선택한 배열·구조화된 값의 내용을 표나 간단한 그래프로 확인 | **공통 확장 또는 별도 연동**. DAP 자식 조회를 제한된 자료로 정규화할 수 있으나 이미지·텐서·임의 객체의 공통 시각화 형식은 DAP에 없음. 타입별 변환기와 크기 제한을 별도 설계하는 mew 제안 |
| 선택한/실패한 테스트 디버깅 | 테스트 목록이나 실패 위치에서 해당 사례만 디버거로 재실행 | **별도 러너 연동 + 기존 DAP 재사용**. 테스트 발견·결과 수집·파일/이름 필터를 러너별로 제공. Vitest는 디버깅 시 병렬 실행·timeout 조정이 필요하며 worker 연결도 확인. mew에 VS Code 테스트 확장 기능이 자동으로 생기는 것은 아님. [Vitest 디버깅](https://vitest.dev/guide/debugging), [테스트 필터](https://vitest.dev/guide/filtering) |
| 프런트·백엔드 함께 디버깅 | 실행 프로필 여러 개를 묶어 시작하고 대상 전환·묶음 종료 | **기존 다중 세션 계획 구체화**. 현재 계정·프로젝트 1세션 계약 변경, 시작 순서·준비 판정·일부 시작 실패 정리 필요. DAP의 자식 `startDebugging`만으로 독립 프로필 묶음이 완성되지는 않음. [VS Code compound launch](https://code.visualstudio.com/docs/debugtest/debugging-configuration#compound-launch-configurations) |
| 에이전트 디버깅 도구 | 에이전트가 중단 이유·스택·선택 변수 기록을 읽고 중단점·스텝을 요청 | **mew 연동 제안**. [현재 에이전트 세션](../../development/agent-sessions.md)의 디버거 안내 설정은 실제 도구 제공과 다름. 인증된 API/MCP에 타입이 정해진 작업·조회 예산·실행 제어권을 제공하고 계정·프로젝트·세션 제한을 유지. 임의 DAP/평가를 허용하는 것으로 대체하지 않음 |
| 공동 디버깅 | 팀원이 같은 중단 상태를 보면서 서로 다른 프레임을 탐색하고 제어권 전달 | **별도 협업 설계**. [Live Share](https://learn.microsoft.com/en-us/visualstudio/liveshare/use/codebug-visual-studio)의 공동 조사 흐름 참고. mew는 기본 계정 격리를 유지하고 세션 소유자의 명시적 공유·열람 범위·제어권·권한 회수 계약 필요. [기존 협업 계약](../../development/collaboration.md)에 따라 구현 전에 공유 결정 기록 마련 |
| 조사 결과 내보내기 | 선택한 스택·중단점·어댑터 버전·소스 리비전을 재현 자료로 저장 | **공통 확장 제안**. 현재 시점 자료와 Git 리비전을 선택해 내보내고 변수 값·출력 포함 여부를 구분. 실행 환경 전체를 복제하거나 재현 성공을 보장하지 않음. 세션 로그를 문서·태스크·대화에 자동 첨부하지 않음 |

중단 기록은 **과거에 읽은 값의 열람**이다. 당시 펼치지 않은 자식을 나중에 살아 있는 객체처럼 조회하거나, 만료된 `frameId`/`variablesReference`로 평가하지 않는다. 기록을 골라도 프로그램 실행 위치는 바뀌지 않는다. 실제 역방향 실행은 앞 절의 record/replay 백엔드가 필요하다.

큰 자료 탐색에는 명시적인 expensive scope 열기도 포함할 수 있다. `lazy`/`hasSideEffects` 정보가 있으면 반영하되 정보가 없다는 이유로 getter·표현식 조회의 부작용이 없다고 보장하지 않는다. 긴 조회에는 DAP `progressStart/Update/End`와 `cancel` 지원을 함께 검토한다. 취소는 `supportsCancelRequest`가 있을 때의 최선 노력 요청이며, 취소 전송만으로 대상 작업이나 프로세스가 종료됐다고 처리하지 않는다.

#### 별도 분석 백엔드·브라우저와 연결할 후보

Chromium 확장은 [CDP d209a9a38897d2935a078a0bf00ca821811d21ed](https://github.com/ChromeDevTools/devtools-protocol/tree/d209a9a38897d2935a078a0bf00ca821811d21ed/json)의 `browser_protocol.json`·`js_protocol.json`을 확인했다. 최신 프로토콜 코드가 실행 중인 Chromium의 모든 명령 지원을 보장하지 않으므로 실제 브라우저 버전·명령 지원도 확인해야 한다.

| 추가 후보 | 가능한 동작 | 필요한 연동과 한계 |
| --- | --- | --- |
| DOM·이벤트·요청 중단점 | 특정 요소 변경, 클릭 등 이벤트 리스너, 특정 URL의 XHR/fetch 호출 시 멈추기 | **CDP/어댑터 전용 연동**. `DOMDebugger.setDOMBreakpoint/setEventListenerBreakpoint/setXHRBreakpoint`. [Chrome 중단점 문서](https://developer.chrome.com/docs/devtools/javascript/breakpoints) 참고. [서버 브라우저](../../guides/browser.md)의 요소 선택을 실제 서버 DOM에 매핑하고 탭·frame·탐색 변경 시 참조 정리. js-debug와 직접 CDP 제어의 중단 상태를 일치시키는 검증 필요 |
| CPU·할당 프로파일 분석 | 느린 함수·호출 경로·메모리 할당을 표와 flame graph로 확인 | **기존 프로파일러/heap 계획 구체화**. CDP `Profiler.start/stop`, 런타임·어댑터 전용 수집 또는 파일 가져오기. `.cpuprofile`·`.heapprofile` 분석과 전체 heap snapshot 분석을 별도 범위로 둠. 공통 DAP 수집 명령은 없음. [VS Code 프로파일링](https://code.visualstudio.com/docs/nodejs/profiling) |
| 실행 커버리지 | 실행한/미실행 함수·구간을 소스에 표시 | **별도 연동**. JS는 CDP `startPreciseCoverage/takePreciseCoverage`, 다른 언어는 러너·계측 결과 형식 연동. 소스 맵·리비전 일치 검사. 정밀 커버리지는 최적화 실행을 제한할 수 있으며 수집 전 실행까지 완전하게 복구하지 못함. 고정 CDP `js_protocol.json` |
| E2E 동작 기록 분석 | 실패 전후의 DOM·소스·콘솔·네트워크를 시간 순서로 확인 | **별도 연동**. [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) 또는 로컬 trace artifact 연동. 테스트 러너·기록 API 설정 필요. 현재 브라우저에 Playwright를 쓴다는 사실만으로 E2E 추적 기능을 지원한다고 표시하지 않음. 기록 화면 열람은 프로그램의 역방향 실행과 구분 |
| 메모리 오류·경쟁 상태 보고 | use-after-free·범위 초과·data race 보고를 읽고 관련 소스로 이동 | **외부 계측 도구 연동**. [AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html)·[ThreadSanitizer](https://clang.llvm.org/docs/ThreadSanitizer.html)용 대상 빌드·런타임과 심볼 정보 필요. mew는 보고 파싱·실행 프로필·디버거 연결을 보조하며, 일반 DAP 연결만으로 해당 오류를 탐지하지 못함 |
| 여러 서비스의 요청 추적 | 한 요청의 프런트·서버·DB span과 로그를 이어서 분석 | **외부 telemetry 연동**. [OpenTelemetry traces](https://opentelemetry.io/docs/concepts/signals/traces/)의 계측·context propagation·저장소/API가 필요. span의 소스/리비전 정보가 있을 때 코드와 연결. trace가 모든 지역 변수·모든 문장 실행이나 서비스 동시 중단을 제공하지는 않음 |
| WebAssembly 원본 디버깅 | JS→Wasm 호출과 C/C++/Rust 원본 위치·값을 확인 | **어댑터/도구 체인 조건부**. [VS Code Wasm 디버깅](https://code.visualstudio.com/docs/nodejs/nodejs-debugging#debugging-webassembly)은 DWARF와 별도의 DWARF 디버깅 확장에 의존. mew standalone js-debug만으로 같은 기능이 탑재된다고 가정하지 않음. DWARF 처리 백엔드·가상 소스·Wasm 메모리의 통합 경로를 별도 조사·검증 |

브라우저 분석은 계정 소유의 선택한 탭에만 연결하고, 기존 브라우저의 탐색·입력·복원과 디버거 연결의 소유권을 분리해 정리한다. 네트워크 요청을 보류하는 CDP Fetch interception과 JS 실행 스레드 중단은 다른 동작이므로 서로의 성공으로 대체하지 않는다. 대상 프로그램의 성능 수집은 mew 협업 presence에서 제거한 JS heap 측정 전송을 다시 도입하는 작업과도 구분한다.

#### 추가 후보의 우선순위와 확인 기준

- **앞 절 1단계에 우선 추가**: 어댑터 옵션 안내/UI, 줄 안 중단점, 큰 배열 페이지, 중단 기록·비교. 각각의 효과를 기존 Node 예제에 비동기/배열 사례를 더해 확인할 수 있다. 테스트 디버깅은 지원할 첫 러너를 정한 뒤 별도 흐름으로 진행한다.
- **공통 기반 뒤 진행**: 발동 중단점은 실제 ID의 유지·변경 검증, 에이전트 도구는 상태 읽기부터 실행 제어로 확장. 프로필 묶음은 다중 세션 기반 완료 뒤, 협업은 공유·제어권 결정 뒤 진행한다.
- **도구별 범위를 정해 진행**: DOM/이벤트 중단 → CPU 프로파일 파일 분석·수집 → E2E trace/커버리지 순서를 제안한다. Sanitizer·분산 trace·Wasm은 대상 언어·프로젝트 요구가 있을 때 개별 연동으로 진행한다. 지원 기능 수를 늘리기 위해 모든 도구를 기본 설치하지 않는다.

추가 검증은 인라인 열의 UTF-16 위치, 중단점 ID 누락/변경·활성화 순서, 실행 재개 후 과거 기록 참조 폐기, 큰 배열의 실제 paging, 비동기 경계·평가 불가 프레임, 테스트 worker/timeout과 종료 정리를 포함한다. 브라우저는 두 제어 경로의 동시 연결·탐색·탭 종료를, 에이전트/협업은 제어권 충돌·세션 교체·권한 회수를 검사한다. 프로파일/trace는 버전·소스 불일치와 부분/큰 artifact 처리까지 확인한다. 이번 추가 조사에서는 이러한 런타임 검증을 실행하지 않았다.
