---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Codex 계정 사용량은 공식 대시보드를 직접 연다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0104 — Codex 계정 사용량은 공식 대시보드를 직접 연다"
created: 2026-09-01
updated: 2026-09-11
---

- 날짜: 2026-09-01
- 상태: 대체됨: 0130
- 대체 확인: 2026-09-11 — [0130](0130-mew-agent-account-entitlement.md). 계정 조회 금지·외부 대시보드 단독 표시를 공식 CLI 조회·내부 구독 페이지로 대체했다.
- 대체: [0098](0098-mew-agent-account-usage-cli-bridge.md)·[0100](0100-mew-agent-account-usage-summary.md) — Info 팝업의 CLI 계정 사용량 조회·요약·원문 표시 범위
- 결정자: 송상훈 (지시), Codex (구현)

## 배경

Info 팝업의 계정 사용량 조회는 임시 tmux 세션에서 Codex 또는 Claude Code CLI의 슬래시 명령을 실행한 뒤, Codex에서는 같은 정보를 확인할 공식 Usage 대시보드 링크도 제공했다. 사용자는 한도를 보려 할 때 CLI 중계 결과보다 공식 대시보드를 바로 여는 동작을 원한다.

## 결정

- Codex Info 팝업의 `조회`는 `https://chatgpt.com/codex/settings/usage`를 새 탭으로 여는 일반 링크다.
- Mew는 계정 사용량 조회를 위해 CLI·tmux·인증 저장소·공급자 API를 실행하거나 읽지 않는다.
- CLI 원문, Mew가 파싱한 한도 요약, Claude Code의 계정 사용량 조회 UI와 그 API는 제거한다. 공식 웹 대시보드 링크가 없는 런타임은 이 UI를 표시하지 않는다.

## 결과

계정 한도와 청구 정보의 표시·인증·갱신 책임은 공급자 대시보드에 남고, Info 팝업에서의 조회가 로컬 에이전트 세션이나 CLI 상태를 바꾸지 않는다.
