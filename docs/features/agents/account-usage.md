---
id: "mew-agents-account-usage"
parent: "mew-agents"
title: "연결 계정·구독·사용량 보기"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "1e4c050b97fab4559073b246c0c69f70ffdffecde6ba5a18e4cd996fd21bd2e0"
files: ["src/components/AgentAccountCard.tsx", "server/agentAccount.ts", "server/agentUsage.ts"]
commits: []
---

## 요구사항

- 에이전트의 연결 계정과 사용량 상태를 확인한다.

### 범위

- 지원 런타임에서 계정·플랜·한도와 세션 토큰·API 환산 비용을 표시하고 공식 구독 페이지를 연다.

### 경계와 제한

- 인증 만료와 한도 소진을 구분한다.
- 공급자가 반환하지 않는 계정·플랜은 추정하지 않으며 API 환산 비용을 구독 청구액으로 간주하지 않는다.

### 상세 계약

- [런타임 설정](../../configuration/agent-runtimes.md) · [계정·한도 표시 명세](../../specs/agent-panel.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

- 지원 런타임에서 계정·플랜·한도와 세션 토큰·API 환산 비용을 표시하고 공식 구독 페이지를 연다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 연결 계정 표시와 한도 오류가 구분되고 구독 창 닫기만으로 결제나 작업 재전송이 발생하지 않는지 확인한다.

<!-- mew:validation:end -->
