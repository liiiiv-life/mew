---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Git 패널 GitHub 로그인은 공식 CLI 자격증명을 공유한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0172 — Git 패널 GitHub 로그인은 공식 CLI 자격증명을 공유한다"
created: 2026-09-23
updated: 2026-09-23
---

- 날짜: 2026-09-23
- 상태: 채택
- 후속 결정: [0179](0179-mew-account-git-connections.md) — 계정별 OAuth·토큰 저장·작성자·원격 실행; 기존 OS 공유 인증 대체
- 결정자: 송상훈 (Git 패널 GitHub 로그인 요청), Codex (구현)

## 배경과 선택지

현재 Git 패널에 인증 진입점이 없어 사용자가 별도 터미널에서 계정을 연결해야 한다. Mew 전용 OAuth 앱·토큰 저장소를 새로 만드는 방식과 공식 GitHub CLI의 인증을 연결하는 방식을 검토했다. 기존 서버 Git과 같은 인증을 사용하고 별도 앱 등록·토큰 관리가 필요 없는 CLI 방식을 선택한다.

## 결정

- Git 패널은 공식 `gh auth login`의 기기 코드 인증을 제공한다. 별도 OAuth 앱·토큰 저장소를 만들지 않는다. 인증 뒤 `gh auth setup-git`으로 github.com HTTPS Git credential helper를 설정한다.
- 자격증명은 기존 Git·터미널과 같은 서버 OS 계정이 공유한다. UI에서 공유 범위를 알리고 Mew 계정별 Git 격리라고 설명하지 않는다. 진행 코드·승인 브라우저는 요청한 Mew 계정만 접근하며 동시 로그인은 서버 전체에서 하나만 허용한다.
- Git 권한과 프로젝트 전체 파일 접근을 검사하고, 시작·브라우저 열기는 브라우저 권한도 검사한다. 최초 URL은 github.com의 고정 device 승인 주소다. [ADR 0128](0128-mew-browser-oauth-uses-internal-browser.md)의 내부 브라우저·계정 프로필·팝업 정리 경계를 유지한다.
- 토큰 교환·저장은 CLI가 소유한다. Mew는 원문 CLI 출력이나 토큰을 클라이언트에 반환하지 않는다. 환경변수 인증을 브라우저 로그인으로 덮어쓰지 않는다.
- 취소·실패·15분 만료 시 프로세스와 인증 탭을 정리한다. 창 닫기·브라우저 새로고침은 인증 취소가 아니다. 서버 재시작을 넘는 인증 작업 복원은 제공하지 않는다.
- SSH 키·remote URL·Git 작성자는 변경하지 않는다. Enterprise·계정 전환·로그아웃 UI·push/pull 추가는 이번 범위 밖이다.

## 근거와 현재 계약

Git 작업이 서버 OS 계정으로 실행되는 현재 구조에서 Mew 전용 토큰만 저장하면 터미널·clone 등과 인증 상태가 달라진다. 공식 CLI가 인증과 저장을 담당하도록 연결하며, CLI 미설치·내부 브라우저 제한은 사용자에게 표시한다.

상세 사용법·API·검증 범위는 [Mew GitHub 로그인](../../guides/projects.md#github-로그인)에 둔다. 공식 근거는 [gh auth login](https://cli.github.com/manual/gh_auth_login)과 [gh auth setup-git](https://cli.github.com/manual/gh_auth_setup-git)이다.
