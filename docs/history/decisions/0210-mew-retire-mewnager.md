---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
title: "0210 — mewnager를 폐기하고 공통 mew CLI로 실행 경로를 통일한다"
description: "독립 Windows WSL 관리 앱 mewnager의 소스·CI·현재 기능과 태스크를 제거하고 기존 기록·사용자 데이터를 보존한다. Windows 네이티브의 검증·공개 발행 게이트는 유지한다."
created: "2026-10-14"
updated: "2026-10-14"
---

- 날짜: 2026-10-14
- 상태: 채택
- 결정자: 사용자(mewnager 제거 요청), Codex(구현)
- 대체: [0201](0201-mew-windows-manager-wsl.md) — 독립 Windows WSL 관리 앱 유지 결정
- 부분 대체: [0209](0209-mew-native-windows-host-platform.md) — 관리 앱의 기존 WSL 계약을 유지한다는 조항

## 결정

Windows 네이티브 실행 계층이 추가되었으므로 별도 Tauri 관리 앱을 유지하지 않고 공통 mew CLI와 OS별 실행 계층에 집중한다.

- `mew/apps/manager`의 소스·잠금 파일·빌드 스크립트와 전용 `manager-windows.yml` CI를 제거한다. 공통 mew 앱, Windows psmux·native helper, 원격 데스크톱 구현은 유지한다.
- 기존 기능·태스크 문서를 mew `docs/history/`로 옮겨 현재 기능·태스크 목록에서 제거한다. 기존 사용법·개발 문서 주소는 폐기 안내와 이력 링크를 제공한다. 당시 코드는 Git 이력으로 보존한다.
- 사용자 PC의 관리 앱 실행 파일·WSL 배포판·프로젝트·계정·데이터를 자동 삭제하거나 마이그레이션하지 않는다. WSL 소스 설치는 계속 사용할 수 있다.
- Windows 네이티브의 전체 CI·실기 검증과 첫 공개 발행은 아직 남아 있다. 관리 앱 제거를 공개 지원 완료나 npx 패키지 발행으로 간주하지 않는다.
- 별도 관리 앱을 자동으로 다시 만들지 않는다. 재도입은 사용자의 명시적 요청과 새 결정이 있을 때만 검토한다.

## 결과

앱·배포 경로의 중복을 줄이고 공통 CLI에서 플랫폼 지원과 검증을 관리한다. 현재 계약은 [Windows 네이티브 실행 계층](../../development/windows-native.md), 이전 기능은 [관리 앱 이력](../windows-manager-feature.md)에 남는다.
