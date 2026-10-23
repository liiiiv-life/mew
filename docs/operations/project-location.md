---
title: "Mew 저장소 위치 변경"
description: "GitHub 소유자 이전과 로컬 소스 폴더 이동의 원격 주소·권한·데이터·실행 경로 점검을 안내한다. 기존 Git 메타데이터를 외부 백업하고 같은 저장소의 main을 새 첫 커밋으로 교체하는 이력 초기화·복구 경계도 설명한다."
created: 2026-10-14
updated: 2026-10-23
---

# 저장소 위치 변경

Mew 소스는 특정 부모 워크스페이스 없이 설치할 수 있다. 이 개발 환경의 현재 소스 위치는 `~/dev/mew`다. 실행 중인 설치의 위치를 다시 바꿀 때는 아래 사전 조건을 충족한 뒤 적용한다. [독립 프로젝트 결정](../decisions/0001-independent-project.md)에 따라 문서·결정·검증도 저장소 안에서 관리한다.

폴더를 옮겨도 Git 원격 주소나 npm 스코프는 바뀌지 않는다. 열어 두는 프로젝트의 위치는 소스 위치와 별개이며 `MEW_WORKSPACE`와 계정별 활성 프로젝트가 정한다.

## GitHub 소유자 이전

설치·릴리스 코드와 현재 문서는 `s-saens/mew`를 대상으로 한다. GitHub의 실제 Transfer와 각 설치의 원격 설정 변경은 별도 적용해야 한다. GitHub 소유자만 옮기는 경우 로컬 폴더·작업 공간·계정 데이터·Mewlink 등록은 옮길 필요가 없다. npm 패키지 이름은 `@liiiiv/mew-cli`를 유지한다.

