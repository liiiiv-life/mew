# 환경변수와 계정 설정

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

## 화면 설정

헤더 메뉴 → **설정 → 화면**에서 밝은/어두운 테마, 한국어·영어·일본어·중국어, 강조색·호버 강조색·링크 색을 선택한다. 화면 설정은 기기의 브라우저별로 기억한다.

헤더의 계정/설정 메뉴에서 여는 `설정 > 화면`은 테마·언어와 함께 글꼴 세 벌을 브라우저별로 기억한다. 전역 UI 텍스트, Markdown 핫뷰 본문, Mono(코드 편집기·터미널·인라인/블록 코드·`font-mono` UI)는 서로 독립이며, 입력한 글꼴이 이 기기에 없으면 각 범주의 시스템 폴백 글꼴을 쓴다. 값은 `localStorage`의 `mew:fonts`에 저장되고 각 항목을 기본값으로 되돌릴 수 있다.

## 단축키 설정

헤더 메뉴 → **설정 → 단축키**에서 기능별 현재 키 조합을 확인한다. 변경 가능한 항목을 선택한 뒤 사용할 조합을 입력한다. 각 항목의 초기화 버튼은 그 항목만, 전체 초기화는 모든 사용자 지정 조합을 기본값으로 되돌린다. 편집기의 실행 취소·다시 실행·링크·문서 검색처럼 고정된 항목은 변경할 수 없다.

단축키는 포커스된 창을 대상으로 한다. 예를 들어 `Ctrl+W`는 문서·에이전트·터미널·Git 등 현재 사용하는 창의 탭을 닫으며, 터미널·에이전트 탭을 닫으면 해당 세션도 끝난다. 상세는 [포커스 계약](../development/ui-contracts.md#포커스-기반-탭-단축키)을 따른다.

## 내 계정과 계정 관리

- **로그인**: 관리자가 등록한 이메일과 임시 비밀번호로 접속하고 첫 로그인에서 비밀번호를 바꾼다. 공개 회원가입은 없다.
- **내 계정**: 메뉴 → 설정 → 계정에서 표시 이름·프로필 이미지·비밀번호를 변경하거나 로그아웃한다. 비밀번호를 바꾸면 다른 기기의 세션이 무효화된다.
- **계정 관리(owner)**: 메뉴 → 계정 관리에서 이메일과 역할을 골라 계정을 추가하고 발급된 임시 비밀번호를 본인에게 전달한다. 계정 목록에서는 기존 계정의 역할을 바꾼다.
- **호스트 관리**: 최초 owner 발급, 비밀번호 재발급, 계정 삭제는 아래 CLI를 사용한다. 역할별 권한의 기준본은 [SECURITY](../../SECURITY.md#역할)다.

## 서버 설정

설정 파일은 **레포 밖**에 있다 — `~/.config/mew/config.env`(`XDG_CONFIG_HOME` 존중). 레포 안의 `.env`가 있으면 그것이 마지막에 덮으므로 개발 중 임시 덮어쓰기로 쓴다. 읽는 순서와 기본 경로는 `server/config.ts` 한 곳이 정한다 — **진입점의 첫 import여야 한다.** 뒤로 밀리면 `MEW_DATA_DIR`같은 값이 다른 모듈이 이미 읽어 버린 뒤라 조용히 무시된다.

| 변수 | 기본값 | 무엇 |
| --- | --- | --- |
| `MEW_WORKSPACE` | 앱 폴더의 부모 | 프로젝트들이 사는 폴더. `server/paths.ts`의 `WORKSPACE_ROOT`를 고정 경로로 되돌리지 않는다 — 앱과 워크스페이스를 분리해야 다른 폴더·다른 서버에 안전하게 배포할 수 있다 |
| `MEW_DATA_DIR` | `~/.local/share/mew` (옛 설치의 `<앱>/.data`가 있으면 그것) | 계정·세션·게스트 규칙·아이콘·RAG 인덱스/모델 캐시 |
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
