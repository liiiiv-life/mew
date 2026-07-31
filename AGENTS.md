# mew

폴더 하나를 브라우저 작업공간으로 바꾸는 편집기. 최상위 하위 폴더 하나가 프로젝트 하나이고,
프로젝트는 **라우트가 아니라 탭**으로 오간다(주소는 항상 `/`).

**작업 전 [SECURITY.md](SECURITY.md)를 읽는다** — 역할·인증·게스트 경계가 거기 기준본이고,
코드(`server/reqAuth.ts`·`server/guestAccess.ts`·`server/paths.ts`)는 그것의 구현이다.
화면 구조·저장 키·API 계약은 [README.md](README.md).

이 레포에는 `README.md`·`AGENTS.md`·`CLAUDE.md`·`SECURITY.md` 외의 `.md`를 만들지 않는다.

## 이 레포에서만 참인 것

- **`npm run build`는 즉시 배포다** — 서버가 `dist/`를 디스크에서 읽어 서빙한다. 빌드하는 순간 띄워 둔 화면이 바뀐다. `server/`까지 고쳤으면 `./mew restart`가 따로 필요하다
- 검증: `npm test`(node:test) · `npm run lint`(oxlint) · `npx tsc -b`. 계정은 `./mew users`
- **권한 모델을 바꾸면 [SECURITY.md](SECURITY.md)를 같은 커밋에서 고친다.** 코드만 고치고 끝내지 않는다
- **설정·계정은 레포 밖에 산다** — `~/.config/mew/config.env`, `~/.local/share/mew/`. 경로 결정은 `server/config.ts` 한 곳이고, **진입점의 첫 import**여야 한다(뒤로 밀면 설정 파일의 `MEW_DATA_DIR`이 조용히 무시된다)

## 하지 말 것

- **에이전트 창을 재추가하거나 재조사하지 않는다.** 채팅 패널(agent-panel·`server/agent.ts`·`mcp.ts`)은 2026-07-25에 전부 제거했다 — 서버 프로세스 안에서만 SDK 첫 응답이 ~20초 멎어 "Failed to fetch"가 됐고, 원인을 못 잡아 접었다. 터미널이 그 자리를 대신한다
- **디스크→방 협업 브리지는 제거된 에이전트 창과 무관하다.** 터미널에서 고친 `.md`가 열려 있는 Yjs 방에 `agent` 커서로 실시간 주입되는 정상 기능이니 지우지 말 것. `appWrites` 메아리 원장이 사용자의 정상 타이핑을 보호한다
- **`WORKSPACE_ROOT`를 고정 경로로 되돌리지 않는다.** `MEW_WORKSPACE`가 있으면 그걸 쓴다(`server/paths.ts`) — 앱과 워크스페이스를 떼어놓을 수 있어야 컨테이너·다른 폴더 배포가 성립한다
- **대상 프로젝트를 모듈 상수로 되돌리지 않는다.** `api/client.ts`의 `getProject()`는 런타임 값이다 — 전환보다 오래 사는 비동기 작업(자동저장 디바운스 등)은 자기 프로젝트를 인자로 들고 다녀야 다른 프로젝트의 같은 이름 파일을 덮어쓰지 않는다
- **에디터 입력 감지에 `keydown`을 쓰지 않는다.** `@`·`/` 감지는 `onUpdate`/`onSelectionUpdate` 트랜잭션 기반으로 한다 — keydown 스페이스 트리거는 모바일에서 조용히 실패한다(`SlashMenu.tsx`가 현재 구현)
- **콘텐츠 시딩은 반드시 `SEED_ORIGIN` 트랜잭션으로 감싼다.** 감싸지 않으면 시딩이 사용자 undo 스택에 잡혀 Ctrl+Z 한 번에 문서 전체가 사라진다(`Editor.tsx`)
- **팝업·모달·드롭다운을 새로 만들면 `useOverlayDismiss(onClose)`를 부른다.** 등록하지 않으면 안드로이드 뒤로가기가 그 팝업 대신 뒤의 터미널·사이드바를 닫는다

## 사용자가 편집기를 열어둔 채일 때

터미널로 파일을 고쳤는데 다음 턴에 통째로 원복돼 있으면, 사용자가 그 파일을 에디터에 열어둔 상태라
버퍼 저장이 디스크를 덮어쓴 것이다. 반영 여부를 다시 확인하고, 해당 파일을 닫거나 Revert File 하도록
안내한다.
