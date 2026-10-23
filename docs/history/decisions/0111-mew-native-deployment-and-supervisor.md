---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
title: "0111 — mew의 지원 배포는 네이티브 설치와 감독 프로세스로 한정한다"
created: 2026-09-04
updated: 2026-10-14
description: "네이티브 서버·비관리자 사용자·loopback·HTTPS·감독 프로세스와 지원하지 않는 앱 컨테이너 경계를 정한다. WSL 관리 앱과 공통 OS 실행 계층의 Windows 네이티브 지원은 후속 결정에 연결한다."
---

- 날짜: 2026-09-04
- 상태: 채택
- 후속 결정: [0201](0201-mew-windows-manager-wsl.md) — Windows 포터블 GUI로 전용 WSL 2 네이티브 서버의 설치·운영을 관리; 서버 실행·비관리자·loopback 경계 유지
- 후속 결정: [0195](0195-mew-account-based-p2p-remote-access.md) — 옵트인 중앙 계정·P2P 원격 접속 설계 추가(미구현); 네이티브 실행·loopback 바인딩·기존 HTTPS 배포는 유지
- 부분 대체: [0023](0023-mew-selfhost-packaging-repo.md) — Docker를 같은 레포의 지원 컨테이너 옵션으로 남긴 범위
- 후속 결정: [0209](0209-mew-native-windows-host-platform.md) — 공통 앱·OS 실행 계층으로 Windows 네이티브 지원을 추가; 기존 감독 수명·loopback·개인 데이터 경계 유지
- 결정자: 송상훈 (배포 문서화 지시), Codex (현행 구현 대조·기록)

## 배경

[ADR 0023](0023-mew-selfhost-packaging-repo.md)는 네이티브 설치를 기본으로 하되 Dockerfile과
Compose `app` 프로파일을 서버·VPS용 옵션으로 두었다. 이후 Dockerfile은 제거됐지만 Compose의 옛
`app` 서비스와 README 안내가 남아 `docker compose --profile app up -d --build`가 실패하는 상태가 됐다.

mew의 `manager`·`owner`는 터미널과 에이전트를 통해 서버 OS 사용자 권한에 닿는다. 단순히 포트를
공개하거나 불완전한 컨테이너 경로를 문서화하는 것은 실제 배포 경계와 맞지 않는다. 또한 내장 `mew`
CLI의 `start`는 `nohup`용 개인 경로라 재부팅 자동 복구를 보장하지 않는다.

## 선택지

1. Dockerfile을 즉시 복구해 Compose를 다시 지원한다 — 현재 코드·의존성·tmux·워크스페이스 마운트와
   다시 검증해야 하며, 배포 문서만으로 실행 경로를 복구할 수 없다.
2. Docker 경로를 문서에서만 숨긴다 — Compose 파일과 README가 서로 다른 신호를 주고, 다음 운영자가
   실패하는 명령을 다시 시도한다.
3. 지원 경로를 네이티브 설치로 명확히 한정하고, 서버는 로컬 바인딩·HTTPS 프록시/터널·감독 프로세스로
   운영한다.

## 결정

3번을 채택한다.

- 현재 지원 설치는 Linux·macOS의 네이티브 Node 실행이다. 서버는 전용 비관리자 OS 사용자로 실행하고,
  workspace에는 그 사용자가 읽고 써도 되는 프로젝트만 둔다.
- 서버 공개 시 mew는 `MEW_BIND=127.0.0.1`에만 바인딩한다. HTTPS 리버스 프록시 또는 터널이 원래
  `Host`, `X-Forwarded-Proto: https`, WebSocket upgrade를 보존해 별도 호스트명의 루트 경로(`/`)로
  전달한다. 하위 경로 배포는 지원하지 않는다.
- 개인용 `./mew start`와 서버용 process manager를 섞지 않는다. systemd 같은 supervisor가 서버의
  재시작·재부팅 복구를 맡고, 업데이트는 의존성 설치·검증·빌드 뒤 supervisor 재시작으로 반영한다.
- Dockerfile이 없는 동안 `docker compose --profile app`은 지원하지 않는다. Compose는 `/db`의
  Postgres 보조 경로만 쓴다. 앱 컨테이너를 다시 제공하려면 Dockerfile·마운트·tmux/에이전트 권한·이미지
  갱신과 보안을 검증한 새 ADR을 먼저 쓴다.
- `config.env`, `MEW_DATA_DIR`, workspace, 별도 Postgres는 각각 복구 대상으로 백업한다. 계정·세션·
  게스트 규칙은 `MEW_DATA_DIR`에 있으며 Git으로 대체되지 않는다.

구체적인 설치 명령·systemd 예시·검증 순서는 코드와 함께 바뀌는 [mew README](../../../README.md)의
"서버 배포 (네이티브)"를 기준으로 한다. 내부 운영의 배포 전·후 확인은 [운영 런북](../../operations/deployment.md)에
둔다.

## 근거

네이티브 실행은 mew의 핵심인 기존 개발 도구·tmux·에이전트 CLI를 같은 OS 사용자 문맥에서 그대로
쓴다. 공개 진입을 TLS 프록시 또는 터널 하나로 좁히면 세션 Secure cookie, Origin 검사, WebSocket이
일관되게 동작하고, 직접 공개 포트보다 운영 경계를 이해하기 쉽다. 지원하지 않는 컨테이너 경로를 남기는
것보다 실제 배포 가능 범위를 명시하는 편이 복구·감사·다음 결정 모두에 안전하다.

## 결과

- README에서 실패하는 컨테이너 앱 명령을 제거하고, 한국어 네이티브 배포·systemd·백업 안내를 제공한다.
- Docker Compose의 `app` 서비스와 entrypoint는 당장 실행 경로로 홍보하지 않는다. 제거 또는 컨테이너
  재도입은 후속 구현 작업에서 결정한다.
- 이 결정은 개발 서버 `npm run dev`를 공개하지 않는 기존 보안 경계를 유지한다.
