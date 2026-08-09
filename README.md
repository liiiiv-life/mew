# mew

내 컴퓨터의 **폴더 하나를 브라우저 작업공간으로** 바꾸는 편집기. 그 폴더의 최상위 하위 폴더 하나가
프로젝트 하나가 되고, 마크다운·코드 편집, 파일 트리, 전문 검색, git 커밋, 실시간 협업, 터미널(tmux),
계정 없는 사람에게 주는 열람 링크가 한 화면에 있다. 모바일에서도 쓰도록 만들어져 있다.

```bash
git clone <이 레포> mew && cd mew
./mew setup
```

`setup`은 필요한 것(Node·빌드 도구·tmux)을 확인하고, 편집할 폴더와 포트를 물어보고, 빌드한 뒤
첫 계정을 만들어 임시 비밀번호를 알려준다. 다시 돌려도 안전하다. 권한 모델과 노출 시 주의는
**[SECURITY.md](SECURITY.md)** — 계정 하나를 주는 것이 어디까지를 주는 것인지 먼저 읽는다.

**이 폴더에는 아무것도 저장되지 않는다.** 설정은 `~/.config/mew/config.env`, 계정·세션은
`~/.local/share/mew/`, 로그는 `~/.local/state/mew/`에 산다(`server/config.ts`). 클론을 지워도
데이터는 남고, `git pull`이 곧 업데이트다.

```bash
./mew start | stop | restart   # 서버
./mew status                   # 지금 뭐가 어디에 있는지
./mew logs                     # 로그 따라가기
./mew update                   # git pull + 재빌드 + 재시작
./mew users add you@x.com owner
```

**MOC는 파일명으로 목록에 섞이지 않는다** — `MOC.md`·`_MOC.md`(둘은 같은 것)는 파일 목록에서 빠지고,
대신 **자기 폴더를 펼쳤을 때 맨 첫 줄**에 지도 아이콘 + `Map Of Contents`로 고정된다. 프로젝트 루트의
MOC는 담을 폴더가 없으니 트리 전체의 맨 위, 어떤 폴더보다 앞에 같은 모양으로 선다.
판별은 파일명뿐이라 프로젝트를 가리지 않는다.

## 프로젝트 탭

워크스페이스의 최상위 폴더 하나가 프로젝트 하나다(ai, med-gen, server …). **라우트는 없다** — 주소는
항상 `/`이고 프로젝트 전환은 페이지 이동이 아니라 탭 전환이다.
옛 `/{프로젝트}` 주소로 들어오면 그 프로젝트로 시작한 뒤 주소만 `/`로 정리한다.

**docs는 프로젝트가 아니다** — 워크스페이스에 하나뿐인 특별 레포이고 `<워크스페이스>/.mew/docs`에 산다.
아래 §docs 탭.

화면 맨 위는 **한 줄**이다(`App.tsx`) — **프로젝트 탭 + 도구 버튼**. 그 아래가 사이드바 · 편집 칸 ·
터미널이고, **문서 탭 줄은 전폭이 아니라 편집 칸 안에 있다**(아래 §편집 칸). 칸을 나누면 탭 줄도
같이 나뉜다.

- **볼 수 있는 프로젝트는 전부 탭으로 서 있다.** 닫기(×)는 없고, 순서는 팝업 격자에서 끌어 정한
  자리(slot)다. 프로젝트 탭 줄은 "열어둔 것 목록"이 아니라 워크스페이스의 지도다.
- 생김새는 문서 탭 줄과 같다 — 테두리 없이 세로 구분선만, **선택된 탭은 배경만 밝아진다.**
  데스크톱은 아이콘+이름, 모바일은 아이콘만 — 단 **보고 있는 탭은 모바일에서도 이름을 편다**
  (아이콘만 늘어선 줄에서 지금 어디인지 알 수 있어야 한다).
- **그냥 누르면** 그 프로젝트를 연다. 단 **모바일에서 지금 보고 있지 않은 탭은 두 번 눌러야 한다** —
  아이콘만 보이는 탭이라 무엇을 누르는지 모른 채 프로젝트가 바뀌지 않게, 첫 탭은 탭 아래에 이름표를
  띄운다(`ProjectPeek`). 이름표에는 **이름 + 그 프로젝트의 ▶**가 있어, 프로젝트를 바꾸지 않고도 명령을
  돌릴 수 있다. 이름표나 같은 탭을 한 번 더 누르면 그때 옮겨 간다. 데스크톱은 그대로 한 번에 열린다.
- **꾹 눌렀다 떼거나(모바일) 우클릭하면** 프로젝트 격자 팝업이 뜬다
  (아이콘 지정 · 자리 배치 · 생성 · 개명 · 삭제). 팝업에서 고르면 그 프로젝트가 열린다 —
  페이지는 이동하지 않는다. **팝업으로 가는 입구는 이 제스처뿐이다.**
- **꾹 누른 채 좌우로 끌면 탭 순서가 바뀐다**(데스크톱은 그냥 끌면 된다). 끄는 동안 탭 줄 좌우
  가장자리에 닿으면 **줄이 저절로 굴러간다** — 화면 밖 자리로 옮길 때 놓았다 스크롤했다를 반복하지
  않아도 된다. 문서 탭 줄과 같은 훅(`@mew/ui`의 `useDragReorder`)을 쓰고, 바뀐 순서는 **팝업 격자의 자리(slot)로 그대로 저장된다** —
  탭 줄과 격자는 같은 값 하나를 본다(`utils/projectLayout.ts`). 쓰이는 칸은 그대로 두고 주인만 바꾸므로
  격자에 일부러 비워둔 자리는 유지된다. 저장은 손을 뗄 때 한 번(PUT `/api/project-layout`, 게스트는 불가).
- 각 프로젝트 탭 오른쪽에는 **그 프로젝트의 명령어 버튼(▶)** 이 붙는다. 모바일은 탭이 좁아 ▶가
  **지금 보고 있는 탭에만** 뜬다.
- 문서 탭·활성 탭·**칸 배치**·내용 캐시는 **프로젝트별로 따로** 산다. 옮겼다 돌아오면 그대로다.
  **스크롤 위치는 활성 문서가 바뀔 때마다 복원**된다 — 새로고침·재시작([ADR 0038](../.mew/docs/decisions/0038-mew-scroll-restore-on-reload.md))과
  탭·창 전환([ADR 0039](../.mew/docs/decisions/0039-mew-scroll-restore-on-tab-switch.md)) 모두. 저장·복원은
  `src/utils/scrollMemory.ts`·`EditorPane.tsx` 한 쌍이 전부다(`mew:scroll:{프로젝트}`, 문서당 하나) —
  `packages/editor`에 prop을 뚫거나 별도 메커니즘을 만들지 않는다. 옛 [ADR 0029](../.mew/docs/decisions/0029-mew-drop-scroll-position-restore.md)의
  전환 복원 금지는 해제됐다.
- 아이콘은 팝업에서 지정한다(라인 아이콘 600여 개 + 이모지 직접 입력 + SVG, 영문 키로 검색). 아이콘이
  없으면 이름 첫 글자가 대신 뜬다.

화면 상태는 `localStorage`에 남는다 — `mew:project`(활성 프로젝트) · `mew:tmux-open` ·
`mew:open-tabs[:{프로젝트}]`(열린 문서 탭 + 칸 배치 — `{ panes, layout, focusedPaneId }`.
칸이 없던 옛 `{ tabs, activePath }`는 읽을 때 `main` 칸 하나로 이관한다) ·
`mew:scroll:{프로젝트}`(문서별 스크롤 위치, `utils/scrollMemory.ts`).

클라이언트에서 대상 프로젝트는 **모듈 상수가 아니라 런타임 값**이다(`api/client.ts`의
`getProject()`/`setProject()`). 전환보다 오래 사는 비동기 작업(자동저장 디바운스, 탭 복원)은 이 값을
믿지 말고 자기 프로젝트를 인자로 넘긴다 — `useTabs`가 그렇게 되어 있다.

