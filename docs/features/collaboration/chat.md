---
id: "mew-collaboration-chat"
parent: "mew-collaboration"
title: "단체 채팅·DM·읽음 확인"
status: "needs-fix"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "3044869fecf2142055b3c8efdd3a51053186e282981a1bed5e342a14f6bbb8ae"
files:
  - src/components/ChatPanel.tsx
  - server/chat.ts
commits: []
---

## 요구사항

- 프로젝트 작업 중 멤버와 메시지·파일 참조를 주고받는다.

### 범위

- 단체방·DM·읽지 않은 대화·메시지별 읽음 상태와 파일 참조 열기를 제공한다.

### 경계와 제한

- 채팅 기능을 허용한 로그인 사용자만 사용한다.
- DM은 앱의 당사자 전달 범위이며 서버 관리자에게 숨기는 암호화 비밀 대화가 아니다.

### 상세 계약

- [협업 사용법](../../guides/collaboration.md) · [채팅 저장·전달 계약](../../development/collaboration.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../collaboration.md).

<!-- mew:implementation:start -->
## 구현 내용

- 단체방·DM·읽지 않은 대화·메시지별 읽음 상태와 파일 참조 열기를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 단체방·DM의 수신 범위와 읽음 상태, 파일 참조 열기를 확인한다.

<!-- mew:validation:end -->
