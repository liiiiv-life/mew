# 환경변수와 계정 설정

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../guides/getting-started-ko.md)

## 화면 설정

언어와 글꼴 목록은 앱 테마를 따르는 자체 드롭다운으로 표시한다. 글꼴은 추천 목록에서 고르거나 이름을 직접 입력할 수 있다. 방향키·Enter로 목록을 선택하고 Esc·뒤로가기는 목록만 닫는다.

언어를 바꾸면 에이전트의 히스토리·로딩·새로고침, 편집기·검색·파일·Git·예약·원격 데스크톱과 공용 확인창의 문구에도 바로 적용된다. 열린 편집기·터미널과 작성 중인 초안을 유지한다. 문서·대화·파일명과 외부 명령의 출력 원문은 그대로 표시한다. 구현·누락 방지 검사는 [UI 번역 계약](../development/ui-contracts.md#ui-번역)을 따른다.

헤더 메뉴 → **설정 → 화면**에서 밝은/어두운 테마, 한국어·영어·일본어·중국어, **테마색** 하나를 선택한다. 액센트·강한 액센트·링크 색은 자동 계산한다. 다크 모드는 밝은 액센트와 더 밝은 강한 액센트, 라이트 모드는 어두운 액센트와 더 어두운 강한 액센트를 사용한다. 색상 버튼을 누르면 설정 안에 공통 컬러피커가 펼쳐진다. 색상 영역 드래그(마우스·터치), 색조·채도·밝기 슬라이더 또는 6자리 HEX 코드로 바꾸고 초기화하면 기본 보라색으로 돌아간다. 슬라이더는 방향키로도 조절하며, 닫기·Esc·뒤로가기로 선택기만 접을 수 있다. 화면 설정은 기기의 브라우저별로 기억한다.

테마색은 `mew:theme-color`에 HEX 문자열 하나로 저장한다. 기존 `mew:accent-color` 설정이 있으면 그중 액센트를 테마색으로 이어받고, 강한 액센트·링크의 수동 지정은 자동 계산으로 대체한다. 모드를 바꾸어도 선택한 테마색은 유지한다. 버튼 위 글자색도 모드에 맞춰 계산하며 삭제·경고 색은 독립적으로 유지한다.

헤더의 계정/설정 메뉴에서 여는 `설정 > 화면`은 테마·언어와 함께 글꼴 세 벌을 브라우저별로 기억한다. 전역 UI 텍스트, Markdown 핫뷰 본문, Mono(코드 편집기·터미널·인라인/블록 코드·`font-mono` UI)는 서로 독립이며, 입력한 글꼴이 웹폰트로 로드되지 않고 이 기기에도 없으면 각 범주의 시스템 폴백 글꼴을 쓴다. 값은 `localStorage`의 `mew:fonts`에 저장되고 각 항목을 기본값으로 되돌릴 수 있다.

기본 UI·Markdown 글꼴은 IBM Plex Sans KR, Mono는 IBM Plex Mono다. 두 글꼴은 일반체(400)·굵은체(700) WOFF2를 mew에 포함해 같은 서버에서 제공하므로, 인터넷 연결이나 기기별 폰트 설치 없이 사용할 수 있다. `index.html`이 `/fonts/ibm-plex/fonts.css`를 로드하며, `public/fonts/ibm-plex/`는 개발 서버와 Vite 배포 결과에 그대로 포함된다. IBM 공식 배포본 `@ibm/plex-sans-kr` 1.1.0·`@ibm/plex-mono` 2.5.0의 원본 파일을 사용한다. [SIL OFL 원문](../../public/fonts/ibm-plex/LICENSE.txt)과 [출처·버전·파일 해시](../../public/fonts/ibm-plex/sources.json)를 함께 배포한다.

Noto Serif KR은 기존처럼 Google Fonts에서 불러온다. 프로덕션 CSP는 스타일시트에 `https://fonts.googleapis.com`, 폰트 파일에 `https://fonts.gstatic.com`만 외부 출처로 허용한다. 외부 스크립트 허용 범위는 넓히지 않는다. Google Fonts에 연결할 수 없는 환경에서는 Noto Serif KR의 설치된 글꼴 또는 시스템 폴백을 사용한다. 글꼴 이름을 직접 입력해도 임의의 웹폰트를 자동으로 다운로드하지는 않는다.

## 단축키 설정

헤더 메뉴 → **설정 → 단축키**에서 기능별 현재 키 조합을 확인한다. 변경 가능한 항목을 선택한 뒤 사용할 조합을 입력한다. 각 항목의 초기화 버튼은 그 항목만, 전체 초기화는 모든 사용자 지정 조합을 기본값으로 되돌린다. 편집기의 실행 취소·다시 실행·링크·문서 검색처럼 고정된 항목은 변경할 수 없다.

단축키는 포커스된 창을 대상으로 한다. 예를 들어 `Ctrl+W`는 문서·에이전트·터미널·Git 등 현재 사용하는 창의 탭을 닫으며, 터미널·에이전트 탭을 닫으면 해당 세션도 끝난다. 상세는 [포커스 계약](../development/ui-contracts.md#포커스-기반-탭-단축키)을 따른다.

## 내 계정과 계정 관리

- **로그인**: 관리자가 등록한 이메일과 임시 비밀번호로 접속하고 첫 로그인에서 비밀번호를 바꾼다. 공개 회원가입은 없다.
- **내 계정**: 메뉴 → 설정 → 계정에서 표시 이름·프로필 이미지·비밀번호를 변경하거나 로그아웃한다. 비밀번호를 바꾸면 다른 기기의 세션이 무효화된다.
- **계정 관리(owner)**: 메뉴 → 계정 관리에서 이메일과 역할을 골라 계정을 추가하고 발급된 임시 비밀번호를 본인에게 전달한다. 기능 권한 표는 각 계정과 guest를 행, 기능을 열로 표시한다. 체크를 바꾸면 즉시 저장하고 초기화는 역할 기본값을 복원한다. 역할도 같은 표에서 변경한다.
- **호스트 관리**: 최초 owner 발급, 비밀번호 재발급, 계정 삭제는 아래 CLI를 사용한다. 역할별 권한의 기준본은 [SECURITY](../../SECURITY.md#역할)다.

**파일·폴더 권한** 탭에서 폴더를 탐색하거나 상대경로를 입력한 뒤 계정별 상속·차단·열람·수정을 선택한다. 폴더 규칙은 하위에 적용되고 더 구체적인 규칙이 우선한다. 기능 표에서 파일 열람·수정을 끄면 파일별 허용보다 우선한다. guest 설정은 모든 비로그인 방문자에게 적용된다.

에이전트·터미널 등 서버 제어 기능은 파일 규칙으로 제한되지 않는다. 터미널형 에이전트는 에이전트와 터미널 권한이 모두 필요하다. 저장·적용 범위는 [권한 계약](../development/access-control.md)을 따른다.

## 서버 설정

설정 파일은 **레포 밖**에 있다 — `~/.config/mew/config.env`(`XDG_CONFIG_HOME` 존중). 레포 안의 `.env`가 있으면 그것이 마지막에 덮으므로 개발 중 임시 덮어쓰기로 쓴다. 읽는 순서와 기본 경로는 `server/config.ts` 한 곳이 정한다 — **진입점의 첫 import여야 한다.** 뒤로 밀리면 `MEW_DATA_DIR`같은 값이 다른 모듈이 이미 읽어 버린 뒤라 조용히 무시된다.

| 변수 | 기본값 | 무엇 |
| --- | --- | --- |
| `MEW_WORKSPACE` | 앱 폴더의 부모 | 프로젝트들이 사는 폴더. `server/paths.ts`의 `WORKSPACE_ROOT`를 고정 경로로 되돌리지 않는다 — 앱과 워크스페이스를 분리해야 다른 폴더·다른 서버에 안전하게 배포할 수 있다 |
| `MEW_DATA_DIR` | `~/.local/share/mew` (옛 설치의 `<앱>/.data`가 있으면 그것) | 계정·세션·기능/파일 권한·아이콘·RAG 인덱스/모델 캐시 |
| `MEW_AGENT_MEMORY_SCOPE` | `auto` | 설치된 systemd slice에 ACP·CLI 작업 메모리 제한 적용. `required`는 미설치 시 실행 거부, `off`는 OS 제한만 해제. [설치·메모리 보호](../operations/agent-memory.md) |
| `MEW_TEAM_PORT` | 5000 | 서버 포트 |
| `MEW_DESKTOP_HELPER_DIR` | 프로젝트의 `native/remote-desktop`, WSL은 Windows LocalAppData의 `Mew/remote-desktop` | [원격 데스크톱 보조 앱](../guides/remote-desktop.md) 설치 경로. WSL은 Windows 절대 경로 |
| `MEW_DESKTOP_ICE_SERVERS` | `[]` | 선택적 WebRTC STUN/TURN JSON 배열. 비워 두면 외부 서비스를 호출하지 않고 직접 연결 실패 시 Mew 서버 전송으로 전환. 인증 값은 레포에 저장하지 않는다 |
| `MEW_BIND` | `127.0.0.1` | 서버가 들을 주소. 공개 기본값은 loopback이며, LAN 직접 접속이 꼭 필요할 때만 노출 주소를 명시한다. 서버 배포는 HTTPS 프록시·터널 뒤 `127.0.0.1`로 유지한다 |
| `MEW_COLLAB_RUST` | 없음(=JS Yjs) | `1`이면 협업 방 상태를 Rust(yrs)로 — 먼저 `npm run build:native` ([협업 방](../development/collaboration.md)) |
| `DATABASE_URL` | 없음 | `/db`용 Postgres. 없거나 접속 불가면 `/db` API만 503 |
| `MEW_RAG_ENABLED` | `1` | `0`이면 로컬 의미 검색만 끈다. 정확 검색은 항상 유지 |
| `MEW_RAG_MODEL` | `Xenova/multilingual-e5-small` | Transformers.js feature-extraction 모델(기본 384차원 계약) |
| `MEW_RAG_MAX_FILE_BYTES` | `1000000` | 이 크기를 넘는 단일 텍스트 파일은 의미 인덱스에서 제외 |

전부 선택이다 — 하나도 없어도 뜬다. 지금 값이 어디서 오는지는 `./mew status`.

## 사용자 관리 (호스트에서)

```bash
npm run users -- add <email> [role]   # 임시 비밀번호 발급 — 첫 로그인 때 변경 강제 (role 생략 시 member)
npm run users -- role <email> <role>  # 기존 계정의 역할 변경 (owner|manager|member)
npm run users -- reset <email>        # 임시 비밀번호 재발급 + 기존 세션 전부 무효화
npm run users -- remove <email>       # 삭제 (세션 즉시 무효화)
npm run users -- list
```

임시 비밀번호는 안전한 채널로 본인에게 전달한다. 최초 owner 계정은 이 CLI로만 만들 수 있다 (`npm run users -- add <email> owner`) — 이후로는 owner가 앱 내 설정 팝업에서 다른 계정의 역할을 바꿀 수 있다.
