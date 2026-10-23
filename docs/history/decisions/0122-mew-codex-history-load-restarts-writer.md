---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Codex 히스토리 불러오기는 writer를 교체한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0122 — Codex 히스토리 불러오기는 writer를 교체한다"
created: 2026-09-07
updated: 2026-09-07
---

- 날짜: 2026-09-07
- 상태: 채택
- 후속 결정: [0140](0140-mew-codex-clear-releases-writer.md) — Codex `/clear`에서도 프로세스를 교체한다; 히스토리 전환 규칙은 유지
- 부분 대체: [0036](0036-mew-agent-session-controls-and-usage.md) — Codex의 `session/load` 자식 프로세스 재사용 범위
- 결정자: Codex (사용자의 원인 조사·수정 지시)

## 배경

같은 탭에서 `/clear`를 실행하면 Mew는 같은 ACP 연결에 `session/new`를 호출해 새
Codex thread로 이동한다. 탭의 저장 포인터는 새 thread로 바뀐 때문에 이전 thread는
히스토리에서 다시 선택할 수 있다.

그러나 Codex app-server는 그 어댑터 프로세스가 이전 thread에 대해 얻은 writer를
`session/new` 뒤에도 반납하지 않았다. 같은 프로세스에서 이전 thread를 `session/load`하면
`thread ... already has an active writer`로 거절됐다. 다른 탭의 저장 포인터를
비교하는 점유 방지는 이 경우를 막을 수 없다. writer는 같은 탭의 이전 ACP
프로세스에 남아 있기 때문이다.

## 선택지

1. 이전 thread를 히스토리에서 잠근다 — 오류는 없지만 `/clear` 이전 대화로 돌아갈 수 없다.
2. 같은 어댑터에서 `session/load`를 재시도한다 — writer 소유권이 남아 있어 결과가 바뀌지 않는다.
3. Codex 히스토리 전환 전에 어댑터를 종료하고 새 프로세스에서 `session/load`한다 — 전환에 초기화 비용이 들지만 writer를 확실히 반납한다.

## 결정

3번을 채택한다.

- 정확한 `/clear`는 기존처럼 같은 연결에서 큐 경계의 `session/new`로 처리한다.
- Codex 히스토리에서 대화를 선택하면 현재 턴·승인·큐가 비었는지 먼저 확인한다.
- 현재 Codex ACP 어댑터 프로세스를 종료해 writer를 반납하고, 같은 탭 감독 안에서 새 어댑터를 시작해 선택한 ID를 `session/load`한다.
- 선택한 ID 불러오기가 실패하면 새 어댑터에서 바로 전 thread를 다시 불러와 현재 대화를 복구하고 원래 오류를 보여 준다.
- 다른 ACP 런타임은 기존처럼 같은 프로세스에서 `session/load`한다.

## 근거

탭 ID는 Mew 감독의 수명 단위이지 벤더 thread writer의 수명 단위가 아니다.
Codex가 writer를 반납하는 확실한 경계는 app-server 프로세스 종료이므로, 감독과 브라우저
탭을 유지한 채 그 아래 어댑터만 교체하는 것이 가장 좁은 해결이다.

## 결과

- `/clear` 전 thread를 같은 탭에서 다시 열 수 있다.
- Codex 히스토리 전환은 ACP 핸드셰이크와 `session/load` 시간을 매번 지불한다.
- 이 경로는 어댑터 프로세스 교체 후 이전 thread를 복원하는 회귀 테스트로 고정한다.
