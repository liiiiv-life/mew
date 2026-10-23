---
title: "Mew ADR — 대화·탭·감독·큐"
created: 2026-09-11
updated: 2026-09-21
description: "독립 전 Mew ADR의 주제별 분류를 보존한 이력 지도. 현재 계약은 Mew 자체 문서와 후속 결정을 따른다."
---

상위: [Mew ADR 지도](../MOC.md). 상태가 `채택`이어도 상단의 **후속 결정**이 있으면 변경 범위를 함께 확인한다.

## History / raw — 당시 분류

- [0205 — 가용 메모리 기반 에이전트 합산 예산](../../0205-mew-dynamic-agent-memory.md)

- [0198 — 기능 제목 인라인 수정](../../0198-mew-inline-feature-title.md)

- [0197 — 기기별 작업 화면 배치](../../0197-mew-device-local-workspace-layout.md) — 0094·0134의 배치·문서 탭·패널 복원 우선순위 변경

- [0196 — 기능 파일명·문서 계층과 단순 패널](../../0196-mew-file-backed-feature-tree.md) — 0161·0194의 제목·계층·상세 표시 변경

- [0194 — 기능 패널 읽기 전용](../../0194-mew-readonly-feature-panel.md)

- [0192 — 메모리 회복 후 자동 재개](../../0192-mew-agent-memory-auto-resume.md)

- [0186 — 작업 중단 뒤 대기 큐 계속 실행](../../0186-mew-cancel-active-continues-queue.md)

- [0182 — 대화 SQLite·IndexedDB·구간 동기화](../../0182-mew-incremental-conversation-storage.md)

- [0173 — 기능 계층 인라인 명세 편집과 작업 접수](../../0173-mew-inline-feature-edit-dispatch.md)

- [0164 — 메모리 제한과 작업 보류](../../0164-mew-agent-memory-protection.md)

- [0161 — Markdown 기능 문서 기준본](../../0161-mew-feature-markdown-source.md)
- [0159 — 프로젝트 기능 원장과 에이전트 구현 요청](../../0159-mew-feature-driven-development.md)
- [0153 — AI·CLI 공통 실행 큐](../../0153-mew-agent-cli-shared-queue.md)
- [0152 — 에이전트 대화의 CLI 명령과 영구 출력 기록](../../0152-mew-agent-cli-command-records.md)
- [0140 — Codex /clear 경계에서 이전 writer를 반납한다](../../0140-mew-codex-clear-releases-writer.md)
- [0122 — Codex 히스토리 불러오기는 writer를 교체한다](../../0122-mew-codex-history-load-restarts-writer.md)
- [0118 — 에이전트 대기 메시지는 편집하는 동안 실행을 잠근다](../../0118-mew-agent-queue-edit-lock.md)
- [0103 — /clear는 프롬프트 큐의 세션 경계다](../../0103-mew-queued-clear-session-boundary.md)
- [0099 — 에이전트 창의 히스토리에서 새 대화를 시작한다](../../0099-mew-agent-history-new-conversation.md) — 히스토리의 새 대화; 입력 /clear는 0103
- [0097 — 에이전트 창에서 작업 경로 입력줄을 제거한다](../../0097-mew-agent-panel-removes-cwd-bar.md)
- [0096 — 에이전트 탭은 선택을 마친 뒤에 만든다](../../0096-mew-agent-tabs-created-after-selection.md)
- [0095 — 에이전트셋은 탭 시작 프리셋이다](../../0095-mew-agent-sets-as-tab-presets.md)
- [0093 — 프로젝트·에이전트 탭 상태는 계정에 귀속한다](../../0093-mew-account-synced-project-and-agent-tabs.md) — 계정별 탭 원장; UI 상태 확장은 0094
- [0092 — 루트 프로젝트 전환은 에이전트 작업을 종료하지 않는다](../../0092-mew-agent-survives-root-project-switch.md)
- [0091 — 에이전트 탭 예약 전송은 원 세션으로 되돌아간다](../../0091-mew-agent-tab-scheduled-prompts.md)
- [0087 — 에이전트 탭은 루트 프로젝트별로 분리한다](../../0087-mew-agent-tabs-per-root-project.md)
- [0079 — 에이전트 탭은 유휴 종료 후에도 마지막 세션을 자동 복원한다](../../0079-mew-agent-tabs-resume-after-idle.md)
- [0077 — 에이전트 탭은 워크스페이스 밖 작업 경로를 고를 수 있다](../../0077-mew-agent-tab-working-directory.md) — cwd 세션 키; 경로 변경 UI는 0097에서 제거
- [0062 — 런타임 선택 뒤 세션 시작](../../0062-mew-agent-tab-runtime-gate-and-install.md) — 선택 전 실행 금지·설치 경계; 탭 생성은 0096
- [0048 — 감독 프로세스가 에이전트 수명 소유](../../0048-mew-agent-supervisor-process.md) — 독립 감독; 루트 전환 생존은 0092
- [0047 — 디스크 세션 목록·비차단 접속](../../0047-mew-agent-session-list-from-disk-and-nonblocking-connect.md)
- [0046 — 탭 하나가 세션 하나](../../0046-mew-agent-panel-tabs-one-session-per-tab.md) — 탭 = 세션; 생성·저장·실행 표면은 후속 결정 적용
- [0036 — 세션 조작·프롬프트 큐·사용량](../../0036-mew-agent-session-controls-and-usage.md) — 세션·큐 기본 계약; 목록·clear·writer는 후속 결정 적용