1. 기존 협업자 권한과 이슈 담당자·유형을 기록한다. `s-saens`에 같은 이름의 `mew` 저장소나 같은 fork network의 저장소가 없는지 확인한 뒤, `liiiiv-life/mew`의 **Settings → General → Danger Zone → Transfer**에서 새 소유자로 `s-saens`를 지정한다. 관리자 권한이 필요하며 기존 이력·이슈·PR·릴리스를 유지한다.
2. 이전 후 모든 개발 PC·배포 서버의 기존 clone에서 아래 명령을 실행한다. 같은 Git 저장소를 공유하는 worktree들은 원격 설정도 공유하므로 한 번만 바꾸면 된다.

   ```bash
   git remote set-url origin https://github.com/s-saens/mew.git
   git remote -v
   ```

   SSH를 쓰면 원격 주소를 `git@github.com:s-saens/mew.git`로 설정한다. 위의 `git remote` 명령은 fetch·pull·빌드·서버 재시작을 실행하지 않는다. `./mew update`는 `git pull --ff-only origin main`, 앱 업데이트 확인은 `origin`의 `main`을 fetch한다. 앱 적용은 [기존 배포 절차](../deployment/native.md#4-업데이트백업장애-확인)를 따른다.
3. 협업자 접근권한, 브랜치 보호, Actions 설정을 확인한다. 조직에서 개인 계정으로 이전하면 새 소유자 외 이슈 담당자와 이슈 유형이 제거되고 읽기 전용 협업자는 이전되지 않는다. 저장소 secrets·webhook·deploy key는 유지되지만 조직에서 제공하던 권한·secrets·runner와 외부 GitHub App·배포 서비스의 새 저장소 접근은 따로 확인한다.
4. `cli-release`·`npm-publish` environment의 검토자·허용 태그·보호 규칙을 확인한다. npm을 발행할 때는 [CLI 릴리스 절차](../deployment/cli-release.md)에 따라 Trusted publisher의 GitHub 소유자를 `s-saens`로 등록한다. 이미 등록된 옛 소유자의 설정은 삭제 후 다시 만든다.

이전 Git URL은 리디렉션되지만 `liiiiv-life/mew` 위치에 새 저장소나 fork를 만들면 리디렉션이 영구 삭제된다. 기존 주소에 의존하지 않도록 clone과 외부 연결을 갱신한다. GitHub Pages를 별도로 사용 중이면 사이트 주소는 리디렉션되지 않으므로 URL·DNS도 확인한다. 저장소 이전은 GitHub OAuth 앱의 소유권 이전과 별개다. 앱 소유권까지 분리할 때만 별도 Transfer를 진행한다.

공식 기준: [GitHub 저장소 이전](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository), [배포 환경 관리](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [GitHub OAuth 앱 이전](https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/transferring-ownership-of-an-oauth-app). 이 문서의 절차는 이전 준비 안내이며 GitHub 설정 적용이나 발행 완료를 뜻하지 않는다.

## Git 이력 새 시작

[결정 0056](../decisions/0056-fresh-git-history.md)에 따라 소스 폴더와 실행 데이터의 위치는 바꾸지 않는다.

사용자가 명시적으로 이력 교체를 요청한 경우에만 수행한다. 기존 `.git` 전체와 staged·unstaged 변경을 `~/dev/mew-backups/`의 날짜별 폴더에 보존한다. `.git` 안에 있던 별도 소스·변경 목적·복구 자료도 백업에 포함하며, 로컬 계정·세션·환경 설정과 사용자 파일은 옮기거나 삭제하지 않는다.

현재 추적 파일과 승인된 변경으로 부모 없는 첫 커밋을 만들고 기존 `origin` 주소를 다시 등록한다. 미추적·무시 파일을 일괄 추가하지 않는다. 교체 직전 확인한 원격 `main` SHA를 명시한 `--force-with-lease`로 `main`만 갱신하고, 원격이 바뀌면 중단해 다시 검토한다. 브랜치 보호를 임의로 해제하거나 다른 브랜치·태그를 삭제하지 않는다. push 뒤 원격 SHA·첫 커밋의 부모 없음·파일 스냅샷·작업 상태를 확인한다.

복구에는 외부에 보존한 Git 메타데이터와 변경 사본을 사용한다. 이전 이력을 사용하는 다른 clone은 새로 받아야 하며, 원격 이력 교체는 GitHub의 PR 참조·캐시나 다른 clone에 남은 과거 데이터를 지우는 절차가 아니다.

## 소스 폴더 이동 전

- 목적지에 다른 폴더가 없는지 확인한다. 기존 Git 이력·staged와 unstaged 변경·미추적 파일을 보존한다.
- `~/.config/mew/config.env`, 기존 `.data/` 또는 `MEW_DATA_DIR`와 로컬 런처를 백업한다. 데이터 폴더를 새 빈 폴더로 대체하지 않는다.
- 실행 중인 서버·에이전트·터미널의 작업 경로와 이전 폴더를 참조하는 systemd·런처·디버거 설정을 확인한다.

## 경로 갱신

소스 설치의 이동은 서버 쓰기를 멈춘 상태에서 적용한다. 코딩 에이전트의 서버 중지·재시작은 [실행·검증 규칙](../development/getting-started.md)에 따른 별도 사용자 승인 범위를 따른다.

1. 폴더 전체를 옮긴다. `.git/`, `.data/`, 의존성과 기존 빌드 파일도 함께 보존한다.
2. 런처의 작업 폴더와 `MEW_WORKSPACE`·`MEW_DATA_DIR`·서비스의 작업 경로 중 이동한 폴더를 가리키는 값만 갱신한다. 다른 프로젝트나 외부 데이터 폴더는 그대로 둔다.
3. 저장된 프로젝트 목록·활성 프로젝트·에이전트 탭·Documents·접근 정책·디버거의 경로를 갱신한다. 절대경로로 만든 키와 해시 파일명도 해당 저장 형식에 맞춰 이관한다. 대화 원문·실행 로그의 과거 경로는 고쳐 쓰지 않는다.
4. 새 위치에서 문서 검사와 필요한 타입·테스트·린트 검사를 실행한다. 폴더 이동 자체에는 앱 빌드가 필요하지 않다.
5. 서버를 새 위치에서 실행한 뒤 로그인·프로젝트·Documents·대화와 자동저장을 확인한다. 이전 경로의 임시 연결을 사용했다면 이를 참조하는 실행이 끝난 뒤 제거한다.

서버와 에이전트는 시작 시의 절대경로를 기억하므로 파일 이동만으로 실행 중 경로가 바뀌지 않는다. 기존 대화를 새 경로에서 이어갈 때는 런타임별 세션 위치와 Mew의 문서 연결도 확인한다. Mew의 Documents·에이전트 설정은 실제 폴더를 요구한다. 실행 중인 프로젝트 루트를 심볼릭 링크로 바꾸면 기존 세션의 문서 연결 검증이 실패하므로 링크만으로 서버 전환을 대신하지 않는다. 이전 위치의 연결은 새 설치의 의존 경로로 유지하지 않는다.

## 저장 상태의 일관성

서버 재시작만으로 독립 에이전트 감독이 종료되지는 않는다. 같은 설치의 소스·데이터 경로를 기억하는 감독의 쓰기도 끝난 뒤 저장 상태를 이관한다. 다른 작업 폴더의 에이전트도 이 설치의 데이터 폴더를 사용하면 재연결이 필요하지만, 그 작업 폴더 자체의 경로는 바꾸지 않는다. PID의 작업 폴더만으로 설치 소유권을 판정하지 않는다.

프로젝트별 태스크·기능 파일은 workspace의 SHA-256, 디버거 설정은 `[account, root]`, 대화·문서 연결은 `[runtime, cwd, sessionId]`의 JSON 문자열 해시로 찾는다. JSON 경로만 바꾸고 키나 파일명을 그대로 두면 새 위치에서 기존 상태를 찾지 못한다. 목적지 키가 이미 있으면 덮어쓰지 말고 충돌을 먼저 해결한다.

대화 전사의 SQLite `sessions`에는 `cwd`와 조회 키를, `events`에는 연결 키만 갱신한다. 이벤트 payload·순서·개수·revision은 보존한다. 이전 JSON 전사도 메타데이터와 파일명만 옮긴다. SQLite 백업 API로 일관된 사본을 만들며 실행 중 DB 파일만 복사하지 않는다. 런타임이 별도로 소유하는 세션 원문은 경로 문자열 전체 치환 대상이 아니다.

적용 뒤에는 이전 경로의 활성 설정·키가 남지 않았는지, Git HEAD와 index가 유지되는지, 대화 개수와 내용이 보존되는지 확인한다. 실패하면 저장 상태·설정·폴더 위치를 같은 백업 시점으로 되돌린다. 복구 사본과 검사 로그는 저장소 문서에 넣지 않는다.
