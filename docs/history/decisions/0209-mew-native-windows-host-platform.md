---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
title: "0209 — mew는 공통 앱과 OS별 실행 계층으로 Windows 네이티브 서버를 추가한다"
description: "기존 Linux·macOS·WSL 계약을 유지하며 Windows 네이티브 서버의 psmux·Job Object·ACL·상호 인증 named pipe와 플랫폼별 사전 빌드 배포 경계를 정한다. 공개 지원은 Windows CI·실기 게이트 이후다."
created: "2026-10-14"
updated: "2026-10-14"
---

- 날짜: 2026-10-14
- 상태: 채택·코드 구현, 공개 지원 전 Windows CI·실기 게이트
- 결정자: 사용자 지시, Codex 설계·구현
- 부분 확장: [0111](0111-mew-native-deployment-and-supervisor.md) — 지원 서버 구현에 Windows 네이티브를 추가하되 비관리자·loopback·데이터 보존·감독 경계 유지
- 후속 결정: [0210](0210-mew-retire-mewnager.md) — 아래 관리 앱 유지 조항을 대체하고 공통 CLI로 통일
- 관련: [0048](0048-mew-agent-supervisor-process.md) · [0201](0201-mew-windows-manager-wsl.md)

## 결정

- 화면·계정·편집·Git·Mewlink를 동일 코드로 유지하고 OS 의존 구현은 mew `server/platform/` 및 터미널 패키지의 backend 폴더에서 분리한다. 앱 전체를 OS별로 복제하지 않는다.
- Windows 터미널은 고정 버전의 MIT psmux를 사용하고 해당 바이너리와 의존성 고지를 함께 배포한다. Linux·macOS는 기존 tmux를 유지한다.
- Windows 장기 작업은 native helper가 child를 suspended 상태에서 Job Object에 연결한 후 실행한다. helper 종료 시 자손이 종료되며 독립 감독의 서버 재접속 수명은 유지한다.
- Windows 개인 상태는 현재 OS 사용자·SYSTEM의 ACL로 보호한다. named pipe에서는 개인 상태 키를 통한 양쪽 challenge-response 인증 후 기존 계정·프로젝트 권한 검사를 수행한다. 키를 argv·env·로그로 전송하지 않는다.
- 동일 npx CLI가 OS별 사전 빌드 실행본을 선택한다. 사용자 프로젝트와 계정·대화·기기 등록은 실행본 캐시와 분리한다.
- Windows GUI 관리 앱의 기존 전용 WSL 계약은 유지한다. 네이티브 GUI 운영 확장은 별도다.
- 코드·격리 테스트가 준비됐다는 사실과 공개 발행·Windows 실기·외부망 접속 성공을 구분한다. 앱 운영 빌드·배포·재시작은 기존 사용자 실행 규칙을 따른다.

## 근거와 결과

Windows 네이티브에서는 Unix socket·mode·process group을 그대로 사용할 수 없다. OS 구현의 책임을 모아 공통 기능 수정과 회귀 검증을 공유하고 Windows 경계를 별도 검증한다. 구현 계약·검증 게이트는 [mew Windows 네이티브 문서](../../development/windows-native.md)가 소유한다. 이 결정은 컨테이너 앱 지원을 추가하지 않는다.
