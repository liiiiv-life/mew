---
id: "mew-agents-cli-commands"
parent: "mew-agents"
title: "대화에서 CLI 명령 실행"
status: "implemented"
created: "2026-09-18"
updated: "2026-10-03"
status_hash: "5e176a299d57b0bec1327fb8a080e5dd0fa635c25be1fadb49b64e49a3afb1c7"
files: ["src/components/agent-command-bubble.tsx", "server/agent-command-runner.ts", "server/agent-command-queue.ts"]
commits: []
---

## 요구사항

- 에이전트 대화 안에서 셸 명령을 실행하고 결과를 확인한다.

### 범위

- 실행 전 큐에서 취소한 명령은 대화 버블·중단 상태를 남기지 않는다. 실제 실행 중단의 기록·출력은 보존한다.

- 입력 맨 앞의 `! `를 제거하며 일반/CLI 모드를 양방향 전환한다. 기존 버튼과 동일한 전환 제한을 따른다.
- CLI 입력 모드, 명령 상태·중단·터미널 열기, 완료 출력 보기·다운로드를 제공한다.
- Linux에서 설치된 에이전트 합산 OS 메모리 한도를 셸과 자손에 적용하며, 메모리 부족 시 진행 명령을 중단하고 대기 명령을 보존한다([보호 범위](../../operations/agent-memory.md)).

### 경계와 제한

- AI 프롬프트와 CLI 명령은 공통 큐의 실행 순서를 따른다.
- 임의 셸 실행이므로 에이전트·터미널 관련 권한과 서버 실행 경계를 따른다.

### 상세 계약

- [터미널·에이전트 사용법](../../guides/terminal-agents.md) · [공통 실행 큐](../../development/agent-sessions.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](_%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94.md).

<!-- mew:implementation:start -->
## 구현 내용

- `! ` 접두사는 현재 모드의 반대 값을 지정한다. 편집기의 문서·커서 중복 알림으로 모드가 다시 돌아가는 것을 방지한다.

- 실행 전 취소는 서버 기록의 `cancelledBeforeStart` 표식으로 구분하고 대화 타임라인에서 제외한다. 기존 취소 기록도 조회 시 정규화하며, ID는 재전송 중복 실행 방지를 위해 유지한다.

- 입력 맨 앞의 `! `를 제거하며 일반/CLI 모드를 양방향 전환한다. 기존 버튼과 동일한 전환 제한을 따른다.
- CLI 입력 모드, 명령 상태·중단·터미널 열기, 완료 출력 보기·다운로드를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 2026-10-03: React 렌더 전 문서·커서 변경이 연속 통지될 때 문자만 제거되고 모드가 돌아오는 현상을 수정 전 코드로 재현했다. 수정 후 데스크톱·모바일 CLI UI 회귀 테스트와 타입·대상 린트 검사가 통과했다.

- 2026-10-03: 격리 Chromium의 데스크톱·모바일에서 `! ` 양방향 전환, 접두사 제거, 나머지 본문·맨 앞 커서 보존과 본문 중간의 전환 방지를 확인했다. 기존 CLI UI 회귀 테스트·타입·대상 린트·UI 검사·문서 링크 검사가 통과했다. 문서 허용목록 검사는 기존 `todo/docs/` 미등록 경계로 실패했다. 빌드·서버 재시작은 수행하지 않았다.

- `agent-clear.test.ts`·`agent-commands.test.ts`·`agent-command-timeline.test.ts`: 개별/전체 큐 취소, 실제 실행 중단과 구분, 재접속·재전송, 구버전 기록 정규화와 버블 제외를 검증한다.

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - AI 작업과 CLI 명령이 대기 순서대로 실행되고 취소·출력 기록·복원이 맞는지 확인한다.

<!-- mew:validation:end -->
