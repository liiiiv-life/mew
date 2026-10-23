---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew를 공개 가능한 자립 레포로: 네이티브 설치가 기본, Docker는 부차. 당시 선택·근거를 보존하며, Mew 자체 MIT 신규 배포 선택은 결정 0053가 부분 대체한다."
title: "0023 — mew를 공개 가능한 자립 레포로: 네이티브 설치가 기본, Docker는 부차"
created: 2026-07-30
updated: 2026-09-11
---

- 날짜: 2026-07-30
- 상태: 채택
- 후속 결정: [0111](0111-mew-native-deployment-and-supervisor.md) — Docker 앱 배포 지원
- 후속 결정: [0120](0120-mew-project-local-assets-replace-r2.md) — R2 자산 저장·설치 설정
- 결정자: 송상훈 (지시)

- 후속 결정: [0053](../../decisions/0053-source-available-license.md) — Mew 자체 MIT 신규 배포 선택만 소스 공개 조건으로 대체. 기존 MIT 허여·제3자 권리와 나머지 결정은 유지

## 배경

mew는 이 개발 머신에서만 도는 구조였다. 워크스페이스 루트를 코드 위치에서 추론했고(`../..`),
설정·계정이 레포 안(`.env`·`.data/`)에 있었고, 문서는 이 docs를 상대경로로 참조했으며, 내부 패키지
이름이 `@liiiiv/*`였다. 남이 자기 폴더를 열려면 워크스페이스 모양을 흉내 내야 했다.

목표는 셋이다 — 오픈소스로 공개하고, 내가 매일 쓰던 대로 계속 쓰고, 기능을 계속 고친다.
같은 소스 하나로 셋을 다 해야 하며, 사내용 브랜치를 따로 두면 갈라진다.

## 선택지

1. 배포 패키징을 별도 레포로 분리(`deploy/mew`) — 앱은 비공개로 두고 배포 도구만 먼저 공개할 수 있다. 단점: Dockerfile은 소스와 같은 커밋에서 바뀌는데 레포가 둘이면 버전 짝을 영구히 손으로 맞춰야 한다. 그리고 앱이 비공개인 한 배포 레포만으로는 아무도 쓸 수 없다 — 빌드할 소스가 없다.
2. Docker를 기본 배포 형태로 — 재현성은 최고. 단점: mew의 터미널이 컨테이너 안 빈 셸이 된다(사용자의 claude·node·git 설정이 없다). 윈도우에서는 Docker Desktop(관리자 권한·수 GB)이 전제가 된다.
3. 레포 하나 + 네이티브 설치가 기본, 컨테이너는 옵션 — 클론하고 `./mew setup` 하나로 끝낸다.

## 결정

3번. mew 레포 하나를 공개 가능한 자립 레포로 만든다. 1번으로 만들었던 `deploy/mew`는 흡수하고 지운다.

- 레포는 무상태다. 설정은 `~/.config/mew/config.env`, 계정·세션은 `~/.local/share/mew/`,
  로그·pid는 `~/.local/state/mew/`(XDG). 경로 결정과 설정 로딩은 `server/config.ts` 한 곳이고,
  진입점의 첫 import여야 한다 — 뒤로 밀리면 설정 파일의 `MEW_DATA_DIR`이 조용히 무시된다(원래 그랬다).
  옛 설치의 `<앱>/.data`가 있으면 그것을 계속 쓴다 — 업그레이드로 계정이 사라지면 안 되므로.
- 설치는 `./mew setup` 하나다. Node 22.18+ 확인(없으면 nvm 설치 제안) · `build-essential`·`python3`·
  `tmux` 확인(없으면 apt 한 줄, 반드시 확인 받고) · 폴더·포트 질문 · 빌드 · 첫 owner 계정 발급까지.
  이후 `start`·`stop`·`restart`·`update`·`status`·`logs`·`users`.
- 컨테이너는 같은 레포 안에 옵션으로 남긴다 — `Dockerfile` + `docker-compose.yml`의 `app` 프로파일.
  서버·VPS·공개 노출용이다. `npm run db:up`(Postgres만)과 한 파일을 공유하되 프로파일로 갈라 둔다.
- 회사 흔적을 지운다 — 내부 패키지 스코프 `@liiiiv/*` → `@mew/*`(35파일 86곳), 소스·문서의 내부
  경로·docs 상대링크 제거, 단축키 localStorage 키 `liiiiv-mew:shortcuts` → `mew:shortcuts`(옛 키는 읽기 폴백).
- 라이선스는 MIT(저작권자 표기는 `mew contributors`).

## 근거

- 터미널이 mew의 핵심 기능이다. 컨테이너 셸에는 사용자의 개발 도구가 없어서, Docker를 기본으로
  삼으면 "브라우저에서 내 도구를 쓰는" 요점이 사라진다. 격리가 이득인 상황(공개 노출·VPS)은 옵션으로
  남기면 충분하다.
- Dockerfile은 소스와 같은 커밋에서 바뀐다. 1인 유지보수에서 레포를 둘로 나누는 비용이 이득보다 크다.
- 무상태 레포는 세 용도를 한 소스로 묶는다. 내 설치는 `.data`를 그대로 쓰고, 남의 설치는 XDG로
  가고, 클론을 지웠다 다시 받아도 데이터가 남는다. 사내용 브랜치가 필요 없어진다.

## 결과

- `deploy/mew` 레포는 흡수·삭제됐다. 살아남은 것: `Dockerfile`·`docker-compose.yml`·
  `docker-entrypoint.sh`(mew 레포 루트로), 설치 스크립트의 뼈대(`mew` CLI), `SECURITY.md` 문안.
- 접근 모델의 기준본이 mew 레포 `SECURITY.md`로 옮겨간다. 공개 레포는 자기 보안 모델을 자기 안에
  들고 있어야 한다. [ops/mew/access-model.md](../../operations/access-model.md)에는 우리 운영 사항만
  남긴다(포트 노출 정책·발급 계정 현황·tailnet 경계). 역할 매트릭스·게스트 규칙은 `SECURITY.md`가 기준본.
- 레포 문서 허용목록의 예외가 아니다 — `SECURITY.md`는 [ADR 0012](0012-docs-repo-doc-allowlist-and-absorption.md)가 이미 허용한 네 이름 중 하나다.
- `MEW_BIND`가 생겼다. 기본은 종전대로 `0.0.0.0`(터널·다른 기기 접속이 정상 사용)이고, 이 컴퓨터에서만
  쓰려는 사람이 `127.0.0.1`로 좁힐 수 있다.
- 우리 5000번 운영은 그대로다. 여전히 호스트 프로세스이고, 워크스페이스도 `~/dev/liiiiv` 그대로다
  (`MEW_WORKSPACE` 미설정 시 기본값이 앱 폴더의 부모라 결과가 같다).
- docs 전용 규칙은 남겨 뒀다 — `DEFAULT_PROJECT='docs'`와 MOC 커버리지·archives 불변 규칙(`server/rules.ts`)은
  하드코딩 상태 그대로다(사용자 지시). 남의 워크스페이스에 `docs`라는 폴더가 있으면 우리 문서 규칙이
  함께 적용된다 — 공개 후 첫 리포트가 오면 그때 프로젝트별 옵트인으로 뺀다.
- 공개 전 남은 것: 레포에 미커밋 작업이 많아 커밋 정리가 필요하다. 히스토리에 `.env`·`.data`가
  커밋된 적은 없음을 확인했다(41커밋 전수).
