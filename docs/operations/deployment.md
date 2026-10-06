---
title: "mew 배포 운영 런북"
created: 2026-09-04
updated: 2026-09-11
description: "Liiiiv 운영자가 공개·반영 전후 확인할 네이티브 설치·OS 사용자·HTTPS·백업·권한·macOS 장애 구분 및 재시도 제한을 정한다."
---

현재 지원 경로와 경계는 [ADR 0111](../../../.mew/docs/decisions/0111-mew-native-deployment-and-supervisor.md), 실제
설치·systemd 명령은 코드와 같은 커밋에서 바뀌는 [네이티브 서버 배포](../deployment/native.md)가 기준이다. 이 문서는 Liiiiv 운영자가 반복해서 확인할 항목만 남긴다.

## 공개 전

- 지원되는 네이티브 설치인지 확인한다. Dockerfile 없는 `docker compose --profile app`은 배포 경로가
  아니다. `/db`가 필요할 때만 Compose로 Postgres를 별도 기동한다.
- mew는 전용 비관리자 OS 사용자로 실행한다. `MEW_WORKSPACE`에는 그 사용자가 접근해도 되는 프로젝트만
  있고, 홈 전체·운영 시크릿·다른 서비스의 데이터는 없다.
- `MEW_BIND=127.0.0.1`인지 확인하고, 외부 방화벽에는 mew 포트를 열지 않는다. HTTPS 프록시 또는 터널만
  공개 진입점으로 둔다.
- 프록시가 원래 Host와 `X-Forwarded-Proto: https`를 전달하고 모든 WebSocket upgrade를 중계하는지 확인한다.
  mew는 별도 호스트명의 `/`에서만 제공한다.
- 첫 owner 계정의 임시 비밀번호를 안전한 채널로 전달하고 첫 로그인에서 변경했는지 확인한다. manager·owner
  계정 수를 최소화하고, 단순 읽기 공유에는 member 대신 게스트 경로 규칙을 쓴다.
- `config.env`, `MEW_DATA_DIR`, workspace, `/db` 사용 시 Postgres의 복구 가능한 백업을 확인한다.

## 반영 전후

- 현재 커밋·상태·백업 완료 시각을 기록하고, 작업 트리가 깨끗한 상태에서만 fast-forward 업데이트한다.
- 개인용 `./mew start` 설치는 헤더의 **Mew 업데이트**가 `origin/main` ahead/behind를 확인하고 숨김 tmux에서 같은 CLI 업데이트를 실행한다. 성공 시 새 서버 응답 뒤 화면이 자동 새로고침된다. 분기·작업 트리 충돌은 `--ff-only` 실패로 남기고 자동 merge·stash·reset하지 않는다.
- 새 의존성 설치 뒤 테스트와 빌드를 마치고 supervisor를 한 번 재시작한다. 개인용 `mew` CLI가 띄운 `nohup`
  프로세스와 systemd를 동시에 실행하지 않는다.
- 공개 도메인에서 로그인·비밀번호 변경·자동 저장·협업 WebSocket을 점검한다. manager/owner의 터미널 검사는
  제한된 테스트 계정으로만 한다.
- 장애 시 supervisor 로그를 먼저 확인한다. 앱 클론을 알려진 정상 커밋으로 되돌려 재빌드·재시작할 수는
  있지만, workspace나 `MEW_DATA_DIR`를 삭제·초기화해 롤백하지 않는다.

## macOS 에이전트·터미널 장애 구분

- 일반 터미널에서 같은 CLI·tmux가 실행되는지 먼저 비교한다. 웹 터미널만 비면 서버 로그의
  `[mew:tmux]`·`posix_spawnp failed`를 확인한다. PTY 보조 파일 권한 보정과 실행 계약은 mew README가 맡는다.
- ACP의 `Falling back from WebSockets to HTTPS`·`Connection refused`는 공급자 연결과 브라우저→mew
  연결을 구분해 조사한다. mew는 ACP 어댑터와 stdio로 통신하므로 이 문구만으로 공개 프록시의
  WebSocket upgrade 문제라고 판단하지 않는다.
- mew를 시작한 환경과 해당 CLI의 설정 파일에 남은 HTTP(S)/ALL_PROXY를 로컬에서 확인한다.
  Codex는 `CODEX_HOME`(기본 `~/.codex`)의 `.env`도 확인한다. 프록시 주소·인증정보는 docs나 로그 공유에
  복사하지 않는다. 필요한 프록시를 일괄 삭제하지 않고 실제 리스너와 설정을 대조한다.

## 재시도 금지

Dockerfile·이미지·권한 모델을 다시 검증하기 전에는 Compose의 `app` 프로파일을 임시 배포 수단으로
되살리지 않는다. 컨테이너 앱 경로를 재시도하려면 ADR 0111이 요구한 별도 결정과 검증을 먼저 한다.
