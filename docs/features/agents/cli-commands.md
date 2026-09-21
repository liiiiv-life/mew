---
id: "mew-agents-cli-commands"
parent: "mew-agents"
title: "대화에서 CLI 명령 실행"
status: "implemented"
created: "2026-09-18"
updated: 2026-09-21
status_hash: "5e176a299d57b0bec1327fb8a080e5dd0fa635c25be1fadb49b64e49a3afb1c7"
files: ["src/components/agent-command-bubble.tsx", "server/agent-command-runner.ts", "server/agent-command-queue.ts"]
commits: []
---

## 요구사항

에이전트 대화 안에서 셸 명령을 실행하고 결과를 확인한다.

### 범위

- CLI 입력 모드, 명령 상태·중단·터미널 열기, 완료 출력 보기·다운로드를 제공한다.
- Linux에서 설치된 에이전트 합산 OS 메모리 한도를 셸과 자손에 적용하며, 메모리 부족 시 진행 명령을 중단하고 대기 명령을 보존한다([보호 범위](../../operations/agent-memory.md)).

### 경계와 제한

AI 프롬프트와 CLI 명령은 공통 큐의 실행 순서를 따른다. 임의 셸 실행이므로 에이전트·터미널 관련 권한과 서버 실행 경계를 따른다.

### 상세 계약

[터미널·에이전트 사용법](../../guides/terminal-agents.md) · [공통 실행 큐](../../development/agent-sessions.md)

상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

CLI 입력 모드, 명령 상태·중단·터미널 열기, 완료 출력 보기·다운로드를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: AI 작업과 CLI 명령이 대기 순서대로 실행되고 취소·출력 기록·복원이 맞는지 확인한다.

<!-- mew:validation:end -->
