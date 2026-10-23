---
title: "앱 시작과 서버 구조·상태 파일"
description: "인증 대기 전 시작 화면·진입점 병렬 다운로드·시작/인증 청크 묶음과 모듈 평가 교착 방지·현재 P2P 인증 결과 재사용·패널별 비동기 로딩과 서버·CLI·OS 실행 계층의 책임, 브라우저 빌드와 네이티브 서버 의존성의 분리를 설명한다. 공통 UI의 데모 실행 환경·계정별 요청과 상태 파일·격리 시작 성능 검증, 일반 DOM 브라우저 제거와 인증된 localhost 앱 진입의 경계를 구분한다."
updated: "2026-10-23"
상위파일:
  - "../MOC.md"
  - "MOC.md"
---
[설치·실행](../guides/getting-started-ko.md)

## 구조

- `server/serve.ts` — 프로덕션 서버 (5000, 단일 포트)
- `server/cli-host.ts` — 사전 빌드 CLI의 첫 owner·현재 작업 폴더·준비 상태와 Mewlink 공개 주소 IPC. [CLI 배포 계약](cli-distribution.md)
- `server/instance-lock.ts` — source 프로덕션 서버·CLI host의 `DATA_DIR/server.lock` 소유와 중복 실행 차단. 죽은 PID의 잠금만 회수하며 데이터 내용을 초기화하지 않는다.
- `server/platform/` — 공통 기능에서 호출하는 프로세스·IPC·상태 경로와 POSIX·Windows 구현. Linux 메모리 제어·macOS 지표도 해당 OS 폴더에서 소유한다. 터미널 backend·CLI·배포 경계는 [Windows 네이티브 계약](windows-native.md)을 따른다.
- `server/plugin.ts` — Vite 개발 서버의 API·WebSocket 연결 (4999)
- `server/dataDir.ts` — `DATA_DIR` 상태 파일 공용 입출력 (아래)
- `server/auth.ts`, `server/authRoutes.ts` — 인증 (사용자·세션·로그인 라우트)
- `shared/mewlink-identity.ts` — 중앙 issuer·불변 신원 검증과 공유 자료형. `server/mewlink-identities.ts`·`mewlink-auth-routes.ts` — 로컬 승인·계정 연결·외부 로그인과 owner 관리.
- `server/remote-authentication.ts` — P2P 연결에서 선택한 비밀번호 세션 또는 승인 신원. transport lease와 권한은 `remote-access-agent.ts`·dispatcher에서 검사한다.
- `server/reqAuth.ts` — 요청별 인증 해석(`req.auth`)·역할/기능 게이팅 미들웨어
- `server/access-policy.ts`·`access-routes.ts`·`access-socket.ts` — [계정별 기능·파일 권한](access-control.md), 관리 API와 연결 재검증. `guestAccess.ts`는 기존 저장 형식의 호환 코드다.
- `server/usersCli.ts` — 승인 리스트 CLI
- `server/docsRepo.ts` — docs 폴더 가져오기/내보내기, `server/fsBrowse.ts` — 워크스페이스 밖 폴더 목록
- Mew 자체 문서는 이 저장소의 [문서 규칙](../README.md)을 따른다. Documents에 연결한 다른 프로젝트의 문서 정책은 해당 프로젝트가 소유하며 MOC 등록을 자동으로 요구하지 않는다.

`vite.config.ts`는 개발 서버의 `configureServer` 훅에서만 `server/plugin.ts`를 불러온다. 모듈 URL을 동적 import에 전달해 Vite 설정 번들러가 서버 의존성을 미리 가져오지 않도록 하며, 브라우저 빌드의 설정 로딩에 네이티브 `node-pty`가 필요하지 않게 한다. 개발 서버와 프로덕션 서버 실행에는 여전히 해당 플랫폼에 설치된 네이티브 PTY가 필요하다. `server/vite-config.test.ts`는 앱 빌드·서버 실행 없이 설정을 불러와 이 의존성 경계를 검사한다.

## 브라우저 첫 시작

일반·원격 접속과 별도로 `demo.html`은 메모리 기반 실행 환경을 준비한 뒤 같은 `main`·`AppBootstrap`·`App`을 불러온다. `src/runtime/app-runtime.ts`가 전송·협업·초기 인증·기준 경로를 주입하며 실제 P2P 상태와 구분한다. UI를 복사하지 않는 데모의 상태·배포·검증 계약은 [브라우저 데모](demo.md)가 소유한다.