**헤더 오른쪽 도구 뭉치**(전부 아이콘): 커밋(Ctrl+S) · 계정 관리(owner) · 데이터베이스(로그인 사용자) ·
설정(=내 계정 동그라미) · 로그인(게스트). 왼쪽은 프로젝트 탭이 다 쓰므로 버튼은 오른쪽에 몰려 있다 —
예외는 **사이드바 여는 버튼** 하나로, 사이드바가 닫혔을 때만 그 자리(맨 왼쪽) 위에 뜬다.
여는 파일 경로·저장 상태 같은 **글자는 여기 두지 않는다** — 지금 무엇을 보고 있는지는 문서 탭 줄이
말한다. 커밋 실패만 커밋 버튼 옆에 빨간 글씨로 남는다.

**아이콘은 한 벌이다.** 프로젝트 아이콘과 터미널 명령어 버튼은 같은 목록·같은 표기·같은 고르는 칸을
쓴다 — 값은 `i:{키}`(라인 아이콘) · 이모지 문자 · `svg:{마크업}`(`utils/projectIcons.ts`),
고르는 칸은 `components/IconPicker.tsx`, 그리는 것은 `components/ProjectIcon.tsx`,
서버 검사는 `server/svgIcon.ts`의 `normalizeIconValue` 하나다. 한쪽에만 기능을 붙이지 않는다.

**SVG 직접 넣기**: 목록에 없는 아이콘(회사 로고 등)은 `SVG 직접 넣기`에 코드를 붙여넣거나 `.svg`
파일을 고르면 된다. **SVG가 들고 있는 색은 언제나 버린다** — 모양만 CSS 마스크로 떠서 라인 아이콘과
똑같은 테마 색(currentColor)으로 칠한다. 로고마다 흰색·미색이 제각각이면 탭 줄이 얼룩덜룩해지고
단색 아이콘은 밝은·어두운 테마 한쪽에서 묻히기 때문이라, 색을 살리는 선택지는 두지 않는다.
(옛 `svgt:` 접두사로 저장된 값도 지금은 `svg:`와 똑같이 그린다.)
마스크로만 그리므로 그 안의 스크립트·외부 참조는 실행되지 않는다. 저장할 때 서버가 한 번 걸러서,
스크립트·이벤트 핸들러·외부 URL·DOCTYPE이 들어 있거나 16KB를 넘으면 **저장을 거부하고 이유를
알려준다**(조용히 지우지 않는다).

## docs 탭

docs는 워크스페이스에 **하나뿐인 특별 레포**다 — 프로젝트가 아니다. 폴더는 `<워크스페이스>/.mew/docs`에
있고, 없으면 서버가 **빈 폴더로 만든다**(`server/paths.ts`의 `ensureDocsRoot`). 새 워크스페이스는 빈 docs로 시작한다.

- 프로젝트 목록(`GET /api/projects`)에 **없다**. `listProjects()`가 걸러내고,
  `isValidProjectName('docs')`가 false라 같은 이름의 프로젝트를 만들 수도 없다(만들면 이름이 겹친다).
- **내부 이름은 그대로 `docs`다.** 문서·트리·검색·협업 방 키(`프로젝트:경로`)·git·명령어 버튼이 전부
  프로젝트 이름으로 도는 구조라, 경로만 `projectRoot('docs')`에서 꺾는다. 이름을 바꾸지 말 것 —
  바꾸면 열린 방·저장된 탭·`.data/` 키가 통째로 어긋난다.
- 탭은 **프로젝트 탭 줄 맨 왼쪽에 고정**이다(`components/DocsTab.tsx`). 끌 수 없고, 순서를 바꿀 수 없고,
  이름이 없고(아이콘만, `i:notes` 고정), **프로젝트 격자 팝업에 나오지 않는다**.
- **꾹 누르거나 우클릭하면** 가져오기/내보내기 창(`components/DocsSettingsModal.tsx`) — owner 전용.
  - **가져오기**: 고른 폴더의 내용으로 docs를 덮어쓴다. **기존 내용은 전부 지워진다** — 폴더를 고른 뒤
    경고 확인을 한 번 더 받는다.
  - **내보내기**: docs 폴더를 고른 위치 아래 `docs`로 그대로 복사한다. 같은 이름이 이미 있으면 거부한다.
- 폴더를 고르는 창은 네이티브 대화상자가 아니라 서버가 목록을 내려주는 컴포넌트다
  (`components/FolderPicker.tsx` ← `GET /api/fs/dirs`). 브라우저는 서버가 도는 기계의 파일시스템을 볼 수 없다.

| 라우트 | 역할 | 하는 일 |
|---|---|---|
| `GET /api/fs/dirs?path=` | **owner** | 그 폴더의 하위 폴더 목록. **워크스페이스 경계 밖을 그대로 보여준다 — 역할을 낮추지 말 것** |
| `POST /api/docs/import` `{path}` | **owner** | docs를 통째로 갈아끼운다(되돌릴 수 없음) |
| `POST /api/docs/export` `{path}` | **owner** | `{path}/docs`로 복사 |

각 레포의 `AGENTS.md`가 가리키는 docs 경로도 이 이동을 따라 `../.mew/docs`(워크스페이스 루트에서는
`.mew/docs`)다.

## 편집 칸 (문서 탭 · 화면 분할)

편집 영역은 **칸(pane) 하나 이상**이다. 칸 하나가 `EditorPane.tsx` 하나고, 칸마다 **자기 문서 탭 줄 ·
자기 도구 줄 · 자기 Yjs 협업 세션**을 들고 있다. 배치는 나무다(`utils/paneTree.ts`):

```ts
type PaneNode = { kind: 'leaf'; pane: string } | { kind: 'split'; dir: 'row' | 'col'; kids: PaneNode[] }
```

- **문서 탭을 끌어다 놓으면 갈라진다.** 놓는 자리는 칸 넓이·높이의 **가장자리 30%**로 정해진다
  (`dropZoneAt`) — 오른쪽 30%면 오른쪽에, 아래 30%면 아래에 새 칸이 생기고 그 탭이 거기로 간다.
  **가운데면 분할 없이 그 칸으로 옮기기**만 한다. 끄는 동안 놓일 자리가 반투명으로 미리 보인다.
- **사이드바에서 파일을 끌어 가장자리에 놓아도 같은 규칙으로 갈라진다** — 새 칸에 그 파일이 열린다.
  가운데는 분할이 아니라 경로 텍스트 삽입이다("사이드바 항목 끌어놓기" 절).
- **분할 자리를 재는 대상은 칸의 본문 영역뿐이다** — 탭 줄은 뺀다. 넣으면 자기 줄 안에서 순서만
  바꾸는 동안에도 "위로 분할" 미리보기가 번쩍인다.
- **다른 칸의 탭 줄에 놓으면 그 칸으로 옮겨진다**(가장자리를 따지지 않고 언제나 옮기기, 맨 뒤에 붙는다).
  제 칸의 탭 줄은 순서 바꾸기이므로 드롭 자리로 치지 않는다(`App.tsx`의 `dropTargetAt`).
- **그 칸의 유일한 탭을 자기 칸 가장자리에 놓는 것은 무시한다** — 갈라도 옮기기 전과 같은 화면이다.
- 같은 방향 분할은 **중첩하지 않고 형제로 편다**(`splitLeaf`). 칸 크기는 **언제나 균등**이다 —
  크기 값도 끌어서 조절하는 손잡이도 없다.
- 칸이 비면(마지막 탭을 닫으면) **저절로 접히고** 나무도 같이 줄어든다(`removeLeaf`·`prunePanes`).
  마지막 한 칸은 비어도 남아 안내문을 띄운다.
- **초점 칸(focused pane)**이 키보드 단축키·검색·기록 되돌리기·터미널 선택 붙여넣기의 대상이다.
  칸 아무 데나 누르면(`onPointerDownCapture`) 초점이 옮겨 가고, 초점 없는 칸의 탭 줄은 흐려진다.
  `useTabs`가 내주는 `tabs`/`activePath`/`activeTab`은 **초점 칸의 것**이다.
- **내용 캐시·자동저장은 칸이 아니라 경로 기준**이다. 같은 파일을 두 칸에 열면 같은 내용을 본다.
- 터미널·시스템 자원 버튼은 **맨 마지막 칸의 도구 줄에만** 붙는다(`showGlobalTools`). 칸마다 달면
  같은 버튼이 여러 개 선다.
