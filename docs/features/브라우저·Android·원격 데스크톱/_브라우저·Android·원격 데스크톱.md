---
id: "mew-remote"
parent: null
title: "브라우저·Android·원격 데스크톱"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "fa171a4c0dd4125f3b1ab4b9b1719541e1dfad7e8c2588d363eaf72c977f2e9f"
files: []
commits: []
description: "서버 브라우저와 Android 환경 준비·gateway 화면 및 원격 데스크톱 입력을 묶는 상위 기능 문서. 하위 기능의 범위와 상세 계약 링크를 안내하며 개별 구현·검증의 소유권을 구분한다."
상위파일: "../MOC.md"
---

## 요구사항

- 웹페이지·Android 개발 환경·로그인된 서버 데스크톱에 접근한다.

- 하위 기능에서 작업 범위와 관련 구현을 고른다.
- 여러 하위 기능을 바꿀 때도 각각의 상세 계약을 확인한다.

### 하위 기능

- [서버 브라우저·로그인·팝업](%EC%84%9C%EB%B2%84%20%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80%C2%B7%EB%A1%9C%EA%B7%B8%EC%9D%B8%C2%B7%ED%8C%9D%EC%97%85.md)
- [Android 환경 점검·화면 연결](Android%20%ED%99%98%EA%B2%BD%20%EC%A0%90%EA%B2%80%C2%B7%ED%99%94%EB%A9%B4%20%EC%97%B0%EA%B2%B0.md)
- [원격 데스크톱·터치 입력](%EC%9B%90%EA%B2%A9%20%EB%8D%B0%EC%8A%A4%ED%81%AC%ED%86%B1%C2%B7%ED%84%B0%EC%B9%98%20%EC%9E%85%EB%A0%A5.md)

### 상세 계약

- [브라우저·Android](../../guides/browser.md) · [원격 데스크톱](../../guides/remote-desktop.md)

<!-- mew:implementation:start -->
## 구현 내용

- 현재 제공하는 하위 기능을 한 작업 영역으로 묶는다.
- 구현과 제한의 근거는 각 하위 기능에서 연결한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 하위 기능의 경계와 누락 여부를 검토한다.
  - 상위 상태는 자식 상태를 자동 승인하지 않는다.

<!-- mew:validation:end -->
