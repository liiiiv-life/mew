---
id: "mew-agents-runtimes"
parent: "mew-agents"
title: "AI 런타임 설치·인증·실행 설정"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "ce50d3fa70fce93520dfd200e419db9b718cebd2b370a52a9250e624fc80aed1"
files: ["src/components/RuntimeSettingsModal.tsx", "src/components/agentRuntimes.tsx", "server/agentRuntimes.ts", "server/agentRuntimeInstall.ts", "server/agentDefaults.ts"]
commits: []
---

## 요구사항

- 지원하는 에이전트 런타임을 선택하고 실행에 필요한 설정을 관리한다.

### 범위

- 런타임 선택·지원되는 설치/제거·로그인/로그아웃·실행 설정과 모델·추론·권한 기본값을 제공한다.

### 경계와 제한

- ACP 채팅과 공식 CLI 터미널 표면, 설치·인증 지원은 런타임별로 다르다.
- 공급자가 제공하지 않는 설정이나 인증 기능을 추정해 표시하지 않는다.

### 상세 계약

- [런타임 설정](../../configuration/agent-runtimes.md) · [패널·로그인 표시 계약](../../specs/agent-panel.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

- 런타임 선택·지원되는 설치/제거·로그인/로그아웃·실행 설정과 모델·추론·권한 기본값을 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 지원 런타임 선택·인증 상태·모델 기본값이 실제 선택과 일치하고 실패 원인을 확인할 수 있는지 검토한다.

<!-- mew:validation:end -->
