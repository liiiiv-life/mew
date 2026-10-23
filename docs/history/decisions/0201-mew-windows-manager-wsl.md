---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
title: "0201 — Windows 포터블 관리 앱과 WSL 실행 계층"
description: "0210으로 대체된 역사 결정이다. mew 레포의 독립 Tauri 관리 앱이 Windows 환경 준비·설치·운영을 담당하고 실제 mew 서버는 전용 WSL 2 배포판의 비관리자 사용자로 실행하는 경계를 정한다."
created: 2026-10-07
updated: 2026-10-14
---

- 날짜: 2026-10-07
- 상태: 대체됨 — [0210](0210-mew-retire-mewnager.md)에 따라 관리 앱 폐기
- 부분 대체: [0111](0111-mew-native-deployment-and-supervisor.md) — Linux 서버 실행 경계를 유지하면서 Windows 전용 WSL 관리 GUI 진입점 추가
- 결정자: 사용자(Windows GUI 관리 앱 구현 요청), Codex(구현)

## 배경

Windows에서 tmux·POSIX 실행 계약을 그대로 제공하면서 Ubuntu 터미널을 직접 조작하지 않고 설치·상태 조회·업데이트를 관리할 진입점이 필요하다. [0111](0111-mew-native-deployment-and-supervisor.md)의 Linux 네이티브 서버·loopback 바인딩 경계는 유지한다.

## 선택지

1. Windows 네이티브 서버 포팅 — tmux·셸·예약·프로세스 관리 계약을 별도로 구현해야 한다.
2. Electron 관리 앱 — React·TypeScript를 재사용하지만 브라우저 엔진을 함께 배포한다.
3. Tauri·React·Rust 관리 앱 + WSL 2 — 시스템 WebView2를 이용하고 기존 Linux 실행 계약을 유지한다.

## 결정

- 3번을 채택하고 `mew/apps/manager`에 독립 앱·npm 잠금·Cargo 잠금·빌드 파이프라인을 둔다. 기존 mew 앱 빌드에 Rust나 Windows 도구를 요구하지 않는다.
- Windows 앱은 설치·환경 확인·업데이트·로그·서버 조작을 담당한다. 서버·터미널·에이전트는 WSL 내부의 비관리자 사용자로 실행한다.
- 기본은 전용 `Mew` 배포판이다. 기존 배포판을 삭제하거나 기본 WSL 배포판·전역 설정을 바꾸지 않는다. 사용자 소유 기존 환경에 자동 설치하지 않는다.
- Windows 기능 준비만 UAC로 승격하며, 배포판 등록과 사용자 데이터는 원래 Windows 사용자 문맥에서 처리한다. 재부팅이 필요하면 단계와 설정을 보존하고 재실행해 이어 간다.
- 서버는 localhost로 제공한다. 외부 접속과 방화벽 공개는 별도 사용자 설정이며 자동 활성화하지 않는다.
- 포터블 실행 파일은 관리 앱 자체의 무설치 실행을 뜻한다. WSL·배포판·mew·사용자 데이터는 별도로 저장된다. WebView2와 인터넷 연결이 필요하다.
- GUI에 임의 셸 실행 API를 노출하지 않는다. 허용된 작업과 검증된 설정만 네이티브 계층에서 실행하고, 첫 계정 비밀번호를 로그·설정에 보관하지 않는다.

## 근거

설치 스크립트와 서버를 같은 레포에서 함께 관리해 버전 호환 비용을 줄인다. Windows 전용 관리 계층만 추가하므로 서버의 핵심 실행 계약을 유지하면서 설치 UX를 개선할 수 있다.

당시 동작·검증 범위는 [관리 앱 기능 이력](../windows-manager-feature.md)에 보존한다.
