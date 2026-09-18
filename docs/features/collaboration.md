---
id: "mew-collaboration"
parent: null
title: "협업·댓글·채팅"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "c467eec96fbbe77a22a73235dd9ca07e031e047903b5f5404f8107946648cb73"
files: []
commits: []
---

## 요구사항

공동 편집과 사람 사이의 대화를 파일·계정 권한 안에서 제공한다.

하위 기능에서 작업 범위와 관련 구현을 고른다. 여러 하위 기능을 바꿀 때도 각각의 상세 계약을 확인한다.

### 하위 기능

- [실시간 공동 편집](collaboration/editing.md)
- [참여자·활성 세션 보기](collaboration/presence.md)
- [댓글·답글·멤버 멘션](collaboration/comments.md)
- [단체 채팅·DM·읽음 확인](collaboration/chat.md)

### 상세 계약

[협업 사용법](../guides/collaboration.md)

상위: [기능 문서 지도](MOC.md).

<!-- mew:implementation:start -->
## 구현 내용

현재 제공하는 하위 기능을 한 작업 영역으로 묶는다. 구현과 제한의 근거는 각 하위 기능에서 연결한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 하위 기능의 경계와 누락 여부를 검토한다. 상위 상태는 자식 상태를 자동 승인하지 않는다.

<!-- mew:validation:end -->