- 협업 참여자 표시(presence)가 서버에 알리는 파일은 **초점 칸의 것 하나**다 — 다른 칸에 열어둔 문서는
  남에게 "보고 있는 중"으로 보이지 않는다.

## 실행

```bash
npm run dev     # 4999 — 개발 (vite HMR)
npm run build   # tsc + vite build → dist/
npm run serve   # 5000 — dist/ 필요
npm start       # build + serve
npm test        # node:test
npm run lint    # oxlint
npx tsc -b      # 타입만 (빌드 없이)
```

⚠️ **`npm run build`는 즉시 배포다** — 서버가 `dist/`를 디스크에서 읽어 서빙하므로, 빌드하는 순간
띄워 둔 화면이 바뀐다. `server/`까지 고쳤으면 build 후 프로세스 재시작이 따로 필요하다
(`./mew restart`).

**터미널에서 이 레포 파일을 고쳤는데 다음에 보니 되돌아가 있으면**, 사용자가 그 파일을 mew
에디터에 열어둔 채라 버퍼 저장이 디스크를 덮어쓴 것이다. 반영 여부를 다시 확인하고, 해당 파일을
닫거나 Revert File 하도록 안내한다.

### 설정

설정 파일은 **레포 밖**에 있다 — `~/.config/mew/config.env`(`XDG_CONFIG_HOME` 존중). 레포 안의
`.env`가 있으면 그것이 마지막에 덮으므로 개발 중 임시 덮어쓰기로 쓴다. 읽는 순서와 기본 경로는
`server/config.ts` 한 곳이 정한다 — **진입점의 첫 import여야 한다.** 뒤로 밀리면 `MEW_DATA_DIR`
같은 값이 다른 모듈이 이미 읽어 버린 뒤라 조용히 무시된다.

| 변수 | 기본값 | 무엇 |
| --- | --- | --- |
| `MEW_WORKSPACE` | 앱 폴더의 부모 | 프로젝트들이 사는 폴더. `server/paths.ts`의 `WORKSPACE_ROOT`를 고정 경로로 되돌리지 않는다 — 앱과 워크스페이스를 뗄 수 있어야 컨테이너·다른 폴더 배포가 성립한다 |
| `MEW_DATA_DIR` | `~/.local/share/mew` (옛 설치의 `<앱>/.data`가 있으면 그것) | 계정·세션·게스트 규칙·아이콘 |
| `MEW_TEAM_PORT` | 5000 | 서버 포트 |
| `MEW_COLLAB_RUST` | 없음(=JS Yjs) | `1`이면 협업 방 상태를 Rust(yrs)로 — 먼저 `npm run build:native` (아래 §협업 방) |
| `DATABASE_URL` | 없음 | `/db`용 Postgres. 없거나 접속 불가면 `/db` API만 503 |
| `R2_*` | 없음 | 미디어 업로드(S3 호환). 없으면 업로드 기능만 꺼진다 |

전부 선택이다 — 하나도 없어도 뜬다. 지금 값이 어디서 오는지는 `./mew status`.

### 컨테이너로 띄우기 (선택)

서버·VPS용 경로다. 자기 컴퓨터에서는 `./mew setup`(네이티브)이 낫다 — **컨테이너 안 터미널에는
당신의 개발 도구가 없다.**

```bash
docker compose --profile app up -d --build   # 앱 + Postgres
```

`MEW_WORKSPACE_HOST`(기본: 이 레포의 부모) · `MEW_PORT` · `MEW_BIND` · `MEW_UID`/`MEW_GID`를
`.env`로 준다. `npm run db:up`은 같은 파일에서 Postgres만 띄우는 것이라 서로 간섭하지 않는다.

### 사용자 관리 (호스트에서)

```bash
npm run users -- add <email> [role]   # 임시 비밀번호 발급 — 첫 로그인 때 변경 강제 (role 생략 시 member)
npm run users -- role <email> <role>  # 기존 계정의 역할 변경 (owner|manager|member)
npm run users -- reset <email>        # 임시 비밀번호 재발급 + 기존 세션 전부 무효화
npm run users -- remove <email>       # 삭제 (세션 즉시 무효화)
npm run users -- list
```

임시 비밀번호는 안전한 채널로 본인에게 전달한다. 최초 owner 계정은 이 CLI로만 만들 수 있다
(`npm run users -- add <email> owner`) — 이후로는 owner가 앱 내 설정 팝업에서 다른 계정의
역할을 바꿀 수 있다.

## /db 데이터베이스

에디터에서 `/db`를 치면 노션식 표 데이터베이스를 삽입한다 (v1은 표 보기만). 본문에는 참조
id만 저장되고(`<div data-mew-db="uuid">`), 실제 데이터는 **Postgres가 SSoT**다.

- **컬럼 타입**: 텍스트 · 숫자 · 체크박스 · 날짜. 열 헤더의 `+`로 추가하고, 헤더를 눌러 이름을 바꾼다.
- **실시간 협업**: 행·셀·열·제목 변경이 인프로세스 허브를 거쳐 WS로 같은 DB를 보는 모든 세션에 즉시 방송된다.
- **참조(뷰 전용)**: `/db 참조`로 기존 데이터베이스를 읽기 전용 뷰로 삽입하거나, 외부 Postgres
  테이블(`schema.table`)을 `external`로 붙일 수 있다. 참조 노드는 절대 원본을 수정하지 않는다.
- **프로젝트 격리**: 물리 테이블은 프로젝트별 스키마 `mew_{프로젝트}`에, 메타데이터(제목·컬럼)는
  카탈로그 스키마 `mew`에 저장된다. 다른 프로젝트의 dbId로는 조회조차 되지 않는다.
- **전체 DB 팝업**: 헤더의 원통 아이콘(설정 옆, 로그인 사용자 전용)을 누르면 이 프로젝트의 모든
  데이터베이스를 한 팝업에서 골라 열람·편집한다 (에디터 노드와 같은 표를 재사용).

```bash
npm run db:up     # docker-compose로 Postgres 기동 (127.0.0.1:55432, 외부 미노출)
npm run db:down   # 중지
```

접속 정보는 `.env`의 `DATABASE_URL`로 준다(`.env.example` 참고). `DATABASE_URL`이 없거나
접속 불가면 `/db` API는 503을 반환하고, 통합 테스트는 통째로 skip된다 (에디터의 나머지 기능은 정상 동작).

### 보안

- 모든 값은 파라미터(`$1`)로, 모든 식별자는 앱이 생성하거나 화이트리스트 검증(`[a-z0-9_]+`) 후
  쿼팅한다 (`server/db/identifiers.ts`) — SQL 인젝션 차단.
- external(참조) 테이블은 **읽기 전용**이다. 원본 테이블에 대한 INSERT/UPDATE/DELETE/DDL은 일절 없다.
- `/db`의 모든 REST·WS는 마운트 시 `requireAuthenticated`라 **게스트는 행 데이터를 받지 못한다**.
- 백엔드 계층: `pool → identifiers → schema → catalog → databaseService → hub`,
  REST는 `server/db/routes.ts`, 실시간 릴레이는 `server/db/socket.ts`.

보안 경계를 구현하는 지점: `server/guestAccess.ts`(게스트 파일 단위 승인), `server/paths.ts`(deny 목록),
`server/reqAuth.ts`(역할 게이팅). **정책 자체는 [SECURITY.md](SECURITY.md)가 기준본**이고,
여기 코드는 그것의 구현이다 — 정책을 바꾸면 docs를 같은 세션에 고친다.

## 명령어 버튼 — 두 종류

이름이 비슷하지만 별개 기능이다. 프로젝트 탭의 ▶는 **프로젝트별 배치 실행**, 터미널 줄의 버튼은
**지금 보고 있는 세션에 타이핑**이다.

| | 프로젝트 탭 ▶ 버튼 | 터미널 버튼 |
|---|---|---|
| 설정 파일 | `<프로젝트>/.mew/cmd-button.json` | `.data/term-button.json` (**전역** — 모든 프로젝트·탭 공통) |
| 편집 방법 | UI의 `＋ 명령 추가`·줄 꾹 누르기(우클릭), 또는 파일 직접 편집 | UI의 `+`·버튼 꾹 누르기(우클릭) |
| 실행 위치 | 전용 숨김 세션 `mewcmd-<해시>` | 지금 열려 있는 tmux 세션 |
| 실행 주체 | 서버(`tmux send-keys`) | 클라이언트(터미널 WebSocket에 직접 타이핑) |

