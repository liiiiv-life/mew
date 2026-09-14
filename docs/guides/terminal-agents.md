# 터미널과 에이전트 탭

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

## 대화 진행과 기록

헤더 메뉴 → **에이전트**(`Alt+L`) → `+`에서 런타임을 고르고 설치·로그인을 마친다. Claude Agent·Antigravity·Codex 등은 ACP 채팅에서 조작한다. 일반 셸은 메뉴 → **터미널**(`Ctrl+백틱`·`Alt+T`)에서 연다.

- ACP 입력창에 프롬프트를 적고 전송 버튼 또는 `Ctrl+Enter`로 보낸다. `@` 참조·`/` 스킬·첨부·입력 기록은 [입력 사용법](../specs/agent-input-mentions.md)을 따른다.
- 진행 중에도 다음 메시지를 보낼 수 있다. 대기 큐에서 본문을 눌러 수정하거나 순서를 바꾸며, 현재 턴이 끝나면 순서대로 실행된다. 일반 대기 메시지를 편집하는 동안 큐는 실행을 기다린다. 중단은 현재 작업 취소와 일반 대기열 비우기를 함께 요청한다.
- 작업 버블에서 진행·완료·중단·실패 상태와 걸린 시간·작업 내역을 확인한다. 세션의 `i`에서는 지원 런타임의 토큰·API 환산 비용과 [계정·구독 정보](../configuration/agent-runtimes.md#설치로그인구독)를 확인한다.
- `/clear`는 새 대화를 시작한다. 작업 중이면 앞선 작업이 끝난 뒤 새 대화로 전환하고, 이후 대기 메시지는 새 대화에서 실행한다. 이전 대화는 히스토리에 남는다.
- Codex는 `/clear` 전환 때 이전 대화의 잠금까지 해제하므로 다른 탭에서도 그 기록을 열 수 있다. 전환에 실패하면 기존 대화와 대기 메시지를 보존하고 실행을 멈춘다. `/clear`를 다시 보내 전환을 완료한다. 이 수정 전에 열린 탭은 작업 완료 후 탭을 닫고 다시 열어야 새 코드가 적용된다.
- 히스토리에서 지난 세션을 골라 이어 쓴다. 작업·승인·대기 메시지가 남아 있을 때는 세션을 전환하지 않는다. 런타임에 따라 기록 목록·불러오기 지원이 다르며 TUI의 기록은 공식 CLI 안에서 조작한다.
- 패널 닫기는 세션을 유지하고 탭의 `×`는 세션을 종료한다. 입력줄의 시계는 [한 번 보낼 예약 메시지](../specs/agent-scheduled-prompts.md), 헤더의 예약 작업은 [독립 반복 작업](commands.md#예약-작업-dataschedulesjson)이다.

## 외부 CLI에서 이어 쓴 대화

Codex CLI에서 같은 세션을 `resume`해 이어 쓴 뒤 mew에 돌아오면 **히스토리 → 현재 대화 새로고침**으로 최신 기록을 읽는다. 외부 CLI에서 진행 중인 작업을 마치고 종료한 뒤 사용한다. mew에서도 진행 중인 턴이나 대기 메시지가 없어야 한다. 같은 세션 ID를 유지하며, 동일한 기존 턴의 소요 시간·작업 기록은 보존하고 외부에서 추가한 대화를 반영한다. 일반 브라우저 새로고침은 살아 있는 mew 감독의 메모리 기록을 다시 보여줄 수 있다.

복원 코드 업데이트 전에 실행된 감독은 서버 재시작 뒤에도 남을 수 있다. 그 경우 작업 종료 후 기존 에이전트 탭을 닫고, 새 Codex 탭의 히스토리에서 같은 세션을 선택해야 새 복원 코드가 적용된다. 탭 닫기는 Codex 원본 히스토리를 삭제하지 않는다.

## 탭 만들기와 배치

런타임의 `사용`을 누르면 서버가 현재 프로젝트 루트 cwd를 확인한 뒤에만 탭을 만든다. 확인 중에는 선택기를 닫지 않고 진행 상태를 표시하므로 cwd 없는 빈 탭은 만들지 않는다.

헤더 메뉴의 **에이전트**(`Alt+L`)와 **터미널**(`Ctrl+백틱`·`Alt+T`)은 별도 창을 연다. 탭 목록은 현재 루트 프로젝트별로 기억한다. 일반 셸은 터미널에, Claude Agent·Antigravity·Codex 등의 ACP 채팅은 에이전트에 표시한다. 새 탭의 cwd는 현재 루트 프로젝트다.

상단 손잡이로 창 전체를 옮기고, 탭을 끌어 다른 구역에 따로 둘 수 있다. 같은 종류의 창의 탭바나 본문 가운데에 탭을 놓으면 합쳐진다. 탭바는 빈 공간까지 모두 받으며, 마지막 탭을 옮긴 창은 자동으로 닫힌다. 경계선을 끌어 크기를 조절하며 배치는 계정에 저장한다. 모바일에서는 같은 종류의 탭을 한 줄로 모아 보여 준다. 패널의 닫기 버튼은 그 칸만 닫으며 다른 패널이 빈자리를 채운다. 탭은 같은 종류의 남은 패널로 모으고, 마지막 패널의 탭도 다시 열 수 있도록 보존한다. 닫은 분할은 다시 열 때 살아나지 않는다. 실행 중인 세션은 유지되고, 탭의 `×`로 세션을 끝낸다. 패널 기준은 [ADR 0134](../../../.mew/docs/decisions/0134-mew-dockable-workspace-panels.md), 권한은 [SECURITY.md](../../SECURITY.md)를 따른다.

⚠️ ACP 채팅 런타임을 `serve.ts` 요청 핸들러 안에서 블로킹 실행하지 않는다. terminal 런타임의 시작 요청은 등록표의 고정 CLI를 tmux에 타이핑한 뒤 즉시 끝나며, 실제 TUI 수명과 스트리밍은 tmux가 소유한다.

- 서버: `server/agentRuntimes.ts`(공통 런타임·표면 등록표) + `server/agentTerminal.ts`(terminal 탭의 tmux 수명) + `server/agentDefaults.ts`(ACP 런타임별 모델·권한 기본값) + `server/agentAcp.ts`(ACP 세션) + `server/agentHost.ts`(ACP 탭별 독립 감독) + `server/agentWs.ts`(WS↔감독 릴레이). 클라이언트: `src/components/AgentPanel.tsx`가 ACP 채팅과 `@mew/tmux-term` 터미널 본문을 표면별로 고른다. 접근은 **owner/manager**(`authorizeTmux`와 같은 집합) — 어느 표면이든 셸을 쓸 수 있어 tmux와 같은 경계여야 한다.
- ACP 채팅 입력창의 `/` 스킬, `@` 프로젝트·폴더·파일 멘션, 첨부·입력 기록·높이 조절은 [입력 사용법](../specs/agent-input-mentions.md)을 따른다. 스킬은 `CODEX_HOME/skills`와 `<워크스페이스>/.agents/skills`에서 읽고, 서버가 선택한 스킬 id를 런타임 등록표에 따라 프롬프트로 합성한다.
- 질문 위에는 전송 시점의 **모델 · 추론 정도 · 권한**을 양쪽 선과 함께 남긴다. 첫 질문도 표시하며, 이전 질문과 셋 중 하나라도 달라질 때만 다시 표시한다. 이 값은 ACP 이벤트 전사에 같이 저장돼 재접속·세션 복원 뒤에도 당시 설정을 보인다.
- `+`와 탭이 없을 때 가운데의 **새 탭** 버튼은 탭을 먼저 만들지 않고 **새 탭 선택기**를 연다. 런타임을 고르면 그 이름의 탭이 열리고, `tmux 터미널`은 전용 셸 세션을, Antigravity·Claude를 포함한 ACP 런타임은 채팅 세션을 시작한다. 에이전트셋은 모델·역할을 주입할 수 있는 ACP 채팅 런타임만 대상으로 한다. 선택 전에는 탭·WS·프로세스가 없고, 탭 이름은 직접 바꿀 수 있다. 정의는 `GET`·`PUT /api/agent-sets`(owner/manager)로 `<DATA_DIR>/agent-sets.json`에 저장된다 ([ADR 0095](../../../.mew/docs/decisions/0095-mew-agent-sets-as-tab-presets.md)·[ADR 0119](../../../.mew/docs/decisions/0119-mew-unified-terminal-agent-panel.md)).
- 답변의 **현재 워크스페이스 파일 링크**를 누르면 브라우저 새 탭이 아니라 같은 mew에서 해당 프로젝트와 문서 탭을 연다. `:줄`·`#L줄`이 붙으면 그 줄로 이동하며, Markdown도 정확한 원본 줄을 보여 주기 위해 이 경우 Plain으로 연다. `GET /api/agent-file-link?href=`가 서버 절대경로를 노출하지 않고 `{project,path,line}`으로 검증·변환한다(owner/manager). 웹 링크는 계속 새 브라우저 탭으로 연다.
- 탭의 \*\*작업 경로(cwd)\*\*는 새 탭을 열 때 현재 워크스페이스 루트로 정해지며 화면에서 바꾸지 않는다. 경로는 ACP 세션·히스토리의 기준으로 계속 저장하지만, 주소창 형태의 입력줄은 없다 ([ADR 0097](../../../.mew/docs/decisions/0097-mew-agent-panel-removes-cwd-bar.md)).
- ACP 채널은 `/api/agent/ws?runtime=<id>&tab=<id>&cwd=<absolute-path>&resume=<session-id>`이고 terminal 표면은 `POST /api/agent-runtimes/:id/terminal/:tab`으로 전용 tmux를 준비한 뒤 기존 `/api/tmux/ws?session=<server-name>`에 붙는다. 어느 쪽이든 **탭 하나가 세션 하나**다. 패널·브라우저를 닫아도 세션은 남으며, 탭의 `×`만 ACP 감독 또는 terminal tmux를 종료한다. terminal tmux 이름은 `mewagent-*`로 서버가 만들고 사용자 세션 목록에서는 숨긴다.

설치·인증·구독과 공급자별 명령은 [런타임 설정](../configuration/agent-runtimes.md), 복원·큐·전송 형식은 [세션 계약](../development/agent-sessions.md)을 따른다.
