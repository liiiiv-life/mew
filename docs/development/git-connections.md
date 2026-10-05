---
title: "계정별 Git 연결과 실행"
created: 2026-09-29
updated: 2026-10-05
---

# 계정별 Git 연결과 실행

[개발 계약](MOC.md) · [사용법](../guides/projects.md#github-로그인) · [결정 0179](../../../.mew/docs/decisions/0179-mew-account-git-connections.md)

## 소유권과 저장

- Git 연결은 Mew 이메일·제공자 ID·호스트별이다. 기존 `gh`·환경 토큰·SSH 키에서 이관하지 않는다. 최초 연결 전에는 미연결이며 이후 연결은 서버 재시작·Mew 재로그인에도 유지된다.
- `server/git-providers.ts`의 제공자 계약은 기기 승인 시작·폴링·토큰 갱신·계정 확인·호스트/저장소 경로 검사·Git 인증 사용자명을 소유한다. 최초 구현은 github.com이다. GitLab·Enterprise는 아직 등록되지 않았으며 제공자와 해당 UI/인증 흐름을 추가해야 한다.
- `GitConnections`는 `MEW_DATA_DIR/git-connections/`에 사용자·제공자·호스트의 SHA-256 파일명을 사용한다. 액세스·갱신 토큰과 만료 시각·작성자는 AES-256-GCM으로 암호화하며 소유 키를 AAD에 결합한다. 디렉터리는 0700, 키·원자적 기록 파일은 0600이다. 키와 암호문을 함께 백업해야 한다. OS 파일 접근 권한이 있는 사용자로부터의 비밀 격리는 아니다.
- 토큰·device code는 API, 브라우저 저장소, remote URL, Git argv, AI 입력에 포함하지 않는다. 사용자 승인 코드만 자기 로그인 작업에서 반환한다. API 응답은 no-store다.
- 연결 해제는 해당 Mew 연결을 제거한다. GitHub 웹 세션·다른 Mew 사용자·OS gh 인증은 유지한다. 공급자 측 승인 철회는 GitHub의 Authorized OAuth Apps에서 한다.

## API와 로그인

- `GET /api/git-connections/github`: 설정 가능 여부·자기 연결 계정·자기 로그인 작업을 반환한다.
- `POST` 같은 경로: OAuth device flow를 시작하거나 자기 진행 작업을 이어간다. 계정별 동시 진행이 가능하다. 내장 공개 Client ID를 기본으로 쓰고 `MEW_GITHUB_CLIENT_ID`에 공백이 아닌 값이 있으면 교체한다. 토큰 요청은 제공자의 interval·slow_down·만료를 따른다.
- `DELETE` 같은 경로: 연결과 진행 작업을 해제한다. 완료 직전 취소해도 늦게 도착한 토큰을 저장하지 않는다.
- `POST /:id/stop`: 자기 작업을 취소한다. `POST /:id/browser`: 고정 GitHub 승인 URL을 내부 브라우저로 연다. 내부 브라우저는 browser 기능 권한도 필요하다.
- 연결 API는 로그인과 git 또는 filesWrite 기능이 필요하다. 개인 연동 설정이라 저장소 전체 파일 권한을 요구하지 않는다. 실제 Git API의 기존 프로젝트·기능 권한 검사는 유지한다. 구 `/api/git/github-auth` 경로는 기존 Git 기능/전체 프로젝트 접근 검사를 유지하는 호환 경로다.
- 외부 GitHub 승인 링크는 browser 기능 없이 사용할 수 있다. 내부 브라우저를 선택할 때만 Chromium이 필요하며 gh는 필요하지 않다.
- 미연결·만료 시(원격 작업은 GitHub에서 확인한 승인 철회도 포함) 명시적 작업은 변경 전에 HTTP 428 `git-auth-required`를 반환한다. UI는 공용 로그인 창을 열고 성공 후 원래 직렬화한 요청을 딱 한 번 재시도한다. 취소·로그아웃 시 이어서 실행하지 않는다. 재시도 헤더에는 URI 인코딩한 Mew 소유자·워크스페이스를 넣고 서버에서 현재 값과 대조한다. 일반 실패를 자동 재실행하지 않는다.
- 로그인 작업은 메모리에만 있으며 서버 재시작 후 다시 시작한다. 만료된 액세스 토큰은 계정 상태 조회 또는 Git 작업의 연결 확인 때 갱신 토큰으로 자동 교체한다. 서버 안의 같은 계정·제공자·호스트에 대한 동시 갱신은 하나로 합치며, 연결 ID는 유지한다. 갱신 중 연결 해제·재연결이 일어나면 늦은 응답으로 덮어쓰지 않는다. 갱신 토큰이 없거나 만료·철회되면 재로그인을 요구한다. 기존 저장 연결에는 갱신 토큰이 없으므로 적용 후 한 번 다시 로그인해야 한다. 일시적인 네트워크·공급자 장애는 HTTP 503으로 반환하고 저장 연결을 제거하지 않는다. Device flow에서 발급된 토큰의 갱신에는 공개 Client ID만 사용한다([GitHub 공식 갱신 계약](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#refreshing-an-access-token-with-a-refresh-token)).

## Git 실행 경계

- 일반·파일별·AI 커밋 및 cherry-pick/revert 커미터에 요청한 사용자의 작성자 정보를 실행 단위로 전달한다. GitHub가 반환한 ID·login으로 비공개 주소 `ID+login@users.noreply.github.com`을 만든다. 공유 `user.name`·`user.email`은 수정하지 않는다. 기존 커밋을 cherry-pick할 때 원저자의 author는 Git 규칙대로 유지한다.
- 파일 생성·복사·이동·삭제·업로드·치환의 기존 부수 커밋은 계정이 연결되어 있을 때만 만든다. 미연결·미지원 원격이면 파일 작업을 유지하고 커밋을 생략한다. 파일 저장의 명시적 commit 및 이력 복원은 쓰기 전에 연결을 확인한다. 파일별 커밋은 다른 staged 파일을 함께 커밋하지 않는다.
- 타이틀바 브랜치 생성·전환(`GET/POST /api/git/branches`)은 Git 기능·프로젝트 전체 파일 권한과 POST의 workspace를 검사하는 로컬 작업이다. GitHub 연결이나 원격 조회는 요구하지 않는다. `for-each-ref`로 실제 로컬/원격/태그 ref만 base로 허용하고 커밋 해시는 별도로 검증한다. `switch`는 강제 전환·stash 없이 실행한다. 직접 원격 브랜치 선택은 추적 로컬 브랜치를 생성하고, 별도 이름으로 base 지정 생성은 upstream을 자동 설정하지 않는다. 같은 저장소의 Pull/Push·브랜치 작업은 중복 실행을 막는다.
- 계정 선택은 브랜치의 upstream remote → origin → 유일한 remote 순이다. 원격이 없는 로컬 저장소는 GitHub 연결을 사용한다. 여러 remote가 모호하면 설정을 요구한다.
- Pull/Push는 실제 fetch/push URL의 등록 제공자·호스트를 검사한다. GitHub SSH 주소를 실행 시 HTTPS로 정규화하되 저장된 remote는 바꾸지 않는다. 임의 호스트·로컬 경로·내장 자격증명·다중 push URL·저장소 URL 재작성은 거부한다.
- `POST /api/git/remote`에 `Accept: application/x-ndjson`을 보내면 실제 Git 실행 시점부터 `progress`·`complete`·`error` 이벤트를 스트리밍한다. 인증·workspace·원격 검증 실패는 스트림 시작 전에 기존 HTTP 상태(로그인 필요 428 포함)로 응답한다. Git에는 `--progress`와 `LC_ALL=C`를 적용하고 stderr의 단계·퍼센트·객체 카운터만 추출한다. 원문 로그·URL·자격증명은 전송하지 않는다. `complete`는 Git 정상 종료 후에만 보내며 전송 100%는 원격 성공을 뜻하지 않는다. 클라이언트 연결 해제는 Git을 재실행하거나 강제로 중단하지 않는다. 일반 JSON 응답도 호환한다.
- 자격증명은 해당 명령의 임시 Unix socket과 credential helper로만 전달한다. helper는 정확한 HTTPS 호스트와 저장소 경로만 받는다. OS helper·전역/시스템 설정·추가 인증 헤더·쿠키·대화형 프롬프트·HTTP 리다이렉트를 사용하지 않는다. 종료 시 socket을 제거한다. 이 경로는 지원 운영체제인 Linux/macOS/WSL을 대상으로 한다.
- AI 작업 파일에는 Mew owner와 연결 ID·제공자·호스트만 전달한다. 실행 시작과 각 커밋 직전에 현재 연결 ID를 확인하고 해제/교체된 연결로 작업을 계속하지 않는다. 토큰은 AI 프롬프트나 input.json에 넣지 않는다.
- 터미널·일반 에이전트의 임의 셸, 외부 폴더 clone은 기존 OS 실행 환경이다. 앱의 계정 선택은 셸 샌드박스가 아니며 작업트리도 사용자별로 복제하지 않는다. 커밋 서명과 hook은 기존 Git 설정을 따른다.

## 검증

2026-10-05: 만료 후 자동 갱신·동시 요청 병합·암호화 저장·연결 ID 유지·해제/교체 경합·일시 장애와 재승인 구분·패널 없이 Git 작업에서 갱신하는 회귀 검증을 추가했다.

2026-09-29: 아래 서버·브라우저 테스트와 기존 Git 워크벤치·파일 Git·권한·AI UI·도킹 회귀, TypeScript·대상 lint·번역·문서 경계/링크 검사를 통과했다. 빌드·서버 재시작은 실행하지 않았다.

- `server/github-auth.test.ts`: 동시 사용자·취소와 늦은 응답·만료·앱 미설정·OAuth 프로토콜·암호화 보관.
- `server/git-connections.test.ts`: 실제 Git과 HTTP를 사용한 최초 미연결·작성자/커미터 분리·공유 설정 보존·다른 staged 파일 보존·재시도 사용자/워크스페이스 검사·credential helper의 호스트/경로 제한.
- `server/git-ai-commit.test.ts`: 분석 도중 연결 해제 시 커밋 중단과 기존 AI 커밋 회귀.
- `server/github-auth-ui.test.ts`: 데스크톱/모바일 로그인·외부 승인 링크·내부 승인 키보드 접근·연결 해제·자동 로그인 창·취소 후 초안 보존·성공 후 단일 재시도.
- 실제 GitHub 로그인/전송은 등록한 앱과 사용자 승인이 필요하며 위 테스트는 fixture만 사용한다.