`src/main.tsx`는 저장된 글꼴·테마를 적용하고 가벼운 `StartupScreen`을 먼저 표시한다. P2P 부모 MessagePort·인증 조회와 현재 경로의 진입점 다운로드를 병렬로 시작한다. `AppBootstrap`을 불러오며 실제 렌더링은 저장소 범위 확인 뒤에 한다. P2P 런처가 현재 연결에서 확인한 인증 상태를 `initialAuth`로 전달하면 그 결과로 로컬 사용자·인스턴스 저장소 범위를 설정하고, 없거나 형식이 맞지 않으면 `/api/auth/me`로 확인한다. 재연결 중에는 전달 상태를 재사용하지 않는다. 첫 상태는 `AppBootstrap`에서도 재사용하며 영속 인증 캐시는 만들지 않는다. 기존 캐시 정리는 저장소 범위가 정해진 뒤, 작업 화면의 React effect가 상태를 저장하기 전에 실행한다.

시작 비동기 작업은 `main.tsx`의 `startApp()` 안에서 수행하며 모듈 최상위에서는 await하지 않는다. 번들러가 진입점과 공용 코드를 같은 청크로 묶으면 인증 청크가 시작 청크를 다시 참조할 수 있다. 이때 모듈 평가 자체가 인증 import를 기다리면 서로 평가 완료를 기다리므로, 시작 모듈은 평가를 끝내고 비동기 렌더링을 이어간다. 이 규칙은 선택적 viewport 진단 import에도 적용한다.

`AppBootstrap`은 인증 조회·만료·권한 변경, 콘텐츠 캐시의 사용자/권한 범위와 로그인 모달을 소유한다. 원격과 localhost 앱 진입의 미인증·임시 비밀번호 상태에는 기존 `LoginPage`만 표시한다. 인증된 `?preview=<port>`는 전체 작업 화면 대신 `PortPreviewPage`를 지연 로드해 [포트 프리뷰](port-preview.md)에 연결한다. 편집기·터미널·작업 패널을 포함한 `App`은 작업 화면을 표시할 때 React lazy로 받는다. 로컬 비로그인 접속의 게스트 문서 열람은 유지한다. 계정이 바뀌는 P2P 연결은 기존처럼 앱 프레임을 다시 시작하며, 지연 로드를 이유로 서버 인증·권한 검사를 생략하지 않는다.

작업 화면의 헤더·사이드바·독은 편집기와 별도로 준비된다. `deferredComponent`는 각 편집기·패널·설정 창에 자체 Suspense 경계를 두므로 한 도구의 다운로드가 늦어도 작업 화면 전체가 사라지지 않는다. 설정·파일 탐색·로그인 화면·원격 데스크톱·이력 같은 도구는 해당 화면을 열 때 받는다. 검색·태스크·메모는 처음 열 때 코드가 로딩되고, 이후 닫아도 컴포넌트를 유지해 내부 상태를 보존한다. 메모는 지연 다운로드가 끝난 첫 마운트에서도 포커스를 받는다. 에이전트 패널은 기존 세션 복원·백그라운드 알림을 유지하며 작업 화면과 독립적으로 로딩된다. 업데이트 전체 검사는 작업 화면을 한 번 그린 뒤 시작한다.

일반 API의 tmux 세션 필터와 탐색기의 검색 유틸은 [순수 패키지 진입점](packages.md)으로 가져온다. 명령 팝업의 xterm renderer, GitHub 로그인용 영상 뷰어, 접속 이력은 사용 시 별도로 받는다. 프로젝트 아이콘의 전체 선택 목록도 최초 화면의 필수 의존성에서 분리하며, 아이콘을 기다리는 동안 표시 크기를 유지한다. 선택 근거는 [점진적 시작 결정](../decisions/0003-progressive-startup.md)에 기록한다.

`src/api/auth.ts`는 터미널 패키지를 가져오지 않는 인증 전용 API다. 일반 작업 API인 `api/client.ts`는 기존 호출자 호환을 위해 같은 함수·타입을 재노출한다. 오류·세션 만료 알림은 `api/response.ts`가 공유한다.