### 프로젝트 탭 ▶ 버튼 (.mew/cmd-button.json)

프로젝트 탭 오른쪽의 ▶ 아이콘 = 그 프로젝트의 명령어 버튼. 각 프로젝트의 `.mew/cmd-button.json` 에
정의한 명령을 tmux에서 바로 실행한다 (owner/manager 전용 — tmux와 같은 보안 경계).
탭마다 자기 목록을 보므로 **다른 프로젝트의 명령도 프로젝트를 옮기지 않고 실행할 수 있다.**

파일 형식:

```json
{
  "commands": [
    { "name": "빌드", "command": "npm run build" },
    { "name": "개발 서버", "command": "npm run dev" }
  ]
}
```

- ▶ 아이콘을 누르면 그 명령이 **프로젝트 폴더를 cwd로** 하는 tmux 세션에서 실행된다. 같은 버튼은
  늘 같은 세션(`mewcmd-<해시>`)으로 이어져, 다시 누르면 그 세션에서 재실행된다.
- **실행 중인 줄의 ▶는 ■(정지)가 된다** — 누르면 그 명령의 세션만 죽는다(`DELETE /api/tmux/sessions/:name`).
  실행 여부는 서버가 붙여주는 `running`이 정하므로, 다른 곳에서 세션이 죽으면 다음 갱신에 ▶로 돌아온다.
- 명령어 세션은 특수 이름(`mewcmd-*`)이라 **터미널 탭 목록에는 뜨지 않는다**(`isCommandSession`
  으로 필터). 각 줄의 터미널 아이콘을 누르면 팝업으로 그 세션을 본다 — 팝업의 **[종료]**는 세션을
  죽이고 닫고, **[닫기]**는 세션을 살려둔 채 팝업만 닫는다.
- **실행할 명령 문자열은 언제나 서버가 파일에서 읽는다** — 실행 요청 본문의 명령은 신뢰하지 않는다.
  (편집은 별도 경로다: `PUT`으로 목록을 통째로 저장하면 그 다음 실행이 새 파일 내용을 읽는다.)
- 편집: 드롭다운 맨 아래 `＋ 명령 추가`, 기존 줄을 **꾹 누르거나 우클릭**하면 수정·삭제. 저장은
  목록 전체 쓰기라 손으로 고친 파일과 같은 자리를 덮어쓴다(`{ "commands": [...] }` 형태로 정규화되고
  다른 최상위 키는 보존되지 않는다). **이름을 바꾸면 세션 이름 해시가 바뀐다** — 그전에 띄워둔
  실행 세션은 살아 있되 이 버튼에서는 더 이상 보이지 않는다.
- 이름은 프로젝트 안에서 겹칠 수 없다(겹치면 두 명령이 한 세션을 공유하게 되므로 400).
- 서버: `server/cmdButtons.ts`(파일 파싱·정규화·쓰기·세션 이름) + `GET/PUT/POST /api/cmd-buttons*`
  (owner/manager). 클라이언트: `src/components/CommandButtonMenu.tsx`·`SessionTerminalPopup.tsx`
  (세션 팝업은 예약 작업과 **같은 컴포넌트**를 쓴다 — 세션 이름·제목·실행 함수만 다르게 넘긴다).
  드롭다운은 탭 줄이 가로 스크롤 컨테이너라 잘리므로 **body로 포털해 fixed로** 띄운다 — 포털이라도
  React 트리에서는 탭 안이라, 탭을 여는 클릭·꾹 누르기·드래그 핸들러는 컨테이너가 아니라 **이름 버튼에만**
  건다(드래그가 자리를 재는 기준 `ref`만 ▶까지 포함한 탭 전체에 건다).

### 터미널 버튼 (.data/term-button.json)

터미널 패널 버튼 줄(선택 모드 버튼과 같은 줄) 왼쪽에 뜬다. 누르면 **지금 보고 있는 tmux 세션**에
하단 입력칸 전송과 똑같은 경로로 들어간다 — 명령을 타이핑한 뒤 조금 늦게 별도 Enter를 보내므로
Claude Code 같은 TUI의 슬래시 명령(`/clear`·`/model`)도 버튼 한 번으로 제출된다.

```json
{
  "commands": [
    { "name": "정리", "command": "/clear", "icon": "i:sparks" },
    { "name": "커밋", "command": "/commit", "icon": "i:git-commit", "iconOnly": true },
    { "name": "모델", "command": "/model" }
  ]
}
```

- 목록은 **전역 하나**다 — 프로젝트나 터미널 탭마다 다르지 않다. 그래서 프로젝트 폴더가 아니라
  서버가 `.data/`에 저장한다(`.data/`는 `paths.ts` deny 목록이라 편집 API로 열리지 않는다).
  손으로 고칠 파일이 아니라 **UI가 편집 수단**이다: `+`로 추가하고, 버튼을 꾹 누르면(데스크톱은
  우클릭) 이름·명령어·아이콘 수정과 삭제가 나온다.
- `icon`은 **프로젝트 아이콘과 같은 표기**다 — `i:{키}` · 이모지 · `svg:{마크업}`. 고르는 칸도 같은
  `IconPicker`라 SVG 직접 넣기까지 그대로 된다(검사는 `normalizeIconValue` 하나).
- `iconOnly: true`면 그 버튼은 **이름을 감추고 아이콘만** 그린다(버튼마다 따로 정한다 — 편집 창의
  `이름 숨기고 아이콘만 보이기`). 아이콘이 없으면 빈 칸이 되므로 무시하고 이름을 그대로 둔다.
- 실행은 서버가 하지 않는다. 클라이언트가 이미 열려 있는 터미널 WebSocket으로 직접 보내므로
  세션·cwd가 화면과 항상 일치한다. 그 소켓 자체가 owner/manager 경계라 별도 게이팅이 없다.
- 서버: `server/termButtons.ts` + `GET/PUT /api/term-buttons`(owner/manager, 목록 읽기·쓰기만).
  클라이언트: `src/components/TermButtonBar.tsx` — `TmuxTerminalPanel`의 `renderCommandButtons`
  렌더 프롭으로 주입된다(터미널 패키지는 이 기능의 API를 모른다).

### 시스템 자원 팝업

에디터 우상단 도구 줄, **터미널 버튼 바로 아래 계기판 아이콘** — 서버가 도는 기계의 CPU·메모리·GPU
사용량과 온도, 그리고 **프로세스별 점유**를 2초마다 새로 읽어 보여준다. 터미널 버튼과 달리 터미널이
열려 있어도 계속 보인다.

- 서버: `server/sysStats.ts` + `GET /api/system-stats`(owner/manager — 셸과 같은 경계다).
  클라이언트: `src/components/SystemStatsModal.tsx`.
- CPU 사용률은 `os.cpus()` 누적 시간의 **직전 호출 대비 증분**이다. 표본을 모듈 하나가 들고 있어
  창이 여럿이면 각자의 구간이 짧아질 뿐 값은 유효하다.
- 메모리 여유는 `/proc/meminfo`의 `MemAvailable`을 쓴다 — `os.freemem()`은 캐시를 사용 중으로 세서
  리눅스에서 항상 과장된다.
- GPU는 `nvidia-smi --query-gpu=...` 한 번. 없으면 빈 배열이고 팝업은 "GPU 정보 없음"을 띄운다.
- CPU 온도는 `/sys/class/thermal/thermal_zone*/temp`. **WSL·컨테이너에는 노출되지 않아 `null`**이고,
  그때는 팝업이 그 사실을 한 줄로 알린다(GPU 온도는 `nvidia-smi`에서 따로 오므로 WSL에서도 뜬다).
- `processes[]`는 `/proc/<pid>/stat`을 직접 읽는다 — `ps %cpu`는 **프로세스 수명 전체의 평균**이라
  "지금 누가 먹고 있나"에 못 쓴다. CPU는 `utime+stime` tick의 직전 표본 대비 증분이고 코어 하나
  기준이라 100%를 넘을 수 있다. RSS·CPU·GPU가 모두 0인 항목(커널 스레드)은 빼고 보낸다.
  프로세스별 GPU는 `nvidia-smi --query-compute-apps`가 주는 **메모리(MB)뿐**이다 — 프로세스별
  GPU 사용률은 그 쿼리에 없다. `/proc`이 없는 환경(비리눅스)에서는 빈 배열.
