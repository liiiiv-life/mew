---
id: "mew-agents-cli-commands"
parent: "mew-agents"
title: "대화에서 CLI 명령 실행"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-29"
status_hash: "5e176a299d57b0bec1327fb8a080e5dd0fa635c25be1fadb49b64e49a3afb1c7"
files: ["src/components/agent-command-bubble.tsx", "server/agent-command-runner.ts", "server/agent-command-queue.ts"]
commits: []
---

## 요구사항

- 에이전트 대화 안에서 셸 명령을 실행하고 결과를 확인한다.

### 범위

- 실행 전 큐에서 취소한 명령은 대화 버블·중단 상태를 남기지 않는다. 실제 실행 중단의 기록·출력은 보존한다.

- CLI 입력 모드, 명령 상태·중단·터미널 열기, 완료 출력 보기·다운로드를 제공한다.
- Linux에서 설치된 에이전트 합산 OS 메모리 한도를 셸과 자손에 적용하며, 메모리 부족 시 진행 명령을 중단하고 대기 명령을 보존한다([보호 범위](../../operations/agent-memory.md)).

### 경계와 제한

- AI 프롬프트와 CLI 명령은 공통 큐의 실행 순서를 따른다.
- 임의 셸 실행이므로 에이전트·터미널 관련 권한과 서버 실행 경계를 따른다.

### 상세 계약

- [터미널·에이전트 사용법](../../guides/terminal-agents.md) · [공통 실행 큐](../../development/agent-sessions.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).

<!-- mew:implementation:start -->
## 구현 내용

- 실행 전 취소는 서버 기록의 `cancelledBeforeStart` 표식으로 구분하고 대화 타임라인에서 제외한다. 기존 취소 기록도 조회 시 정규화하며, ID는 재전송 중복 실행 방지를 위해 유지한다.

- CLI 입력 모드, 명령 상태·중단·터미널 열기, 완료 출력 보기·다운로드를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- `agent-clear.test.ts`·`agent-commands.test.ts`·`agent-command-timeline.test.ts`: 개별/전체 큐 취소, 실제 실행 중단과 구분, 재접속·재전송, 구버전 기록 정규화와 버블 제외를 검증한다.

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - AI 작업과 CLI 명령이 대기 순서대로 실행되고 취소·출력 기록·복원이 맞는지 확인한다.

<!-- mew:validation:end -->