기본 IBM Plex 글꼴은 유지하며, 기본 화면에서 쓰지 않는 Noto Serif KR의 외부 CSS와 사전 연결은 최초 HTML에서 제거한다. 저장된 설정이나 사용자의 선택에 해당 글꼴이 있을 때 `applyFontPreferences()`가 한 번만 비동기로 준비한다. [P2P 정적 자원 압축과 preload 경로](remote-access.md)가 별도로 전송 비용을 줄인다.

`server/startup-chunks.ts`는 Vite가 main의 정적 의존성을 `startup`, `AppBootstrap`의 정적 의존성을 `authentication` 청크로 묶도록 한다. 이미 startup에 속한 공통 코드는 중복하지 않으며 작업 화면·도구의 동적 import는 유지한다. `main.tsx`도 시작 청크에 포함할 수 있도록 시작 작업은 모듈 평가를 막지 않는 비동기 함수에서 실행한다. 청크 그룹의 파일 제외 조건에 교착 방지를 의존하지 않는다. 시작 화면·인증·저장소 범위 설정의 순서는 바꾸지 않는다. 선택 근거는 [접속 준비와 시작 청크 결정](../decisions/0050-mewlink-startup-preparation.md)을 따른다.

2026-10-23 동일한 실제 main·로그인 코드와 모의 Workspace를 사용하는 `write:false` fixture에서 시작 JS 정적 의존 요청은 8개에서 3개, 로그인 진입까지의 합집합은 9개에서 4개로 줄었다. CSS와 실제 작업 화면은 제외했으며 운영 dist나 전체 접속 시간 측정이 아니다. 같은 테스트의 Chromium 검사는 인증 대기 중 시작 화면, 원격 로그인·임시 비밀번호 변경 전 Workspace 요청 0건, 신원·권한 변경·로컬 게스트 경계를 확인한다.

`src/app-bootstrap.browser.test.ts`는 실제 main·인증·P2P 앱 브리지와 로그인 화면을 격리 브라우저에 올려, 인증 응답 대기 중 시작 화면 표시, 원격 로그인 전 workspace 요청 0건, 최초 인증 조회 1회, 비밀번호 변경 요구·신원/권한 전환·로컬 게스트·조회 실패를 확인한다. `src/workspace-startup.browser.test.ts`는 PC·모바일의 실제 작업 화면에서 편집기·설정 모듈 응답을 보류해도 헤더·사이드바가 동작하고, 닫힌 도구를 미리 받지 않는지 검사한다. API·탐색기·작업 화면의 의존성 검사는 `src/api/client-bundle.test.ts`, 명령 팝업의 renderer 대기는 `src/components/session-terminal-startup.browser.test.ts`, 아이콘 크기·선택은 `src/components/project-icons-startup.browser.test.ts`, 메모의 첫 열기·재열기 포커스는 `src/components/shared-memo-startup.browser.test.ts`가 담당한다. 실제 설치 `dist/`는 사용자가 빌드·적용한다.

2026-10-15 점진적 시작 전후를 같은 production define·minify·write:false 메모리 번들로 비교했다. `main`·`AppBootstrap`·`App`의 정적 의존 청크 합집합은 raw 4,755,197→1,146,627바이트, 청크별 gzip 합계 1,365,617→373,973바이트로 줄었다(각 약 76%·73%). 청크 사이로 옮겨진 공통 코드는 한 번만 센다. 선택 도구를 열 때 필요한 코드는 별도 청크에 남는다.

같은 JS를 gzip으로 제공한 가짜 API·격리 브라우저에서 캐시 없이 버전·조건별 3회 측정한 첫 콘텐츠 표시(FCP) 중앙값은 로컬 404→72ms, 4Mbps·네트워크 지연 60ms·CPU 4배 제한에서 3,968→712ms였다. 실제 작업 화면의 헤더 DOM 삽입 시점은 각각 391→403ms, 3,945→1,976ms였다. 로컬 작업 화면의 준비 시간은 거의 같으며, 시작 로딩 화면의 첫 표시와 느린 환경의 작업 화면 준비가 빨라졌다. FCP는 시작 로딩 화면을 포함하고 헤더 삽입도 편집기·세션 복원이 끝난 시간을 뜻하지 않는다. CSS·이미지·글꼴과 실제 계정 데이터·P2P 전송은 제외한 합성 측정이다. 실제 설치의 10초 지연을 재현하거나 운영 개선 시간을 확인한 결과는 아니다.

