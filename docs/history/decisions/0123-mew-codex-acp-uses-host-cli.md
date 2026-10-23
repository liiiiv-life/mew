---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Mew Codex ACP는 컴퓨터에 설치된 Codex CLI를 엔진으로 쓴다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0123 — Mew Codex ACP는 컴퓨터에 설치된 Codex CLI를 엔진으로 쓴다"
created: 2026-09-08
updated: 2026-09-11
---

- 날짜: 2026-09-08
- 상태: 채택
- 후속 결정: [0128](0128-mew-browser-oauth-uses-internal-browser.md) — 별도 호스트 제한 OAuth 문맥; 호스트 Codex CLI 선택은 유지
- 부분 대체: [0034](0034-mew-agent-panel-acp-reintroduction.md)·[0060](0060-mew-shared-agent-runtime-registry.md) — Codex 어댑터 내부 엔진 선택 범위
- 결정자: 사용자 + Codex

## 배경

Mew가 버전을 고정한 `@agentclientprotocol/codex-acp`는 안정적인 ACP 계약을 주지만, 패키지에 딸린 `@openai/codex` 버전도 함께 고정한다. 그 결과 컴퓨터의 Codex CLI를 업데이트해도 Mew 세션은 예전 모델 목록과 기능을 계속 볼 수 있었다.

## 선택지

1. 어댑터와 엔진을 함께 고정한다 — 재현성은 높지만 컴퓨터의 Codex 업데이트가 Mew에 반영되지 않는다.
2. ACP 어댑터는 고정하고 엔진만 컴퓨터 설치본을 쓴다 — ACP 계약을 유지하면서 모델과 기능은 사용자가 관리하는 Codex를 따른다.
3. ACP를 없애고 Codex TUI를 직접 연다 — 최신 CLI를 쓰지만 Mew의 채팅·히스토리·예약 작업 계약을 잃는다.

## 결정

2번을 채택한다.

- ACP 프로토콜 어댑터 `node_modules/.bin/codex-acp`는 재현 가능한 Mew 의존성으로 계속 고정한다.
- 실제 Codex 엔진과 `login`·`logout` 명령은 모두 컴퓨터에 설치된 같은 Codex CLI를 쓴다.
- CLI 선택 순서는 `MEW_AGENT_CODEX_CLI_CMD`, 기존 `CODEX_PATH`, `PATH`의 `codex`, 공식 standalone 기본 위치 `~/.local/bin/codex`다.
- `PATH` 검색에서는 Mew의 `node_modules` 안에 있거나 그곳을 가리키는 실행 파일을 제외한다. 호스트 CLI가 없으면 패키지에 딸린 구버전으로 자동 후퇴하지 않고 시작 오류를 드러낸다.
- 선택한 경로는 어댑터에 `CODEX_PATH`로 전달한다. 자격증명 위치 `~/.codex`와 제한된 서버 브라우저 OAuth 계약은 바꾸지 않는다.

## 근거

ACP wire 계약의 안정성과 Codex 엔진의 업데이트 주기는 서로 다르다. 둘을 분리하면 Mew가 의존하는 어댑터 동작은 고정하면서도 사용자가 공식 standalone 설치로 관리하는 모델 목록과 기능을 그대로 사용할 수 있다.

## 결과

- 컴퓨터의 Codex 업데이트는 새 Mew Codex 세션의 엔진과 모델 목록에 반영된다.
- 어댑터 업데이트와 Codex 엔진 업데이트의 수명주기가 분리된다.
- 이미 실행 중인 어댑터는 기존 자식 프로세스를 쓰므로 Mew 코드 적용과 세션 재연결 뒤 새 엔진을 사용한다.
- Mew의 Codex 설치 작업은 ACP 어댑터 의존성을 준비하는 역할로 남고, 호스트 Codex CLI는 공식 standalone 설치로 별도 준비해야 한다.