- **추이 그래프는 클라이언트가 모은다** — 서버에 링버퍼가 없다. 팝업이 열려 있는 동안 최근 60표본
  (2분)을 들고 있다가 닫으면 버린다. 개별 프로세스 그래프도 이 이력에서 pid로 뽑는다.

### 예약 작업 (.data/schedules.json)

도구 줄 **시계 아이콘** — "언제 / 어느 폴더에서 / 어떤 에이전트로 / 어떤 프롬프트를" 을 등록하면 그
시각에 에이전트가 무인으로 돈다. owner/manager만(임의 프롬프트가 무인 실행되는 표면 — 셸과 같은 경계).

- 서버: `server/schedules.ts` + `GET/PUT /api/schedules`, `POST /api/schedules/run`(지금 실행).
  클라이언트: `src/components/ScheduleModal.tsx`, 크론식↔GUI 변환은 `src/utils/cron.ts`.
- **원본은 `.data/schedules.json`, crontab은 파생물이다.** 저장할 때마다 `# mew-job:<id>` 마커가 붙은
  줄만 걷어내고 다시 쓴다 — 손으로 쓴 크론 줄은 건드리지 않고, 창에도 읽기 전용으로 보여준다.
- **실행은 잡 전용 tmux 세션 안에서 일어난다.** 크론 줄이 하는 일은 세 가지뿐이다 —
  `tmux new-session -d -s <세션> -c <설정한 폴더>`(이미 있으면 실패시키고 그 세션을 재사용) →
  `send-keys -l <에이전트 명령>` → `send-keys Enter`. 명령어 버튼과 같은 구조라, 무인 실행이 끝난 뒤에도
  화면이 세션에 남아 각 줄의 **터미널 아이콘**으로 그대로 들여다볼 수 있다(같은 `SessionTerminalPopup`).
- 세션 이름은 `mewcmd-job-<id 앞 8자>`다. 명령어 버튼과 같은 프리픽스라 **터미널 탭 목록에는 뜨지
  않고**(`isCommandSession` 필터), 팝업의 **[종료]**는 그 세션을 죽인다(`DELETE /api/tmux/sessions/:name`).
  팝업 안의 **실행** 버튼과 `POST /api/schedules/run`은 크론과 **똑같은 세션·똑같은 명령**을 쓴다 —
  예약 시각을 기다리지 않고 확인할 수 있다. 실행 요청 본문에서 받는 건 잡 `id`뿐이다.
- **프롬프트는 셸에 인라인하지 않는다.** `.data/schedules/<id>.prompt`에 쓰고 명령이 그 파일을 읽는다
  — 따옴표·개행, 그리고 크론에서 stdin 구분자로 먹히는 `%`를 통째로 피한다(명령 쪽 `%`는 escape).
- 실행 명령은 에이전트별로 고정이다. 사용자가 명령 문자열을 넣는 곳은 없다:
  | 에이전트 | 세션에 타이핑되는 명령 |
  |---|---|
  | `claude` | `claude -p --dangerously-skip-permissions < <프롬프트파일> 2>&1 \| tee -a <로그>` |
  | `hermes` | `hermes --yolo -z "$(cat <프롬프트파일>)" 2>&1 \| tee -a <로그>` |
  무인 실행이라 둘 다 승인 우회 플래그가 붙는다. 바이너리(`tmux` 포함)는 저장 시점에 `command -v`로
  **절대 경로로 굳힌다** — cron의 PATH로는 이름만으로 못 찾는다.
- 크론 5필드는 `[A-Za-z0-9*/,-]`만 통과시킨다(crontab 주입 차단). 출력은 세션 화면에 보이면서 동시에
  `tee -a`로 `.data/schedules/<id>.log`에 덧붙고, 그 파일의 mtime이 창의 "마지막 실행"이다.
  **로그는 자동으로 줄지 않는다** — 커지면 직접 지운다.
- 앞 실행이 아직 돌고 있는데 다음 예약 시각이 오면 **같은 세션에 그대로 타이핑된다**(=돌고 있는
  에이전트의 stdin으로 들어간다). 주기를 실행 시간보다 짧게 잡지 말 것.
- 잡을 지우면 저장할 때 그 잡의 세션도 함께 죽인다 — 숨은 세션이라 UI 어디에서도 잡을 수 없기 때문.

### 숨김 목록 (.data/ignore.json)

파일 목록·검색·트리 감시에서 통째로 건너뛸 **이름** 목록. 경로가 아니라 이름이라 어느 깊이에 있든
그 이름의 폴더·파일이 사라진다(`dist` → 모든 프로젝트의 모든 `dist/`). 설정 창 → **숨김 목록**에서
고친다(owner/manager). 파일이 없으면 `server/ignoreList.ts`의 `DEFAULT_IGNORE`를 쓴다.

```json
{ "names": ["dist", ".next", "node_modules", ".git", ".data"] }
```

- 목록은 **전역 하나**다 — 프로젝트마다 다르지 않다. 그래서 `.data/`에 서버가 저장한다.
- `.git`·`node_modules`·`.data`는 `paths.ts`의 `DENY_SEGMENTS`가 API 계층에서 따로 막는다.
  목록에서 빼도 계속 안 보이므로, 저장할 때 서버가 도로 넣고 UI는 **고정**으로 표시한다 —
  지울 수 있는 것처럼 보이면 "지웠는데 왜 그대로냐"가 된다.
- 저장하면 서버가 감시자를 전부 접고(`resetTreeWatchers`) `tree` 신호를 보낸다. 살아 있는 감시자는
  옛 규칙으로 만든 트리 서명을 들고 있어 새 규칙을 "변화 없음"으로 흘려버리기 때문 — 접어두면
  클라이언트가 새 트리를 받아 갈 때(`GET /api/tree`) 새 규칙으로 다시 등록된다.
- `build/`는 기본 숨김이 **아니다**. 트리는 안의 APK/AAB만 노출하고 나머지·빈 폴더는 접으며
  (`tree.ts`의 `DOWNLOAD_ONLY_DIRS`), 감시는 숨김 목록과 별개로 `build`에 내려가지 않는다.
- **owner·manager의 트리에는 이 목록도 확장자 필터도 적용되지 않는다** — 있는 그대로 다 보인다.
  목록은 계속 살아서 member 이하의 트리와, 역할과 무관하게 **검색·트리 감시**에 적용된다.
  정책 기준본은 [SECURITY.md](SECURITY.md)이고,
  판정은 `server/tree.ts`의 `isPathVisible`과 `server/reqAuth.ts`의 `seesEveryFile` 둘뿐이다.
- 서버: `server/ignoreList.ts` + `GET/PUT /api/ignore`(owner/manager).
  클라이언트: `src/components/SettingsModal.tsx`의 `IgnorePanel`.

### 사이드바 항목 끌어놓기

파일·폴더를 끌면 **놓는 자리에 따라 뜻이 다르다**. 여러 뜻을 한 드래그에 담으려고 `@mew/ui`의
`pathDrag.ts`가 전용 MIME(`application/x-mew-path`)과 `text/plain` 양쪽에 경로를 싣고, 폴더는
`application/x-mew-dir`을 하나 더 실어 **값을 못 읽는 `dragover` 단계에서도 파일과 구분**되게 한다.

| 놓는 곳 | 결과 |
| --- | --- |
| 사이드바의 폴더 (빈 곳 = 프로젝트 루트) | 그 폴더로 **이동**(`POST /api/rename`) |
| 에디터 칸의 **가장자리 30%** (파일만) | 탭 드래그와 같은 규칙으로 **그 방향 화면 분할** + 새 칸에 그 파일이 열린다 |
| 에디터 Hotview·Plain (가운데) | 놓은 자리에 **경로 텍스트** 삽입 |
| 터미널 화면 | 셸에 그대로 **타이핑**(Enter는 보내지 않는다 — 명령을 완성하는 건 사용자다) |
| 터미널 하단 입력칸 | 커서 자리에 **경로 삽입**(선택 영역이 있으면 대체) |

