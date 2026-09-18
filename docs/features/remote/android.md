---
id: "mew-remote-android"
parent: "mew-remote"
title: "Android 환경 점검·화면 연결"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "bed0a9e331155081546a5580d1b26a16663266c47fe7472e00f82e8352aff86c"
files: ["src/components/AndroidPanel.tsx", "server/androidEnv.ts", "server/browserProxy.ts"]
commits: []
---

## 요구사항

Android 개발 환경을 점검하고 준비 명령과 기존 gateway 화면에 접근한다.

### 범위

- SDK·가속·system image·AVD 상태와 서버가 정한 준비 명령 실행·터미널 열기를 제공한다.
- 이미 실행 중인 WebRTC/gateway 화면을 연결한다.

### 경계와 제한

Android Emulator와 system image를 Mew 배포물에 포함하지 않는다. 상태 조회만으로 설치·프로세스 시작·다운로드를 하지 않는다.

### 상세 계약

[Android 지원 범위](../../guides/browser.md)

상위: [분야 지도](MOC.md) · [상위 기능](../remote.md).

<!-- mew:implementation:start -->
## 구현 내용

SDK·가속·system image·AVD 상태와 서버가 정한 준비 명령 실행·터미널 열기를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 호스트 아키텍처·준비 상태가 정확하고 명시적 실행 전에는 설치가 시작되지 않는지 확인한다.

<!-- mew:validation:end -->
