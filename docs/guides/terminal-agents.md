# 터미널과 에이전트 탭

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

런타임의 `사용`을 누르면 서버가 현재 프로젝트 루트 cwd를 확인한 뒤에만 탭을 만든다. 확인 중에는 선택기를 닫지 않고 진행 상태를 표시하므로 cwd 없는 빈 탭은 만들지 않는다.

헤더 메뉴의 **에이전트**(`Alt+L`)와 **터미널**(`Ctrl+백틱`·`Alt+T`)은 별도 창을 연다. 탭 목록은 현재 루트 프로젝트별로 기억한다. 일반 셸은 터미널에, Claude Code·Antigravity의 공식 CLI TUI와 나머지 ACP 채팅은 에이전트에 표시한다. 새 탭의 cwd는 현재 루트 프로젝트다.

상단 손잡이로 창 전체를 옮기고, 탭을 끌어 다른 구역에 따로 둘 수 있다. 같은 종류의 창의 탭바나 본문 가운데에 탭을 놓으면 합쳐진다. 탭바는 빈 공간까지 모두 받으며, 마지막 탭을 옮긴 창은 자동으로 닫힌다. 경계선을 끌어 크기를 조절하며 배치는 계정에 저장한다. 모바일에서는 같은 종류의 탭을 한 줄로 모아 보여 준다. 패널의 닫기 버튼은 그 칸만 닫으며 다른 패널이 빈자리를 채운다. 탭은 같은 종류의 남은 패널로 모으고, 마지막 패널의 탭도 다시 열 수 있도록 보존한다. 닫은 분할은 다시 열 때 살아나지 않는다. 실행 중인 세션은 유지되고, 탭의 `×`로 세션을 끝낸다. 패널 기준은 [ADR 0134](../../../.mew/docs/decisions/0134-mew-dockable-workspace-panels.md), 권한은 [SECURITY.md](../../SECURITY.md)를 따른다.

⚠️ ACP 채팅 런타임을 `serve.ts` 요청 핸들러 안에서 블로킹 실행하지 않는다. terminal 런타임의 시작 요청은 등록표의 고정 CLI를 tmux에 타이핑한 뒤 즉시 끝나며, 실제 TUI 수명과 스트리밍은 tmux가 소유한다.

- 서버: `server/agentRuntimes.ts`(공통 런타임·표면 등록표) + `server/agentTerminal.ts`(terminal 탭의 tmux 수명) + `server/agentDefaults.ts`(ACP 런타임별 모델·권한 기본값) + `server/agentAcp.ts`(ACP 세션) + `server/agentHost.ts`(ACP 탭별 독립 감독) + `server/agentWs.ts`(WS↔감독 릴레이). 클라이언트: `src/components/AgentPanel.tsx`가 ACP 채팅과 `@mew/tmux-term` 터미널 본문을 표면별로 고른다. 접근은 **owner/manager**(`authorizeTmux`와 같은 집합) — 어느 표면이든 셸을 쓸 수 있어 tmux와 같은 경계여야 한다.
- ACP 채팅 입력창은 `/`로 로컬 스킬을, `@`로 하위 프로젝트·현재 프로젝트의 폴더·파일을 검색해 넣는다. `@` 결과는 **하위 프로젝트 → 폴더 → 파일** 순서이고 같은 종류 안에서는 가나다순이다. 프로젝트 목록은 `GET /api/projects`가 역할에 맞게 돌려주며, 고르면 기존처럼 `#프로젝트명`이 들어간다. 폴더·파일은 `[[프로젝트:경로]]` 토큰으로 들어간다. 스킬 목록은 `GET /api/skills`가 `CODEX_HOME/skills`와 `<워크스페이스>/.agents/skills`의 `SKILL.md`를 읽어 만든다. `/스킬명`을 고르면 브라우저는 스킬 id만 WS에 싣고, 서버가 `server/agentRuntimes.ts`의 런타임 등록표로 실제 프롬프트를 합성한다. **채팅과 입력창 사이의 경계선 전체**를 위아래로 끌어 입력창을 화면 높이의 80%까지 늘릴 수 있다(키보드는 경계선에서 ↑·↓).
- 질문 위에는 전송 시점의 **모델 · 추론 정도 · 권한**을 양쪽 선과 함께 남긴다. 첫 질문도 표시하며, 이전 질문과 셋 중 하나라도 달라질 때만 다시 표시한다. 이 값은 ACP 이벤트 전사에 같이 저장돼 재접속·세션 복원 뒤에도 당시 설정을 보인다.
- `+`와 탭이 없을 때 가운데의 **새 탭** 버튼은 탭을 먼저 만들지 않고 **새 탭 선택기**를 연다. 런타임을 고르면 그 이름의 탭이 열리고, `tmux 터미널`은 전용 셸 세션을, Claude·Antigravity는 전용 tmux TUI를, ACP 런타임은 채팅 세션을 시작한다. 에이전트셋은 모델·역할을 주입할 수 있는 ACP 채팅 런타임만 대상으로 한다. 선택 전에는 탭·WS·프로세스가 없고, 탭 이름은 직접 바꿀 수 있다. 정의는 `GET`·`PUT /api/agent-sets`(owner/manager)로 `<DATA_DIR>/agent-sets.json`에 저장된다 ([ADR 0095](../../../.mew/docs/decisions/0095-mew-agent-sets-as-tab-presets.md)·[ADR 0119](../../../.mew/docs/decisions/0119-mew-unified-terminal-agent-panel.md)).
- 답변의 **현재 워크스페이스 파일 링크**를 누르면 브라우저 새 탭이 아니라 같은 mew에서 해당 프로젝트와 문서 탭을 연다. `:줄`·`#L줄`이 붙으면 그 줄로 이동하며, Markdown도 정확한 원본 줄을 보여 주기 위해 이 경우 Plain으로 연다. `GET /api/agent-file-link?href=`가 서버 절대경로를 노출하지 않고 `{project,path,line}`으로 검증·변환한다(owner/manager). 웹 링크는 계속 새 브라우저 탭으로 연다.
- 탭의 \*\*작업 경로(cwd)\*\*는 새 탭을 열 때 현재 워크스페이스 루트로 정해지며 화면에서 바꾸지 않는다. 경로는 ACP 세션·히스토리의 기준으로 계속 저장하지만, 주소창 형태의 입력줄은 없다 ([ADR 0097](../../../.mew/docs/decisions/0097-mew-agent-panel-removes-cwd-bar.md)).
- ACP 채널은 `/api/agent/ws?runtime=<id>&tab=<id>&cwd=<absolute-path>&resume=<session-id>`이고 terminal 표면은 `POST /api/agent-runtimes/:id/terminal/:tab`으로 전용 tmux를 준비한 뒤 기존 `/api/tmux/ws?session=<server-name>`에 붙는다. 어느 쪽이든 **탭 하나가 세션 하나**다. 패널·브라우저를 닫아도 세션은 남으며, 탭의 `×`만 ACP 감독 또는 terminal tmux를 종료한다. terminal tmux 이름은 `mewagent-*`로 서버가 만들고 사용자 세션 목록에서는 숨긴다.

설치·인증·구독과 공급자별 명령은 [런타임 설정](../configuration/agent-runtimes.md), 복원·큐·전송 형식은 [세션 계약](../development/agent-sessions.md)을 따른다.
