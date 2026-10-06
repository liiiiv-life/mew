---
id: "mew-debugger"
parent: "mew-agents"
title: "외부 DAP 디버거"
status: "implemented"
created: "2026-10-07"
updated: "2026-10-07"
files: ["src/components/debugger-panel.tsx", "src/components/debugger-settings.tsx", "server/debugger.ts", "server/debugger-dap.ts", "server/debugger-routes.ts"]
commits: []
description: "선택 설치하는 외부 DAP 디버거의 설정 탭·독 패널·계정별 세션, 브레이크포인트·스텝 실행·스택·변수·고정 감시와 CommonJS 설치 격리·기존 설치 보정·시작 오류 진단·브라우저 연결 설정 복구·성적 집계 연습 예제와 권한·검증 범위를 정의한다."
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

`launch`는 새 프로그램을 실행하고, `attach`는 이미 실행 중인 대상에 연결한다. attach의 `port`·`processId` 등은 실행 설정에 넣는다. TCP 연결 포트 필드는 **어댑터** 포트이며 디버깅 대상의 포트와 다르다. 실행 설정은 어댑터에 그대로 전달하며 VS Code의 `${workspaceFolder}`나 launch.json 환경 변수 치환은 제공하지 않는다.

### 브라우저 연결과 어댑터 포트 오류

이미 열린 Chromium 탭은 js-debug의 `pwa-chrome` 실행 설정과 `attach`로 연결한다. 실행 설정의 `address`·`port`는 브라우저 CDP 주소·포트, `urlFilter`는 대상 앱 주소, `webRoot`는 앱 소스 루트다. 브라우저 포트는 재시작 시 달라질 수 있다. Vite 개발 서버는 TypeScript 소스 맵을 제공하며, 소스 맵 없는 빌드본에서는 원본 줄 브레이크포인트가 제한된다.

‘어댑터 TCP 포트가 감지되지 않았습니다’는 브라우저에 연결하기 전 어댑터 시작 단계의 오류다. js-debug 실행 파일이 `node`, 인수가 `[]`, TCP 포트가 `0`이면 어댑터 대신 Node 입력 대기 상태가 되어 이 오류가 발생한다. **현재 프로젝트의 설정 → 디버거 → js-debug 설치**를 다시 누르면 설치된 파일을 재사용하면서 서버 Node 경로와 `[dapDebugServer.js 절대 경로, "0", "127.0.0.1"]` 인수·TCP 포트 `0`을 채운다. 그 뒤 실행 방식은 **연결(attach)**, 실행 설정은 `pwa-chrome`으로 확인하고 저장한다. 설치 여부 표시는 서버 공통 파일 존재 여부이며, 계정·프로젝트별 실행 인수가 설정되었다는 뜻은 아니다. 어댑터 선택을 다시 바꾸면 기본 인수로 초기화될 수 있으므로 설치 버튼으로 다시 적용한다. 시스템 Chrome 설치가 없고 Mew가 Playwright Chromium을 사용하는 환경에서는 실행 설정의 `runtimeExecutable`에 실제 Chromium 실행 파일 절대 경로도 지정한다. 그렇지 않으면 어댑터 초기 부팅에서 브라우저 설치를 찾지 못해 연결이 종료될 수 있다.

외부에서 저장 설정을 보정한 경우 열려 있는 설정 화면은 이전 값을 가지고 있을 수 있다. 설정을 닫고 다시 열어 읽은 뒤 시작한다. 실제 환경 경로·브라우저 포트를 문서의 고정값으로 사용하지 않는다.

### 패널과 세션

