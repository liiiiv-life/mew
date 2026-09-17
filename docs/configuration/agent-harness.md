---
title: "스킬·MCP 관리"
created: 2026-09-17
updated: 2026-09-17
---

# 스킬·MCP 관리

상위: [설정](MOC.md). 결정: [ADR 0157](../../../.mew/docs/decisions/0157-mew-native-agent-harness-management.md).

## 사용

에이전트 패널 상단 `i` 오른쪽의 책 아이콘은 **Skills 관리**, 플러그 아이콘은 **MCP 관리**를 연다. 세션 연결 전에도 사용할 수 있다. 두 버튼은 같은 관리창의 해당 탭으로 진입한다.

- 기본 목록은 **전역 → 현재 작업 프로젝트 → 하위 프로젝트** 순서이며, 항목은 이름과 오른쪽 에이전트 표기를 한 줄로 표시한다. 공통 스킬은 `Global`, 전용 항목은 `Codex`·`Claude` 등 에이전트 이름을 표시한다. 이 표기는 소유 에이전트 구분이며 전역/프로젝트 적용 범위는 그룹 제목으로 구분한다. 각 그룹 제목의 화살표를 누르면 개별 접기·펼치기가 가능하고 항목 수는 접힌 상태에도 보인다. 접힘 상태는 창을 연 동안 Skills/MCP별로 유지하며 상세 선택·편집 초안은 그대로 둔다. 이름이 같아도 출처가 다르면 각각 표시하고 마우스를 올리면 소유 에이전트·경로를 확인할 수 있다.
- 스코프·에이전트 선택과 검색을 함께 쓸 수 있다. `공통`은 `.agents/skills`에 저장된 스킬을 뜻한다. 모든 런타임이 이 경로를 자동 발견한다는 뜻은 아니다.
- 항목을 선택하면 상세 영역에 설명·소유 에이전트·읽기 전용 여부·원문·원본 경로·소유 범위를 표시한다. 스킬은 포함 파일 목록도 펼쳐 볼 수 있다. MCP 상세는 선택한 서버 하나의 JSON이며 다른 계정·설정 필드는 반환하지 않는다.
- **추가**에서 위치·이름·내용을 지정한다. **수정 → 저장**은 스킬 원문 또는 선택한 MCP 서버만 변경한다. MCP 입력은 JSON이고 저장은 공급자의 설정 형식을 따른다.
- **이동**에서 대상 스코프·에이전트를 고른 뒤 확인한다. 스킬은 스크립트·참조 파일까지 함께 이동한다. MCP는 동일 에이전트의 스코프 사이에서만 이동한다. 목적지에 같은 이름이 있으면 실패하며 기존 항목을 보존한다.
- **삭제**는 확인 후 실행한다. 스킬은 폴더 전체, MCP는 서버 설정 하나를 삭제한다. 패키지·시스템 스킬과 심볼릭 링크는 읽기 전용이다.
- 외부 편집으로 원본이 달라졌으면 저장·이동·삭제를 거부한다. 편집 내용은 화면에 남으므로 복사하거나 다시 불러올 수 있다. 닫기·종류/스코프 전환·새로고침에서 저장하지 않은 초안을 확인한다.
- 모바일은 목록과 상세를 전환한다. Esc·뒤로가기는 공통 오버레이 스택을 사용하며 키보드 포커스는 팝업 안에서 유지하고 닫으면 원래 버튼으로 돌아간다.

전역 설정은 **Mew 서버를 실행하는 OS 사용자** 기준이다. 여러 Mew 계정이 같은 전역 설정을 공유한다. API는 `agent` 기능 권한을 요구하며 기존 서버 제어 기능과 같은 권한 경계를 따른다([접근 계약](../development/access-control.md)).

## 지원 위치

아래는 기본 경로다. `CODEX_HOME`, `CLAUDE_CONFIG_DIR`/`MEW_AGENT_CONFIG_DIR`, `XDG_CONFIG_HOME`, `KIMI_CODE_HOME`, `HERMES_HOME`, `OPENCLAW_STATE_DIR`/`OPENCLAW_CONFIG_PATH`, `GEMINI_HOME`과 Mew 런타임 설정의 해당 env를 반영한다. 사용자 정의 실행 인자의 임의 설정 경로·프로필·추가 스킬 경로는 자동 해석하지 않는다.

