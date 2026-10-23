---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew Claude ACP 어댑터를 공식 agentclientprotocol 패키지로 이전. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0061 — mew Claude ACP 어댑터를 공식 agentclientprotocol 패키지로 이전"
created: 2026-08-20
updated: 2026-09-11
---

- 날짜: 2026-08-20
- 상태: 채택
- 후속 결정: [0117](0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md) — Claude 대화형 탭은 공식 TUI; 예약 작업 ACP 패키지는 유지
- 결정자: 송상훈 (지시)

## 배경

[ADR 0034](0034-mew-agent-panel-acp-reintroduction.md)는 첫 Claude 백엔드로
`@zed-industries/claude-code-acp`를 고정했다. 이 패키지는 deprecated되었고, npm도 계속 업데이트를
받으려면 `@agentclientprotocol/claude-agent-acp`로 이전하라고 안내한다. 후속 저장소는 ACP 공식 GitHub
조직에서 유지된다.

## 선택지

1. deprecated 패키지 `0.16.2` 유지 — 현재 동작 변화는 없지만 이후 수정과 ACP 업데이트를 받지 못한다.
2. 공식 후속 패키지로 이전 — 실행 파일명과 어댑터 버전이 바뀌므로 계약 테스트가 필요하다.

## 결정

2번 채택. Claude 런타임은 버전을 고정한 `@agentclientprotocol/claude-agent-acp`를 로컬 의존성으로
설치하고 `node_modules/.bin/claude-agent-acp`를 실행한다. `npx @latest`를 쓰지 않는 원칙과 ACP 경계,
권한 게이트, 환경변수 override는 유지한다. ADR 0034의 특정 Zed 패키지 선택만 이 결정이 대체한다.

## 근거

- 옛 npm 패키지가 공식 후속 패키지 이름을 직접 명시하며 deprecated 상태다.
- 후속 저장소와 TypeScript SDK·Codex 어댑터가 모두 `agentclientprotocol` 공식 조직에 있어 ACP 관련
  의존성의 유지보수 경계가 한곳으로 모인다.
- 기존 `CLAUDE_CONFIG_DIR`·`CLAUDE_CODE_EXECUTABLE` 환경변수와 ACP stdio 진입점을 후속 어댑터도 지원한다.

## 결과

- 패키지와 실행 파일 이름이 달라진다. 배포 시 `npm install` 후 새 bin이 존재해야 한다.
- 후속 패키지의 Node 요구 버전은 22 이상이다. mew의 지원 런타임도 이 하한을 만족해야 한다.
