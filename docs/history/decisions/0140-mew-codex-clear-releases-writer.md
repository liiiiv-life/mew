---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Codex /clear 경계에서 이전 writer를 반납한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0140 — Codex /clear 경계에서 이전 writer를 반납한다"
created: 2026-09-14
updated: 2026-09-14
---

- 날짜: 2026-09-14
- 상태: 채택
- 부분 대체: [0122](0122-mew-codex-history-load-restarts-writer.md) · [0103](0103-mew-queued-clear-session-boundary.md) — Codex `/clear`의 어댑터 프로세스 재사용
- 결정자: Codex (사용자의 잠금 미반납 문제 수정 지시)

## 배경

Codex에서 같은 프로세스로 `session/new`만 호출하면 이전 대화의 writer가 남는다. 탭 포인터는 새 대화를 가리키므로 다른 탭의 점유 검사로도 이전 대화의 잠금을 설명하거나 해제할 수 없다.

## 선택지

1. 히스토리 불러오기 때만 프로세스를 교체한다 — 다른 탭에서 이전 기록에 접근하는 동안 잠금이 남는다.
2. `session/close`를 호출한다 — 현재 어댑터는 `thread/unsubscribe`로 전달하며 즉시 unload를 보장하지 않는다.
3. `/clear` 큐 경계에서 Codex 어댑터와 자식 프로세스를 종료한 뒤 새 연결을 시작한다.

## 결정

3번을 채택한다. 앞선 작업을 완료한 뒤 프로세스 종료를 기다리고, 새 ACP 연결의 새 대화를 채택한다. 탭·감독·대기 메시지·편집 소유권은 유지한다. 다른 런타임의 `/clear`와 Codex 히스토리 전환 규칙은 유지한다.

새 연결이나 대화 생성에 실패하면 기존 전사와 포인터를 보존하고 뒤의 큐를 멈춘다. `/clear` 재시도로 경계를 완료한 뒤에만 뒤 메시지를 실행한다. 종료 중 탭을 닫으면 새 프로세스를 만들지 않는다.

## 근거

프로세스 종료는 writer 해제의 확실한 경계다. [공식 app-server 문서](https://learn.chatgpt.com/docs/app-server#unsubscribe-from-a-loaded-thread)의 unsubscribe는 구독 해제 후 유휴 유예 기간을 두므로 즉시 재접속 보장에 쓰지 않는다.