### 스킬

| 소유 | 전역 | 프로젝트 |
| --- | --- | --- |
| 공통 | `~/.agents/skills` | `.agents/skills` |
| Codex | `~/.codex/skills` | `.codex/skills` |
| Claude | `~/.claude/skills` | `.claude/skills` |
| Cursor | `~/.cursor/skills` | `.cursor/skills` |
| OpenCode | `~/.config/opencode/skills` | `.opencode/skills` |
| Kimi Code | `~/.kimi-code/skills` | `.kimi-code/skills` |
| Prime Agent | `~/.prime/agent/skills` | `.prime/agent/skills` |
| Antigravity | `~/.gemini/antigravity/skills` | `.agent/skills` |
| Hermes | `~/.hermes/skills` | 공통 스킬 위치 사용 |
| OpenClaw | `~/.openclaw/skills` | `skills` |

`SKILL.md` 디렉터리를 재귀 탐색한다. Kimi·Prime의 루트 단일 `.md` 형식도 지원하며 다른 위치로 이동하면 `<이름>/SKILL.md` 디렉터리 형식으로 바꾼다. 기존 `.kimi/skills`, `~/.gemini/antigravity-cli/skills`가 있으면 별도로 표시한다. Codex·Claude의 `plugins/cache`와 Codex `.system`은 원문 열람만 지원한다. 플러그인 캐시에 남은 이전 버전도 표시될 수 있으므로 “현재 활성 스킬” 목록으로 해석하지 않는다.

### MCP

| 런타임 | 전역 | 프로젝트 | 서버 키 |
| --- | --- | --- | --- |
| Codex | `~/.codex/config.toml` | `.codex/config.toml` | `mcp_servers` |
| Claude | `~/.claude.json` | `.mcp.json`(공유), 전역 파일의 `projects[절대경로]`(개인) | `mcpServers` |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` | `mcpServers` |
| OpenCode | `~/.config/opencode/opencode.json`, `.jsonc` | `opencode.json`, `.jsonc` | `mcp` |
| Kimi Code | `~/.kimi-code/mcp.json` | `.kimi-code/mcp.json` | `mcpServers` |
| Prime Agent | `~/.prime/agent/settings.json` | `.prime/agent/settings.json` | `mcpServers` |
| Antigravity CLI/IDE | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` | `mcpServers` |
| Hermes | `~/.hermes/config.yaml` | 없음 | `mcp_servers` |
| OpenClaw | `~/.openclaw/openclaw.json` | 없음 | `mcp.servers` |

기존 `.kimi/mcp.json`·`~/.gemini/antigravity/mcp_config.json`도 존재할 때 표시한다. Claude의 사용자 지정 `CLAUDE_CONFIG_DIR`에는 `.claude.json`이 들어간다. Codex·Claude 플러그인 캐시의 `.mcp.json`·`mcp.json`·`mcp_config.json`은 읽기 전용이다. MCP 공통 파일을 임의 생성하거나 다른 런타임에 설정을 복제하지 않는다.

## 저장·적용 범위