가장자리 분할 가로채기는 `App.tsx`가 칸 컨테이너의 **캡처 단계** `dragover`/`drop`에서 한다
(`pathDropTargetAt`) — 가운데·폴더는 `preventDefault` 없이 흘려보내 아래 표의 원래 뜻을 지키고,
가장자리 드롭은 `stopPropagation`으로 끊어 ProseMirror의 경로 삽입이 뒤따르지 않게 한다.
새 칸은 `useTabs.splitEmptyPane`이 비워서 세우고 탭은 `openFile(paneId)`가 붙인다.

- **`dragover`에서는 `getData()`가 언제나 빈 문자열이다**(DataTransfer 보호 모드). 받는 쪽 판정은
  `hasPathDrag`(=`types` 검사)로 하고, 값 읽기(`pathFromDrag`)는 `drop`에서만 한다. 여기서 헷갈리면
  `preventDefault`를 못 해 드롭 자체가 발생하지 않는다.
- `effectAllowed`는 `copyMove`다 — `move`만 허용하면 `dropEffect='copy'`로 받는 에디터·터미널에서
  드롭이 통째로 거부된다. 트리 안 폴더는 자기 `dragover`에서 `move`를 명시해 원래 뜻을 지킨다.
- 에디터는 **전용 MIME이 있을 때만** 가로챈다. 바깥에서 끌어온 이미지·텍스트는 종전대로 업로드·삽입된다.

**바깥(파일 탐색기)에서 사이드바로 끌어놓기**는 반대 방향이다 — 놓은 폴더(빈 곳 = 프로젝트 루트)에
그 파일이 **그대로 저장된다**(`POST /api/upload-into`, multipart `file`·`destDir`). 판정은 `dataTransfer.types`에
`'Files'`가 있는지로 하고, 그때만 `dropEffect='copy'`가 된다. 이름이 겹치면 서버가 `이름 copy`로 비켜 쓰고,
여러 개를 놓으면 **순서대로** 올린다(동시에 보내면 같은 빈 이름을 함께 집는다). 에디터 본문 드롭이 R2 링크를
만드는 것과 달리 여기는 R2를 거치지 않는다 — 바이트를 프로젝트 폴더에 그대로 쓰고 git에 커밋한다.

### 표 열 너비 (.mew/table-layout.json)

Hotview에서 표의 세로선을 끌어 조절한 **열 너비**는 마크다운이 담지 못한다(HTML `<table>`로 쓰면
담기지만 plain 모드가 지저분해진다). 그래서 본문은 순수 md 표로 두고, 너비만 그 프로젝트의
`.mew/table-layout.json`에 문서 경로별로 저장한다.

```json
{
  "version": 1,
  "docs": {
    "ops/repos.md": [[220, 380, 160], null, [120, 120]]
  }
}
```

- 바깥 배열 = **그 문서 안 표의 등장 순서**, 안쪽 배열 = 그 표의 열 너비(px).
  `null`은 저장된 너비가 없는 표, `0`은 아직 끌지 않은 열이다.
- 표를 **추가·삭제·이동하면 순서가 밀려 너비가 어긋날 수 있다.** 다시 끌면 덮어써진다 —
  본문 md를 건드리지 않는 대가다.
- 복원은 본문 시딩 뒤에 한 번, `addToHistory: false`(collab이면 `SEED_ORIGIN`)로 들어간다.
  사용자의 undo 스택에 올라가면 Ctrl+Z 한 번에 너비가 통째로 되돌아가기 때문이다.
  **콘텐츠를 코드로 시딩하는 곳은 전부 이 규칙을 따른다** — `SEED_ORIGIN` 트랜잭션으로 감싸지 않으면
  시딩이 사용자 undo 스택에 잡혀 Ctrl+Z 한 번에 문서 전체가 사라진다(`Editor.tsx`).
- **불러오기에 실패하면 저장도 하지 않는다.** 못 읽은 것을 "너비 없음"으로 오해해 덮어쓰면
  저장돼 있던 값이 사라진다.
- 서버: `server/tableLayout.ts` + `GET /api/table-layout`(게스트는 보기 권한 필요)·
  `PUT /api/table-layout`(로그인 필요). 클라이언트: `packages/editor/src/Editor.tsx`의
  `readTableWidths`/`applyTableWidths`, 주입은 `EditorApi.fetchTableLayout`/`saveTableLayout`.

### 리스트 첫 항목 들여쓰기 (`- - b`)

Tab은 리스트 항목을 한 단계 들여쓴다. 기본 `sinkListItem`은 **바로 앞 형제 항목 안으로** 밀어 넣는
방식이라 앞에 형제가 없는 첫 항목에서는 아무 일도 하지 않는다. mew는 그 자리에 **자기 줄이 없는
부모 항목**을 만들어 들여쓴다 — 마크다운으로는 `- - b`, Shift+Tab이 그대로 되돌린다.

- 그래서 `listItem`의 content가 기본값 `paragraph block*`이 아니라 `(paragraph|bulletList|orderedList) block*`다
  (`packages/editor/src/editor/listIndent.ts`의 `IndentableListItem`). 문단이 필수면 markdown-it이
  중첩으로 읽어 준 `- - b`의 HTML을 항목 안에 넣지 못해 두 리스트로 풀려, 들여쓰기가 왕복에서 사라진다.
- **클라이언트(`Editor.tsx`)와 서버(`serverExtensions.ts`)가 같은 `IndentableListItem`을 써야 한다.**
  한쪽만 바꾸면 협업 병합에서 문서가 갈라진다. 그래서 정의는 한 모듈에만 둔다.
- 부모 마커 없는 `  - b`로는 저장할 수 없다 — 마크다운 규칙상 다시 읽으면 최상위 항목이 된다.

## 에이전트 창 (ACP)

