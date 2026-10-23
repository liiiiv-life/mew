---
title: "Mew ADR — 런타임·권한·실행 표면"
created: 2026-09-11
updated: 2026-09-22
description: "독립 전 Mew ADR의 주제별 분류를 보존한 이력 지도. 현재 계약은 Mew 자체 문서와 후속 결정을 따른다."
---

상위: [Mew ADR 지도](../MOC.md). 상태가 `채택`이어도 상단의 **후속 결정**이 있으면 변경 범위를 함께 확인한다.

## History / raw — 당시 분류

- [0184 — 뮤캣 도우미 전용 세션과 자동 MCP](../../0184-mewcat-assistant-session-mcp.md)

- [0165 — 공통 에이전트 안내 파일](../../0165-mew-common-agent-guidance-file.md)

- [0157 — 스킬·MCP 원본 설정과 스코프 관리](../../0157-mew-native-agent-harness-management.md)
- [0174 — Mew 소유 커밋 스킬](../../0174-mew-commit-skill-and-automatic-commits.md) — 모든 런타임·Git 자동 커밋의 공통 파일

- [0155 — 프로젝트 컨텍스트 자동 전달과 문서 초기화](../../0155-mew-project-agent-context.md)

- [0143 — Antigravity 공식 ACP와 Google 인증](../../0143-mew-antigravity-official-acp.md)
- [0142 — Claude ACP 채팅과 공식 CLI 인증](../../0142-mew-claude-acp-and-cli-authentication.md)
- [0134 — 작업 패널 분리와 공통 도킹](../../0134-mew-dockable-workspace-panels.md)
- [0123 — Codex ACP는 컴퓨터에 설치된 Codex CLI를 엔진으로 쓴다](../../0123-mew-codex-acp-uses-host-cli.md)
- [0119 — 터미널과 에이전트는 하나의 탭 패널을 쓴다](../../0119-mew-unified-terminal-agent-panel.md) — 탭별 세션 소유권; 패널 분리는 0134
- [0117 — 에이전트 탭의 terminal 표면](../../0117-mew-terminal-agent-tabs-for-claude-and-antigravity.md) — Gemini 경계 유지; Claude ACP는 0142, Antigravity ACP는 0143
- [0101 — 런타임 수명주기 조작은 개별 설정에서 한다](../../0101-mew-runtime-lifecycle-controls.md)
- [0090 — 에이전트 추론 정도와 권한을 분리](../../0090-mew-agent-reasoning-and-permission-controls.md)
- [0089 — Prime Agent는 공식 CLI의 RPC를 Mew 어댑터로 연결](../../0089-mew-prime-agent-official-rpc-adapter.md) — RPC 어댑터; thinking/권한 분리는 0090
- [0074 — 헤더 아이콘에서 탭 런타임을 갈아탄다](../../0074-mew-agent-header-runtime-switch.md)
- [0063 — 런타임별 모델·권한 기본값](../../0063-mew-agent-runtime-saved-defaults.md)
- [0061 — 공식 Claude ACP 어댑터로 이전](../../0061-mew-claude-acp-official-org-migration.md) — 고정 어댑터; 대화형 탭·인증은 0142
- [0060 — 창·셋·예약 작업의 런타임 등록표 통합](../../0060-mew-shared-agent-runtime-registry.md)
- [0044 — CLI 도구 동등성과 ACP fs 해제](../../0044-mew-agent-cli-tool-parity.md)
- [0043 — 워크스페이스 스코프와 런타임 선택](../../0043-mew-agent-workspace-scope-and-runtimes.md) — 워크스페이스 스코프; cwd·런타임 목록은 후속 결정 적용
- [0037 — 권한 모드와 bypass 기본](../../0037-mew-agent-bypass-permissions-default.md)
- [0034 — ACP 에이전트 창 재도입](../../0034-mew-agent-panel-acp-reintroduction.md) — ACP 기본 경계; terminal·권한·패키지는 후속 결정 적용
