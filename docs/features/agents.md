---
id: "mew-agents"
parent: null
title: "터미널·에이전트·자동화"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "b4a712c188aba3eddb432a8bcd7d40dbdfc871a265699f0235ad9b450b34cc0f"
files: []
commits: []
---

## 요구사항

- 셸·에이전트 작업의 입력, 실행, 복원과 기능 단위 위임을 관리한다.

- 하위 기능에서 작업 범위와 관련 구현을 고른다.
- 여러 하위 기능을 바꿀 때도 각각의 상세 계약을 확인한다.

### 하위 기능

- [tmux 셸 터미널](agents/terminal.md)
- [AI 런타임 설치·인증·실행 설정](agents/runtimes.md)
- [에이전트셋·탭 생성](agents/presets.md)
- [에이전트 대화·큐·복원](agents/conversations.md)
- [에이전트 입력·멘션·스킬·첨부](agents/input.md)
- [연결 계정·구독·사용량 보기](agents/account-usage.md)
- [에이전트 예약 메시지](agents/scheduled-messages.md)
- [대화에서 CLI 명령 실행](agents/cli-commands.md)
- [스킬·MCP 원본 관리](agents/harness.md)
- [기능 기반 개발·Markdown 문서](agents/features.md)
- [프로젝트 명령 버튼](agents/project-commands.md)
- [반복 예약 작업](agents/scheduled-jobs.md)

### 상세 계약

- [터미널·에이전트 사용법](../guides/terminal-agents.md) · [런타임 설정](../configuration/agent-runtimes.md) · [명령·예약 작업](../guides/commands.md)

- 상위: [기능 문서 지도](MOC.md).

<!-- mew:implementation:start -->
## 구현 내용

- 현재 제공하는 하위 기능을 한 작업 영역으로 묶는다.
- 구현과 제한의 근거는 각 하위 기능에서 연결한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 하위 기능의 경계와 누락 여부를 검토한다.
  - 상위 상태는 자식 상태를 자동 승인하지 않는다.

<!-- mew:validation:end -->