- 독의 디버거 아이콘이나 설정의 **디버거 열기**로 별도 패널을 연다. 기존 독 배치·모바일 전면 스택·계정별 프로젝트 UI 복원을 따른다. 설정과 패널 컴포넌트는 지연 로드하며 닫힌 패널은 상태를 폴링하지 않는다.
- 시작·계속 실행·일시정지·다음 줄·함수 안으로·함수 밖으로·연결 종료를 제공한다. 서버에는 계정·프로젝트별로 한 세션만 허용하고 중복 시작은 거부한다. 실행 중에는 연결·실행 설정 변경을 거부하며 브레이크포인트와 감시 목록만 수정할 수 있다. 설치·설정 조회·패널 열기만으로 어댑터를 실행하지 않는다. **시작** 또는 **연결 테스트** 때만 외부 프로세스를 만든다. 테스트는 initialize 후 연결과 관리 프로세스를 종료한다.
- 브레이크포인트는 패널에서 소스 경로와 1부터 시작하는 줄 번호로 추가·비활성화·삭제한다. 상대 소스 경로는 프로젝트 루트 기준이다. 어댑터의 검증 여부와 메시지를 표시하고 실행 중 변경도 전송한다. 현재 버전은 에디터 줄 번호를 클릭하는 브레이크포인트 거터를 제공하지 않는다.
- 중단 이벤트에서 호출 스택을 조회한다. 스택 행을 선택하면 해당 프레임의 변수를 읽고 프로젝트 안의 소스 파일과 줄을 에디터에서 연다. 프로젝트 밖 소스는 현재 에디터에서 열지 않는다.
- 비싼 scope를 제외한 기본 변수를 읽고 객체를 펼칠 때만 자식을 읽는다. 같은 소스·프레임 이름·scope·변수 이름으로 이전 중단 값을 비교한다. 변경된 기본 변수를 먼저 배치하고 표시한다. 최초 조회는 변경으로 표시하지 않는다. 동일 중단 시점의 재조회에서도 변경 표시를 유지한다.
- 변수의 핀 버튼이나 표현식 입력으로 감시 대상을 고정한다. 매 중단 시 현재 프레임에서 evaluate하고 값 변화도 표시한다. 표현식 오류는 해당 감시 값에 표시한다. 고정 목록은 세션 종료·문서 수정 뒤에도 유지한다.
- 패널 닫기는 세션을 종료하지 않는다. **연결 종료**는 launch 대상 종료를 요청하고 attach 대상은 유지하도록 요청한다. mew가 시작한 어댑터와 터미널 자식 프로세스는 연결 종료·오류·권한 회수 시 정리한다. 서버 프로세스가 재시작되면 DAP 세션을 복원하지 않는다.

### 구현과 경계

- HTTP `/api/debugger` 아래 설정 조회·저장, 설치, 연결 테스트, 세션 시작·종료, 허용된 DAP 명령을 제공한다. 현재 프로젝트 헤더를 검사하며 명령·종료는 세션 ID도 비교한다. 계정·프로젝트별 설정 파일은 데이터 폴더에 원자적으로 저장한다. 어댑터가 TCP 포트를 알리기 전에 종료되면 stderr가 닫힐 때까지 기다려 종료 코드·시그널과 최근 오류 줄을 반환한다. 긴 번들 소스 줄은 오류 요약에서 제외하고 요약은 2,000자로 제한한다.
- DAP 헤더의 바이트 길이와 분할된 UTF-8 프레임을 처리하고 요청 시간 제한·연결 종료 거부를 제공한다. js-debug의 `startDebugging` 역방향 요청은 같은 어댑터에 별도 자식 연결을 만들어 처리한다. `runInTerminal`은 셸 문자열 해석 없이 argv로 실행하며 관리 프로세스로 추적한다.
- owner·manager, 터미널 기능, 해당 프로젝트 전체 파일 읽기·수정 권한이 필요하다. 실행·설치는 서버 OS 권한으로 동작한다. 접속 중 정책 변경과 5초 주기 검사에서 실행 중인 세션을 재검증한다. 자세한 권한 경계는 [계정별 기능·파일 권한](../../development/access-control.md)을 따른다.
- 출력은 최근 64,000자로 제한한다. DAP 메시지는 8MiB, 세션의 연결 수는 16개, 보관 세션은 서버 전체 64개, 브레이크포인트는 설정당 200개, 고정 표현식은 64개로 제한한다. 스택은 40개, 각 변수 조회는 200개까지 표시한다. 변수 값 수정, 임의 DAP 요청, 역방향 디버깅, 자동 언어 런타임 설치는 제공하지 않는다.

### 확인 기준과 검증

- `server/debugger-install.test.ts`: `type: module` 프로젝트 내부 설치에서 발생하는 CommonJS 실행 실패를 재현하고 설치 재사용·메타데이터 보존·세션 시작 시 기존 설치 보정을 검증한다.
- `server/debugger.test.ts`: UTF-8 분할·다중 메시지·요청 시간 초과·과대 헤더 거부, 초기화/구성 순서, 스택·변수·스텝·감시, 브레이크포인트 삭제와 계정·프로젝트별 저장과 조기 종료 시 코드·stderr 진단을 검증한다.
- `server/debugger-routes.test.ts`: 역할·터미널·전체 파일 권한, 프로젝트/세션 불일치, 계정·프로젝트 분리, 잘못된 설정 보존·실행 중 모드 변경 거부·권한 회수 시 세션 정리를 검증한다.
- `server/debugger-ui.test.ts`: 앱 번들을 만들지 않는 격리 브라우저 픽스처로 데스크톱 다크/320px 모바일 라이트의 설정 오류·연결 테스트·패널 시작·스텝·변경 우선 표시·핀·종료를 확인한다.
- 2026-10-07: 임시 데이터 폴더에 공식 js-debug standalone을 설치하고 실제 Node.js 프로그램의 자식 DAP 세션·브레이크포인트·스택·변수 평가·계속 실행·종료를 검증했다. 실어댑터 테스트는 `MEW_TEST_JS_DEBUG`에 임시 설치의 `js-debug/src/dapDebugServer.js` 경로를 지정하면 실행한다.
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