헤더의 말풍선 버튼 — 프로젝트 하나에 묶인 AI 에이전트와 대화하는 **채팅 창**이다(터미널이 아니다).
에이전트는 별도 프로세스로 뜨고 [ACP](https://agentclientprotocol.com)(stdio JSON-RPC)로만 말한다.
mew 쪽에는 자체 어댑터 인터페이스가 없다 — ACP가 인터페이스다. 근거는
[ADR 0034](../.mew/docs/decisions/0034-mew-agent-panel-acp-reintroduction.md), 권한 경계는 [SECURITY.md](SECURITY.md).

⚠️ **`serve.ts` 요청 핸들러 안에서 에이전트를 직접 돌리지 않는다.** 2026-07-25에 지운 옛 에이전트
창은 Claude Code를 `-p --output-format json`으로, 즉 블로킹·비스트리밍으로 불러 첫 응답이 ~20초
멎었다. 지금 구현(child process + ACP 스트리밍, `server/agentAcp.ts`)이 그 문제를 푼 구조라 되돌리지
않는다.

- 서버: `server/agentAcp.ts`(세션·spawn·파일 스코프) + `server/agentWs.ts`(WS 릴레이) +
  `server/agentUsage.ts`(토큰 사용량). 클라이언트: `src/components/AgentPanel.tsx` +
  `src/utils/agentFold.ts`(이벤트→화면 항목). 접근은 **owner/manager**(`authorizeTmux`와 같은 집합) —
  에이전트는 Bash를 쓸 수 있어 tmux와 같은 경계여야 한다. 권한 모드 기본값이 `bypassPermissions`라
  (승인 프롬프트 없음) **이 역할 게이트가 유일한 통제다** — tmux보다 낮추면 무인 셸을 여는 것이다.
- 채널: `/api/agent/ws?project=<이름>` — 프로젝트당 **살아 있는 세션 하나**. 창을 닫아도 세션은 남고,
  다시 열면 **지나간 이벤트를 처음부터 되받아** 대화가 복원된다(붙은 창이 없는 채로 10분이면 종료).

| 방향 | 메시지 |
| --- | --- |
| 클라이언트 → 서버 | `{type:'prompt', text}` · `{type:'cancel'}` · `{type:'permission', id, optionId\|null}` · `{type:'set_model', modelId}` · `{type:'set_mode', modeId}` · `{type:'unqueue', index}` · `{type:'new_session'}` · `{type:'list_sessions'}` · `{type:'load_session', sessionId}` |
| 서버 → 클라이언트 | `{type:'ready'}` · `{type:'update', update}`(ACP `session/update` 원본) · `{type:'permission', id, toolCall, options}` · `{type:'permission_done', id}` · `{type:'turn_start'}` · `{type:'turn_end', stopReason}` · `{type:'error'\|'fatal', message}` · `{type:'models', models}` · `{type:'modes', modes}` · `{type:'meta', meta}` · `{type:'reset'}` · `{type:'sessions', sessions}` |

- **`meta`·`sessions`·`reset`은 이벤트 버퍼에 쌓지 않는다.** `meta`는 상태 스냅샷이라 붙을 때·바뀔 때
  통째로 보내고(`sessionId`·`startedAt`·`turns`·`busy`·`queued`·`usage`·`canLoad`·`canList`),
  `sessions`는 물어본 창에만 답한다. `reset`을 받은 창은 지금까지 그린 대화를 버린다.
- **진행 중에 온 `prompt`는 던지지 않고 줄을 세운다.** 턴이 끝나면 서버가 순서대로 이어 돌리고,
  `cancel`은 대기열도 함께 비운다.
- 새 세션(`/clear`)·불러오기(`/resume`)는 **ACP 메서드**(`session/new`·`session/list`·`session/load`)다.
  자식 프로세스는 그대로 두고 세션만 갈아끼운다. 버튼 노출 여부는 `initialize`의 capability로 정한다.
- **토큰 사용량만 ACP 밖에서 온다** — 어댑터가 사용량을 보내지 않아 `agentUsage.ts`가
  `<CLAUDE_CONFIG_DIR>/projects/<인코딩된 cwd>/<sessionId>.jsonl`을 읽는다. 읽기 전용·선택적이고,
  파일이 없으면 사용량 칸만 빈다([ADR 0036](../.mew/docs/decisions/0036-mew-agent-session-controls-and-usage.md)).

- **권한 모드 기본값은 `bypassPermissions`다**([ADR 0037](../.mew/docs/decisions/0037-mew-agent-bypass-permissions-default.md)).
  ACP 세션은 언제나 `default`로 시작하므로 서버가 `session/new`·`session/load` 뒤마다 다시 걸어 준다
  (`#applyDefaultMode`). 헤더 선택기로 턴마다 바꿀 수 있고, 서버 기본값은 `MEW_AGENT_MODE`로 바꾼다.
  모드 목록은 백엔드가 광고하는 것을 그대로 쓴다 — 광고에 없으면(예: root 실행) 조용히 넘어간다.
- 백엔드 교체는 **spawn 대상 교체**다: `MEW_AGENT_CMD`(기본 `node_modules/.bin/claude-code-acp`,
  버전 고정) · `MEW_AGENT_ARGS` · `MEW_AGENT_CONFIG_DIR`(→ 자식의 `CLAUDE_CONFIG_DIR`) ·
  `MEW_AGENT_MODE`(기본 `bypassPermissions`).
- **모델 목록은 CLI가 광고하는 것을 그대로 쓴다.** 어댑터가 번들한 CLI는 버전 핀에 묶여 목록이 낡으므로,
  PATH에 시스템 `claude`가 있으면 자동으로 그걸 쓴다(`CLAUDE_CODE_EXECUTABLE`로 전달, 이미 지정돼
  있으면 존중). 시스템 설치본이 없으면 번들 CLI로 돌아간다.
- 클라이언트 capability로 `fs.readTextFile`·`fs.writeTextFile`을 **켠다** — 켜야 에이전트의 파일
  읽기·쓰기가 mew로 돌아와 프로젝트 폴더 밖을 거부할 수 있다. `terminal`은 켜지 않는다.
- 자식 환경에서 **`CLAUDECODE`를 지운다.** 남아 있으면 Claude Code가 중첩 세션으로 보고 실행을 거부해
  세션 생성이 통째로 실패한다(mew 서버를 Claude Code 터미널에서 띄우면 상속된다).

## 구조

- `server/serve.ts` — 프로덕션 서버 (5000, 단일 포트)
- `server/plugin.ts` — vite dev 플러그인 (4999)
- `server/dataDir.ts` — `.data/` 상태 파일 공용 입출력 (아래)
- `server/auth.ts`, `server/authRoutes.ts` — 인증 (사용자·세션·로그인 라우트)
- `server/reqAuth.ts` — 요청별 역할 해석(`req.auth`)·역할 게이팅 미들웨어
- `server/guestAccess.ts` — 게스트 경로별 보기/편집 승인 규칙
- `server/usersCli.ts` — 승인 리스트 CLI
- `server/docsRepo.ts` — docs 폴더 가져오기/내보내기, `server/fsBrowse.ts` — 워크스페이스 밖 폴더 목록
- docs 전용 규칙(MOC 커버리지·archives 불변·링크 라벨 동기화)은 docs 프로젝트에만 적용된다.

### 협업 방 (Yjs 릴레이)

- `server/collab.ts` — 방·클라이언트·awareness·`/api/collab` 웹소켓. 방 하나 = `프로젝트:상대경로`
- `server/syncCodec.ts` — 프레임 인코딩/디코딩. **와이어 포맷이 코드 결합 계약이다**:
  바깥 varUint 채널(`0` sync · `1` awareness) + sync 안의 varUint 종류(`0` step1 · `1` step2 ·
  `2` update) + varUint8Array 본문. y-protocols와 바이트 단위로 같아야 하고
  `server/syncCodec.test.ts`가 그것을 대조한다 — 어긋나면 배포 순간 열려 있는 모든 탭이 조용히 깨진다.
  신뢰할 수 없는 바이트에는 던지지 않고 `null`을 준다
- `server/roomDoc.ts` — CRDT 백엔드 둘(JS Yjs · Rust yrs). 요구 면은 셋뿐:
  `stateVector()` · `encodeStateAsUpdate(sv?)` · `applyUpdate(update)`.
  `applyUpdate`는 **방이 새로 얻은 업데이트**를 돌려준다(없으면 `null`) — 브로드캐스트는 이 값으로
  한다. 상태 벡터 diff로 계산하면 삭제만 있는 업데이트가 빈 diff로 보여 사라진다
- `server/collabAgent.ts` — 디스크→방 브리지. **자기 Y.Doc + awareness를 들고 방의 `connect()`로
  붙는 인프로세스 클라이언트다** — 방의 doc을 붙들지 않는다(백엔드를 갈 수 없게 된다).
  루프백 소켓을 쓰지 않는 이유는 `authorizeCollab`(게스트 차단) 우회 통로를 뚫어야 하기 때문.
  터미널에서 고친 `.md`가 열려 있는 Yjs 방에 `agent` 커서로 실시간 주입되는 정상 기능이다 —
  2026-07-25에 지운 에이전트 창과는 무관하니 헷갈려서 지우지 말 것. `appWrites` 메아리 원장이
  사용자의 정상 타이핑을 보호한다
- 인증·`MAX_ROOMS`·awareness·방 수명은 백엔드와 무관하게 JS에 남는다. 방을 살려두는 것은 **실제
  접속자뿐**이다 — 브리지의 인프로세스 클라이언트를 세면 방이 영원히 닫히지 않아 헤드리스
  에디터와 fs watcher가 쌓인다

Rust 백엔드는 선택이고 기본은 꺼져 있다([ADR 0035](../.mew/docs/decisions/0035-mew-collab-rooms-rust-yrs.md)):

```bash
npm run build:native        # native/collab (cargo, napi-rs) → native/collab/mew-collab.node
MEW_COLLAB_RUST=1 npm run serve
```

`.node`는 플랫폼별 산물이라 커밋하지 않는다. `MEW_COLLAB_RUST=1`인데 로드가 실패하면 **조용히 JS로
돌지 않고 던진다** — 어느 구현이 도는지 모르는 상태가 협업 경로에서 제일 위험하다.

### 서버 상태 파일 (`.data/`)

사용자·세션·게스트 규칙·프로젝트 아이콘·프로젝트 배치·터미널 버튼·숨김 목록·예약 작업이 여기 있다. 전부
`server/dataDir.ts`를 거쳐 읽고 쓴다:

- **쓰기는 임시 파일 + rename**뿐이다. `writeFileSync`로 바로 쓰면 파일이 잠깐 0바이트가 되고,
  그 순간 다른 프로세스가 읽으면 빈 값으로 오해한다.
- **읽기 실패를 빈 값으로 넘기지 않는다.** 파일이 없으면 `null`, 깨졌으면 사본(`*.corrupt-*`)을
  남기고 던진다. 못 읽은 걸 `{}`로 보고 덮어쓰면 남아 있던 설정이 통째로 사라지기 때문 —
  실제로 프로젝트 아이콘이 이 경로로 초기화됐었다.
- 위치는 `MEW_DATA_DIR`로 바꿀 수 있다. `npm test`가 이걸 임시 경로로 지정해 **테스트가 실제
  `.data/`를 건드리지 않게** 한다 (테스트는 프로젝트를 만들었다 지우면서 아이콘·배치를 함께 고친다).

## 패키지 (npm workspaces)

재사용 가능한 부분은 `packages/*`의 소스 패키지로 분리되어 있다 (빌드 없음 — vite·node가
소스를 직접 소비). 컴포넌트는 fetch 경로·인증을 모르고, 호스트 앱이 `api` prop으로
서버 연동을 주입한다 (앱 쪽 구현은 `src/api/client.ts`).

- `@mew/editor` — TipTap 마크다운 에디터(`Editor`). frontmatter 패널·표·링크/멘션 툴팁·
  미디어 업로드 포함. `EditorApi`(fetchFile·uploadAsset·fetchLinkPreview) 주입.
  fuzzy 검색·frontmatter 유틸도 여기서 export.
  **`@`·`/` 입력 감지는 `keydown`이 아니라 `onUpdate`/`onSelectionUpdate`(트랜잭션 기반)로 한다** —
  keydown 스페이스 트리거는 모바일에서 조용히 실패한다(`SlashMenu.tsx`가 현재 구현).
- `@mew/shortcuts` — 단축키 바인딩.
- `@mew/tmux-term` — 터미널. 클라이언트(`TmuxTerminalPanel`, xterm.js)와 서버
  (`@mew/tmux-term/server`: `createTmuxManager`·`createTmuxRouter`·`attachTmuxWebSocket`,
  cwd 파라미터) 양쪽 제공.
  버튼 줄 오른쪽 도구는 **전부 아이콘 하나**다(맨 아래 · 키보드 잠금 · 선택 모드 · 복사) — 좁은 화면에서
  왼쪽 명령어 버튼 자리를 뺏지 않게. 무엇인지는 `data-tip`·`aria-label`이 말한다.
  버튼 줄 전체는 `HoverTipLayer`(`@mew/ui`)로 감싸 **마우스를 올리면 기다림 없이** 이름표가 뜬다 —
  `data-tip="이름"`이 붙은 요소면 무엇이든 대상이라 버튼마다 배선하지 않는다(명령어 버튼도 같이 따라온다).
  이 줄의 버튼에는 `title`을 걸지 않는다: 이름표가 뜬 뒤에 브라우저 기본 툴팁이 겹쳐 뜬다.
  - **[맨 아래]**는 올라간 스크롤을 **누가 들고 있는지**에 따라 셋을 다 한다: ① xterm 자체 스크롤백이면
    `scrollToBottom` ② tmux copy-mode(마우스를 안 쓰는 프로그램)면 WebSocket `exitCopyMode` → 서버가
    `tmux copy-mode -q`(멱등. PTY에 `q`·Esc를 쏘면 모드가 아닐 때 TUI에 오입력된다) ③ **앱이 직접
    스크롤하는 경우**(Claude Code처럼 마우스를 잡는 TUI) — tmux는 휠을 앱에 넘겼을 뿐이라 ①②가 통하지
    않는다. 이때는 SGR 휠 아래를 한 번에 몰아 보내 앱 스스로 최신까지 내려가게 한다.
  - **[키보드 잠금]**(자물쇠)은 모바일 소프트 키보드가 뜨지 않게 한다 — 터미널의 보조 textarea와 하단
    입력칸에 `inputMode='none'`을 건다. 포커스는 살아 있어 붙여넣기·하드웨어 키보드·명령어 버튼은
    그대로 쓴다. 세션이 아니라 브라우저 설정이라 `localStorage: mew:tmux-keyboard-lock`에 남는다.
- `@mew/mobile-keys` — 모바일 키보드 보조키 바(`MobileKeyBar`, `useKeyboardOpen`).
  에디터·터미널이 공용으로 쓴다. 좌우 스와이프 감지(`useSwipeGesture`)도 여기 —
  **손가락이 처음 닿은 화면 높이로 갈린다**(`zoneForY`): 위 40% = 탭 전환(`onTopLeft`/`onTopRight`),
  아래 20% = 창 전환(`onBottomLeft`/`onBottomRight`), **가운데 40%는 아무 제스처도 아니다**.
  손가락 수(1·2개)는 구분하지 않는다.
  가운데를 비워 둔 것이 가로 스크롤 보호 장치다 — 긴 줄·넓은 표는 거기서 끈다. 그래서 구역 안에서는
  스크롤 위치를 따지지 않고 바로 전환한다(옛 `scrollEdgeZones`·"맨 끝에 닿아야 통과" 규칙은 없앴다:
  끝까지 스크롤한 뒤의 손짓까지 창 전환으로 오인했다).
- `@mew/ui` — 의존성 없는 공용 조각: `ConfirmDialog`(네이티브 confirm 대체 — 전체화면이 풀리지
  않게), `useToast`(답을 받을 필요가 없는 짧은 안내 — 화면 아래 알약 하나, 2.6초 뒤 저절로 사라지고
  `pointer-events-none`이라 아무것도 가로채지 않는다. **오버레이 스택에 등록하지 않는다** — 등록하면
  안드로이드 뒤로가기가 토스트를 닫는 데 쓰인다), `pathDrag`(위 §사이드바 항목 끌어놓기),
  `useDragReorder`(줄 안 재정렬 + 줄 **바깥**에 놓을 때를 알리는 `onDragMove`/`onDrop` — 문서 탭
  끌어서 화면 분할이 이걸 쓴다), `useOverlayDismiss`(아래).

### 오버레이 닫기 규칙 (`useOverlayDismiss`)

**팝업·모달·드롭다운을 새로 만들면 반드시 `useOverlayDismiss(onClose)`를 부른다.** 열려 있는
오버레이를 앱 전체에서 하나의 스택으로 모아, Esc와 **안드로이드 하드웨어 뒤로가기**가 언제나
*가장 나중에 열린 것 하나만* 닫게 한다. 등록하지 않은 팝업 위에서 뒤로가기를 누르면 그 팝업 대신
뒤에 있는 터미널·사이드바가 닫히거나 페이지를 떠난다.

- 뒤로가기 대응은 History에 더미 항목(가드)을 하나 얹어 두는 방식이다. 겹쳐 있어도 가드는 하나뿐이고,
  한 겹 닫힐 때마다 다시 얹는다. UI로 닫혔을 땐 `history.back()`으로 걷어 스택을 맞춘다.
- 오버레이마다 각자 keydown 리스너를 달면 안 된다 — capture 단계에서 `stopPropagation`을 해도
  같은 노드(window)에 붙은 다른 리스너는 그대로 실행돼, 겹친 팝업이 Esc 한 번에 전부 닫힌다.
- `escapePhase: 'bubble'`은 사이드바·터미널 패널처럼 **콘텐츠를 감싸고만 있는** 오버레이용이다.
  안쪽(에디터 슬래시 메뉴, 파일 이름 바꾸기)이 Esc를 먼저 쓰고 `stopPropagation` 하면 패널은 닫히지
  않는다. 기본값 `'capture'`는 다이얼로그용 — 아래 에디터·터미널이 손대기 전에 가로챈다.
- `closeOnEscape`는 Esc를 삼킬지 판단한다. 터미널을 품은 오버레이는 `outsideTerminal`
  (`src/utils/terminalFocus.ts`)을 넘겨 vim 등의 Esc를 양보한다. 뒤로가기에는 영향이 없다.

에디터의 멘션·슬래시 메뉴와 링크/표 툴팁은 **일부러 등록하지 않았다.** 타이핑·선택에 따라 수시로
떴다 사라져서 그때마다 History를 밀고 당기면 브라우저 pushState 제한에 걸린다. 이들의 Esc는
`Editor.tsx`의 ProseMirror `handleKeyDown`이 직접 처리한다.
