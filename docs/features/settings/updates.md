---
id: "mew-settings-updates"
parent: "mew-settings"
title: "앱 업데이트·운영 진입"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "24b9ec9b4721cf44a384c60d727d8f59e62a1ffb0c0e48aad1304d2d19c99816"
files: ["server/mewUpdate.ts", "server/runMewUpdate.ts"]
commits: []
---

## 요구사항

앱의 업데이트 상태를 확인하고 운영 절차로 연결한다.

### 범위

- 메뉴에서 업데이트 확인·실행과 호스트 관리 명령으로 운영하는 경로를 제공한다.

### 경계와 제한

실행·설정·HTTPS·백업의 상세 기준본은 배포 문서다. 이 기능 문서 정리에서는 업데이트·빌드·재시작을 실행하지 않는다.

### 상세 계약

[업데이트·배포·백업](../../deployment/native.md) · [계정·화면 설정](../../configuration/environment.md) · [실행·검증 불변식](../../../README.md)

상위: [분야 지도](MOC.md) · [상위 기능](../settings.md).

<!-- mew:implementation:start -->
## 구현 내용

메뉴에서 업데이트 확인·실행과 호스트 관리 명령으로 운영하는 경로를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 업데이트 확인과 실제 실행이 구분되고 실패 원인·운영 복구 경로가 명확한지 확인한다.

<!-- mew:validation:end -->
