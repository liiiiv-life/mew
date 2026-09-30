---
id: "mew-settings"
parent: null
title: "화면·계정·운영"
status: "verified"
created: "2026-09-18"
updated: "2026-09-30"
status_hash: "66acae9698f920a11450fd0360475c1ab19b8d7e798fdd7f1215e0c9c4cb4d28"
files: []
commits: []
---

## 요구사항

- 사용 환경을 조절하고 접근 권한·서버 운영 상태를 관리한다.

- 하위 기능에서 작업 범위와 관련 구현을 고른다.
- 여러 하위 기능을 바꿀 때도 각각의 상세 계약을 확인한다.

### 하위 기능

- [뮤캣 도우미·대화·Mew 조작](settings/mewcat-assistant.md)

- [패널 배치·모바일·상태 복원](settings/layout-mobile.md)
- [화면·언어·글꼴·단축키 설정](settings/appearance.md)
- [계정·역할·기능 권한·게스트 공유](settings/accounts-access.md)
- [시스템 자원·프로세스 보기](settings/system-resources.md)
- [앱 업데이트·운영 진입](settings/updates.md)
- [Mewcat 마스코트](settings/mewcat.md)

### 상세 계약

- [계정·화면 설정](../configuration/environment.md) · [권한 계약](../development/access-control.md)

- 상위: [기능 문서 지도](MOC.md).

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