- JSON/JSONC는 해당 경로만 패치하고 YAML은 문서 노드 편집으로 주변 설정·주석을 보존한다. Codex TOML은 MCP 테이블을 다시 직렬화하고 다른 설정의 값을 검증한다. MCP 구역의 주석·서식은 정리되며 인라인 `mcp_servers = {...}`는 안전하게 수정할 수 없어 거부한다.
- OpenClaw JSON5는 모든 설정값을 유지한 JSON으로 저장한다. 주석·서식 제거를 관리창에서 안내한다. JSON은 유효한 JSON5다.
- 잘못된 문법은 경고로 표시하며 덮어쓰지 않는다. 생성·수정은 기본 MCP 전송 필드와 에이전트별 핵심 형식도 검사한다. 공급자의 전체 스키마 검증이나 서버 연결 검증은 아니다.
- 저장은 같은 디렉터리 임시 파일과 rename을 사용하고 원본 모드를 유지한다. 새 파일은 0600이다. 스킬 폴더 이동은 rename이며 디스크 간 이동은 원본을 유지하고 거부한다. 내부 심볼릭 링크가 있는 스킬의 이동·삭제도 거부한다.
- 두 파일에 걸친 MCP 이동은 대상을 먼저 저장한다. 이후 원본 삭제가 실패하면 양쪽 사본을 보존하고 부분 완료 오류를 표시한다. 같은 파일 안의 Claude 개인→전역 이동은 한 번에 저장한다.
- 스킬 상세·변경은 폴더 전체 내용의 해시로 충돌을 검사한다. MCP는 원본 설정 파일 전체의 해시를 사용한다. 파일 크기 2MiB, 스킬 폴더 32MiB 제한이 있다.
- 프로젝트 탐색은 현재 cwd 아래 실제 디렉터리에서 `.mew`·`.git`·지원 설정 위치가 있는 폴더를 찾는다. 숨김 폴더·의존성·빌드 산출물·archives·docs-editor는 순회하지 않는다. 깊이 16/12,000개 폴더 한도에 도달하면 경고하고 해당 폴더를 cwd로 다시 열도록 안내한다.
- 관리창은 MCP를 실행·연결하거나 세션을 재시작하지 않는다. 네이티브 CLI의 재시작·신뢰·설정 우선순위가 적용된다. Antigravity 항목은 공식 CLI/IDE 설정이며 Mew가 고정한 ACP 1.1.1의 자동 로딩 여부는 검증하지 않았다. Prime은 MCP 정의 외에 Python 연동 스킬이 필요할 수 있다.

## 입력창과 API

`GET /api/skills?cwd=...&runtime=...`는 해당 런타임 전용·공통 스킬을 cwd부터 상위 Git 루트까지 찾고 전역을 합친다. 같은 이름이면 가까운 프로젝트를 우선하며 각 스코프에서는 전용이 공통보다 먼저다. 하위·형제 프로젝트는 프롬프트 후보에 섞지 않는다. 관리창 변경 뒤 열린 입력창 후보를 다시 불러오며, 즉시 전송·대기 메시지 편집·예약 메시지도 동일한 cwd/runtime 규칙을 사용한다. 이것은 Mew의 명시적 스킬 선택 규칙이며 네이티브 런타임의 자동 발견 우선순위를 대신하지 않는다.

| API | 계약 |
| --- | --- |
| `GET /api/agent/harness?cwd=...&kind=skills\|mcp` | 스코프·런타임·저장 위치·항목 요약·읽기 경고. MCP 원문·인증 값은 제외 |
| `GET /api/agent/harness/detail?cwd=...&kind=...&id=...` | 선택 항목 원문·revision·포함 파일 목록 |
| `POST /api/agent/harness` | `{cwd, kind, action, id?, revision?, target?, name?, content?}`. action은 create/save/move/delete |

원본 경로를 요청에서 직접 받지 않고 서버가 다시 발견한 ID에 매칭한다. 모든 응답은 no-store이며 원문·인증 값은 로그나 localStorage에 저장하지 않는다. 상세 원문은 사용자가 선택한 동안 브라우저 메모리에서 편집한다.

## 검증·출처

`server/agent-harness.test.ts`는 임시 홈/프로젝트의 스코프·중복·링크·부속 파일·이동 충돌·외부 변경·설정 보존·런타임 경로·권한을 검사한다. `server/agent-harness-ui.test.ts`는 실제 React/Chromium에서 데스크톱·모바일 검색/필터·읽기 전용·초안·오류 복원·수정·이동·삭제·MCP 추가·포커스를 검증한다. 실제 사용자 설정 변경이나 MCP 실행은 테스트하지 않는다.

설정 위치·형식은 [Codex MCP](https://developers.openai.com/codex/mcp/), [Claude MCP](https://code.claude.com/docs/en/mcp), [Claude skills](https://code.claude.com/docs/en/skills), [Cursor skills](https://cursor.com/docs/skills), [Cursor MCP](https://cursor.com/docs/mcp), [OpenCode skills](https://opencode.ai/docs/skills/), [OpenCode MCP](https://opencode.ai/docs/mcp-servers/), [Kimi 설정](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/config-files), [Prime skills](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/skills.md), [Prime MCP](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/README.md#mcp-integrations), [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/), [OpenClaw skills](https://docs.openclaw.ai/tools/skills), [OpenClaw MCP](https://docs.openclaw.ai/tools/mcp), [Antigravity MCP](https://antigravity.google/docs/cli/mcp/)의 공식 문서·소스를 기준으로 확인했다.
