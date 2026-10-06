---
description: "서버 주요 모듈과 인증·권한 경계, 계정별 활성 프로젝트와 요청 경로, DATA_DIR의 상태·대화 저장 및 프로젝트 아이콘 기준본의 책임을 설명한다."
---
# 서버 구조와 상태 파일

[문서 지도](../MOC.md) · [개발 계약](MOC.md) · [설치·실행](../guides/getting-started-ko.md)

## 구조

- `server/serve.ts` — 프로덕션 서버 (5000, 단일 포트)
- `server/plugin.ts` — vite dev 플러그인 (4999)
- `server/dataDir.ts` — `.data/` 상태 파일 공용 입출력 (아래)
- `server/auth.ts`, `server/authRoutes.ts` — 인증 (사용자·세션·로그인 라우트)
- `server/reqAuth.ts` — 요청별 인증 해석(`req.auth`)·역할/기능 게이팅 미들웨어
- `server/access-policy.ts`·`access-routes.ts`·`access-socket.ts` — [계정별 기능·파일 권한](access-control.md), 관리 API와 연결 재검증. `guestAccess.ts`는 기존 저장 형식의 호환 코드다.
- `server/usersCli.ts` — 승인 리스트 CLI
- `server/docsRepo.ts` — docs 폴더 가져오기/내보내기, `server/fsBrowse.ts` — 워크스페이스 밖 폴더 목록
- docs 전용 규칙(MOC 커버리지·archives 불변·링크 라벨 동기화)은 docs 프로젝트에만 적용된다.

## 서버 상태 파일 (`.data/`)

사용자·세션·계정별 기능/파일 권한·프로젝트 배치·터미널 버튼·숨김 목록·예약 작업이 여기 있다. JSON 상태는 `server/dataDir.ts`를 거쳐 읽고 쓴다. 대화 전사는 `server/agentTranscript.ts`의 SQLite 저장소를 사용하며 [대화 저장 계약](conversation-storage.md)을 따른다. 접속 기록은 `server/presence-history.ts`의 `presence/history.sqlite`에 영구 저장하며 [협업 저장 계약](collaboration.md#접속-기록일별-조회엑셀)을 따른다:

- **쓰기는 임시 파일 + rename**뿐이다. `writeFileSync`로 바로 쓰면 파일이 잠깐 0바이트가 되고, 그 순간 다른 프로세스가 읽으면 빈 값으로 오해한다.
- **읽기 실패를 빈 값으로 넘기지 않는다.** 파일이 없으면 `null`, 깨졌으면 사본(`*.corrupt-*`)을 남기고 던진다. 못 읽은 걸 `{}`로 보고 덮어쓰면 남아 있던 설정이 통째로 사라지기 때문 — 실제로 프로젝트 아이콘이 이 경로로 초기화됐었다.
- 위치는 `MEW_DATA_DIR`로 바꿀 수 있다. `npm test`가 이걸 임시 경로로 지정해 **테스트가 실제** `.data/`**를 건드리지 않게** 한다 (테스트는 프로젝트를 만들었다 지우면서 아이콘·배치를 함께 고친다).

## 프로젝트 아이콘 기준본

각 루트의 `.mew/project-icon.json`은 `{ "icon": "i:folder" }` 형태로 아이콘 값 하나를 저장한다. 기존 `svg:`·`svgt:`·이모지 표기를 그대로 지원하고 읽기·쓰기에서 공통 SVG 검증을 적용한다. `null`은 명시적 초기화이며 옛 값으로 되돌리지 않는다. 사이드바 목록·중첩 트리·루트 탭은 `server/projectIcons.ts`를 통해 같은 파일을 읽는다. 트리 구조 캐시도 응답 시 프로젝트 파일에서 아이콘을 다시 읽어 오래된 값을 유지하지 않는다. 파일·`.mew` 심볼릭 링크는 거부하고 손상된 파일을 덮어쓰지 않는다.

기존 `.data/project-icons.json`의 현재 루트 직계 프로젝트 값은 첫 조회 때 프로젝트 파일로 이관한 뒤 이전 키를 제거한다. 계정의 기존 탭 아이콘은 프로젝트 파일·사이드바 값이 없을 때만 초기값으로 이관한다. 이름만 같은 다른 루트에는 옛 사이드바 값을 적용하지 않는다. 조회할 수 없는 프로젝트는 기본 폴더 아이콘을 표시한다. 읽기·이관은 표시 시점에 이루어지므로 닫힌 프로젝트를 재귀 탐색하지 않는다.

Owner 전용 `POST /api/project-icons/read`는 절대경로 목록의 현재 아이콘을 읽고, `PUT /api/project-icons`는 `{ path, icon }`을 프로젝트에 저장한다. 기존 `/api/project-icon`도 같은 파일을 갱신한다. 계정의 루트 탭 저장에는 아이콘 내용을 더 이상 넣지 않는다. [ADR 0177](../../../.mew/docs/decisions/0177-mew-project-owned-icons.md)을 따른다.
## 계정별 활성 프로젝트

[ADR 0200](../../../.mew/docs/decisions/0200-mew-account-active-workspace.md)에 따라 마지막 활성 프로젝트는 `user-ui-state.json`의 계정별 `activeWorkspace`가 소유한다. `server/account-workspace.ts`는 인증된 계정의 루트를 읽고 `paths.ts`의 `AsyncLocalStorage` 컨텍스트에 요청 수명 동안 고정한다. `workspacePaths`와 `projectRoot` 등 경로 함수는 이 컨텍스트를 읽으며, 계정 없는 CLI·서버 초기화는 기존 서버 기본 루트를 사용한다. 저장값이 없거나 경로가 삭제되면 기본 루트로 복원한다.

`POST /api/workspace`, `/api/fs/open-project`, `/api/subprojects/open`은 기존 owner 권한을 유지하고 요청 계정의 루트만 저장한다. `workspace` presence 알림은 같은 인증 계정에만 전달한다. 서버 기본 루트·`MEW_WORKSPACE` 설정·다른 계정의 watcher·공동 편집 방은 바꾸지 않는다. 기존 에이전트 작업 경로는 고정된 채 유지하고 새 터미널의 기본 경로는 요청 계정의 루트를 따른다. Documents 폴더 설정은 기존처럼 프로젝트 설정 파일이 소유한다.

파일 카탈로그와 검색 상태·트리 감시자는 실제 프로젝트 경로, 검색 SQLite 핸들은 루트별 DB 경로로 분리한다. 프로젝트 WebSocket 연결은 연결 시 계정 루트를 사용하며 공동 편집 방은 서버 내부 키에 루트를 포함한다. 와이어의 `프로젝트:상대경로`와 서버 공통 메모 방은 유지한다. 같은 실제 루트를 보는 계정끼리는 공동 편집을 공유하며 다른 루트의 동명 파일과는 분리한다.