이전 인증 부트스트랩 분리에서는 원격 비로그인 첫 화면의 JS 의존 청크가 raw 약 4.73MB→0.56MB, 청크별 기본 gzip 합계 약 1.36MB→0.18MB로 줄었다(약 87%). 당시 추가 workspace 조작 검사 2건의 timeout은 변경 전 App 소스를 사용한 격리 fixture에서도 재현했고, 기존 UI 번역 문구 검사에도 실패가 남았다. 이 수치는 CSS·이미지·글꼴을 공통 stub으로 제외한 production define·minify·write:false 메모리 번들의 JS 비용 비교이며 실제 설치의 네트워크 시간 개선 수치가 아니다.

## 서버 상태 파일 (`.data/`)

아래 파일의 저장 루트는 `server/dataDir.ts`의 `DATA_DIR`이며 `.data/`는 이전 설치의 경로다. `MEW_DATA_DIR`을 명시하면 그 위치를 사용하고, 없으면 앱 폴더의 기존 `.data/`를 우선 보존한다. 새 설치는 Linux·macOS의 `~/.local/share/mew`(`XDG_DATA_HOME` 존중), Windows의 `%LOCALAPPDATA%\mew\data`를 사용한다. [설정 파일과 우선순위](../configuration/environment.md#서버-설정)를 따른다.

`users.json` v2의 `accounts`는 프로필·역할을, `passwordCredentials`는 비밀번호와 변경 요구를, `mewlinkIdentities`는 승인된 외부 신원 연결을, `mewlinkRequests`는 요청·결정 상태를 소유한다. 승인과 사용자 생성은 한 번의 원자적 저장이다. v1은 첫 계정 저장 시 이관하며 기존 이메일 기반 사용자 ID와 권한·개인 데이터 키를 보존한다. 새 외부 전용 사용자는 불변 내부 ID를 사용한다. 기존 API의 `email`은 사용자 ID의 호환 이름이며 연락처 이메일을 의미하지 않는다. `sessions.json`은 기존 로컬 비밀번호 세션만 저장하며 외부 신원은 살아 있는 연결에서 검증한다.

```mermaid
flowchart LR
  Password["로컬 비밀번호 세션"] --> Account["로컬 사용자 ID"]
  Central["Mewlink 서명 신원"] --> Approval["owner 승인 연결"]
  Approval --> Account
  Account --> Policy["로컬 역할·기능·파일 권한"]
  Account --> State["개인 설정·프로젝트·대화"]
```

사용자·세션·계정별 기능/파일 권한·프로젝트 배치·터미널 버튼·숨김 목록·예약 작업이 여기 있다. JSON 상태는 `server/dataDir.ts`를 거쳐 읽고 쓴다. 대화 전사는 `server/agentTranscript.ts`의 SQLite 저장소를 사용하며 [대화 저장 계약](conversation-storage.md)을 따른다. 접속 기록은 `server/presence-history.ts`의 `presence/history.sqlite`에 영구 저장하며 [협업 저장 계약](collaboration.md#접속-기록일별-조회엑셀)을 따른다:

- **쓰기는 임시 파일 + rename**뿐이다. `writeFileSync`로 바로 쓰면 파일이 잠깐 0바이트가 되고, 그 순간 다른 프로세스가 읽으면 빈 값으로 오해한다.
- **읽기 실패를 빈 값으로 넘기지 않는다.** 파일이 없으면 `null`, 깨졌으면 사본(`*.corrupt-*`)을 남기고 던진다. 못 읽은 걸 `{}`로 보고 덮어쓰면 남아 있던 설정이 통째로 사라지기 때문 — 실제로 프로젝트 아이콘이 이 경로로 초기화됐었다.
- 위치는 `MEW_DATA_DIR`로 바꿀 수 있다. `npm test`가 이걸 임시 경로로 지정해 **테스트가 실제 운영 데이터를 건드리지 않게** 한다 (테스트는 프로젝트를 만들었다 지우면서 아이콘·배치를 함께 고친다).

## 프로젝트 아이콘 기준본

각 루트의 `.mew/project-icon.json`은 `{ "icon": "i:folder" }` 형태로 아이콘 값 하나를 저장한다. 기존 `svg:`·`svgt:`·이모지 표기를 그대로 지원하고 읽기·쓰기에서 공통 SVG 검증을 적용한다. `null`은 명시적 초기화이며 옛 값으로 되돌리지 않는다. 사이드바 목록·중첩 트리·루트 탭은 `server/projectIcons.ts`를 통해 같은 파일을 읽는다. 트리 구조 캐시도 응답 시 프로젝트 파일에서 아이콘을 다시 읽어 오래된 값을 유지하지 않는다. 파일·`.mew` 심볼릭 링크는 거부하고 손상된 파일을 덮어쓰지 않는다.

기존 `DATA_DIR/project-icons.json`의 현재 루트 직계 프로젝트 값은 첫 조회 때 프로젝트 파일로 이관한 뒤 이전 키를 제거한다. 계정의 기존 탭 아이콘은 프로젝트 파일·사이드바 값이 없을 때만 초기값으로 이관한다. 이름만 같은 다른 루트에는 옛 사이드바 값을 적용하지 않는다. 조회할 수 없는 프로젝트는 기본 폴더 아이콘을 표시한다. 읽기·이관은 표시 시점에 이루어지므로 닫힌 프로젝트를 재귀 탐색하지 않는다.

Owner 전용 `POST /api/project-icons/read`는 절대경로 목록의 현재 아이콘을 읽고, `PUT /api/project-icons`는 `{ path, icon }`을 프로젝트에 저장한다. 기존 `/api/project-icon`도 같은 파일을 갱신한다. 계정의 루트 탭 저장에는 아이콘 내용을 더 이상 넣지 않는다. [ADR 0177](../history/decisions/0177-mew-project-owned-icons.md)을 따른다.
## 계정별 활성 프로젝트

[ADR 0200](../history/decisions/0200-mew-account-active-workspace.md)에 따라 마지막 활성 프로젝트는 `user-ui-state.json`의 계정별 `activeWorkspace`가 소유한다. `server/account-workspace.ts`는 인증된 계정의 루트를 읽고 `paths.ts`의 `AsyncLocalStorage` 컨텍스트에 요청 수명 동안 고정한다. `workspacePaths`와 `projectRoot` 등 경로 함수는 이 컨텍스트를 읽으며, 계정 없는 CLI·서버 초기화는 기존 서버 기본 루트를 사용한다. 저장값이 없거나 경로가 삭제되면 기본 루트로 복원한다.

`POST /api/workspace`, `/api/fs/open-project`, `/api/subprojects/open`은 기존 owner 권한을 유지하고 요청 계정의 루트만 저장한다. `workspace` presence 알림은 같은 인증 계정에만 전달한다. 서버 기본 루트·`MEW_WORKSPACE` 설정·다른 계정의 watcher·공동 편집 방은 바꾸지 않는다. 기존 에이전트 작업 경로는 고정된 채 유지하고 새 터미널의 기본 경로는 요청 계정의 루트를 따른다. Documents 폴더 설정은 기존처럼 프로젝트 설정 파일이 소유한다.

파일 카탈로그와 검색 상태·트리 감시자는 실제 프로젝트 경로, 검색 SQLite 핸들은 루트별 DB 경로로 분리한다. 프로젝트 WebSocket 연결은 연결 시 계정 루트를 사용하며 공동 편집 방은 서버 내부 키에 루트를 포함한다. 와이어의 `프로젝트:상대경로`와 서버 공통 메모 방은 유지한다. 같은 실제 루트를 보는 계정끼리는 공동 편집을 공유하며 다른 루트의 동명 파일과는 분리한다.

## 뮤펫 전역 스킨

`DATA_DIR/mewpet/skins/<스킨 폴더>/skin.json`과 PNG·WebP가 프로젝트와 독립된 스킨 기준본이다. `server/mewpet-skins.ts`는 전역 폴더와 앱 소스의 `public/mewcat/*/skin.json`을 런타임에 읽고 전역 같은 ID를 우선한다. 이미지 교체·새 폴더는 빌드·재시작 없이 목록 조회에 반영된다. `/api/mewpet/skins`는 활성 프로젝트·Documents 파일 ACL 바깥에 두고 쓰기는 owner만 허용한다. API 저장은 새 버전 이미지 전체를 기록한 후 manifest를 원자적으로 교체하며 직전 버전도 보존한다. 상세 schema·브라우저 이관은 [뮤펫 기능 계약](../features/화면·계정·운영/Mewpet%20마스코트·알림·휴식.md#파일로-스킨-등록)을 따른다.
