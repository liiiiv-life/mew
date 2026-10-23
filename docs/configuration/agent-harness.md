---
title: "스킬·MCP 관리"
created: 2026-09-17
updated: 2026-10-19
description: "Skills·MCP 관리창의 출처·스코프별 원본 관리·보호 및 API와 외부 로컬 스프라이트 MCP 연결을 설명한다. 커밋 메시지의 선택적 언어별 교정과 AI 패널의 적용 제한, 문서화 진입점·전문 스킬의 연결과 출처 고정·원문·번역 규칙을 안내한다."
상위파일: "MOC.md"
---

결정: [ADR 0157](../history/decisions/0157-mew-native-agent-harness-management.md).

## 사용

에이전트 패널 상단 `i` 오른쪽의 책 아이콘은 **Skills 관리**, 플러그 아이콘은 **MCP 관리**를 연다. 세션 연결 전에도 사용할 수 있다. 두 버튼은 같은 관리창의 해당 탭으로 진입한다. 오른쪽 톱니 버튼은 별도의 [에이전트 기본 지침 설정](../guides/project-setup.md#공통-안내-파일-편집)을 연다.

- 기본 목록은 **Mew(스킬만) → 전역 → 현재 작업 프로젝트 → 하위 프로젝트** 순서이며, 항목은 이름과 오른쪽 에이전트 표기를 한 줄로 표시한다. 공통 스킬은 `Global`, 전용 항목은 `Codex`·`Claude` 등 에이전트 이름을 표시한다. 이 표기는 소유 에이전트 구분이며 전역/프로젝트 적용 범위는 그룹 제목으로 구분한다. 각 그룹 제목의 화살표를 누르면 개별 접기·펼치기가 가능하고 항목 수는 접힌 상태에도 보인다. 접힘 상태는 창을 연 동안 Skills/MCP별로 유지하며 상세 선택·편집 초안은 그대로 둔다. 이름이 같아도 출처가 다르면 각각 표시하고 마우스를 올리면 소유 에이전트·경로를 확인할 수 있다.
- 스코프·에이전트 선택과 검색을 함께 쓸 수 있다. `공통`은 `.agents/skills`에 저장된 스킬을 뜻한다. 모든 런타임이 이 경로를 자동 발견한다는 뜻은 아니다.
- 스코프·에이전트 필터와 추가·이동의 대상 위치는 공용 `SelectField` 자체 드롭다운을 사용한다. 대상 위치에는 전역/프로젝트와 에이전트를 함께 표시한다. 방향키로 탐색하고 Enter/Space로 확정하며, Esc·뒤로가기는 목록부터 닫는다. 선택 확정 시 기존 초안 보호를 거치고 저장 중에는 선택기를 비활성화한다. 모바일에서도 같은 목록을 터치로 선택한다.
- 항목을 선택하면 상세 영역에 설명·소유 에이전트·읽기 전용 여부·원문·원본 경로·소유 범위를 표시한다. 스킬은 포함 파일 목록도 펼쳐 볼 수 있다. MCP 상세는 선택한 서버 하나의 JSON이며 다른 계정·설정 필드는 반환하지 않는다.
- **추가**에서 위치·이름·내용을 지정한다. **수정 → 저장**은 스킬 원문 또는 선택한 MCP 서버만 변경한다. MCP 입력은 JSON이고 저장은 공급자의 설정 형식을 따른다.
- **이동**에서 대상 스코프·에이전트를 고른 뒤 확인한다. 스킬은 스크립트·참조 파일까지 함께 이동한다. MCP는 동일 에이전트의 스코프 사이에서만 이동한다. 목적지에 같은 이름이 있으면 실패하며 기존 항목을 보존한다.
- **삭제**는 확인 후 실행한다. 스킬은 폴더 전체, MCP는 서버 설정 하나를 삭제한다. 패키지·시스템 스킬과 심볼릭 링크는 읽기 전용이다.
- 외부 편집으로 원본이 달라졌으면 저장·이동·삭제를 거부한다. 편집 내용은 화면에 남으므로 복사하거나 다시 불러올 수 있다. 닫기·종류/스코프 전환·새로고침에서 저장하지 않은 초안을 확인한다.
- 모바일은 목록과 상세를 전환한다. Esc·뒤로가기는 공통 오버레이 스택을 사용하며 키보드 포커스는 팝업 안에서 유지하고 닫으면 원래 버튼으로 돌아간다.

전역 설정은 **Mew 서버를 실행하는 OS 사용자** 기준이다. 여러 Mew 계정이 같은 전역 설정을 공유한다. API는 `agent` 기능 권한을 요구하며 기존 서버 제어 기능과 같은 권한 경계를 따른다([접근 계약](../development/access-control.md)).

에이전트 채팅에서 로컬 모델로 스프라이트를 생성하려면 별도 프로젝트의 `local-sprites`를 선택적으로 [외부 MCP로 연결](local-sprites.md)한다. 생성 코드·모델·Python 의존성은 Mew 배포에 포함하지 않는다. Mew는 기존 런타임 MCP 설정을 사용하며, 생성 도구를 다른 클라이언트에서도 재사용할 수 있다.

## Mew 전용 커밋 스킬

`<DATA_DIR>/skills/commit/SKILL.md`는 Mew가 소유하는 커밋 지침 파일이다. **Skills 관리 → Mew → commit → 수정**에서 읽고 편집한다. 최초 템플릿만 생성하고 사용자 수정은 갱신·재시작으로 덮어쓰지 않는다. 공통 기능이 참조하는 고정 경로이므로 관리창에서 이동·삭제하거나 다른 위치의 스킬을 이 범위에 추가하지 않는다.

Mew를 통한 모든 런타임의 `/commit`과 Git 패널 **AI 자동 커밋**이 같은 파일을 사용한다. 이름이 같은 런타임 스킬보다 Mew 파일이 우선하며, 일반 대화에는 커밋이 승인됐을 때 이 파일을 읽으라는 안내만 전달한다. Mew 밖에서 실행한 CLI의 스킬 목록에는 등록하지 않는다. 전역·프로젝트·에이전트별 커밋 스킬로 다시 복제하지 않는다. 다른 일반 스킬은 기존 원본 관리 계약을 유지한다.

기본 커밋 스킬은 저장소의 메시지 언어에 맞는 글쓰기·교정 스킬이 있으면 실제 원문을 읽고 제목·설명을 다듬도록 안내한다. 한국어 `korean-writing-reviewer`, 영어 `writing-clearly-and-concisely`, 일본어 `yomiyasu`, 중국어 간체 `tech-doc-style-chinese` 등을 선택적으로 사용하며, 문서화 진입점으로 연결돼 있으면 문장 교정 단계만 적용한다. 변경 사실·용어·불확실성과 기존 언어·접두사를 보존하고 별도 구조 설계·번역·평가를 추가하지 않는다. 스킬이 없으면 설치나 추가 확인 없이 기존 규칙으로 작성한다.

Git 패널의 `mew-commit-plan`·`mew-commit-evidence`는 추가 파일 읽기·도구 호출이 제한되므로 요청에 본문이 제공된 글쓰기 지침만 활용한다. 스킬 이름·경로만으로 원문이 자동 전달되지는 않으며, 별도 본문이 없으면 기존 규칙을 따른다. 교정하더라도 JSON 키·파일 경로·조각 번호와 JSON 전용 응답을 유지한다. 기본 템플릿 변경은 이미 생성한 사용자 스킬에 자동 반영되지 않으므로 기존 파일은 Skills 관리에서 필요한 지침만 추가한다.

큰 변경은 반복 줄·공통 전후 문구·동일 변경 사전을 로컬에서 무손실 압축하고 모든 변경 근거를 전달한다. 한 패킷에 들어가면 계획 한 번, 넘으면 모든 패킷을 읽고 근거를 합쳐 계획한다. 크기나 압축 때문에 파일을 남기지 않는다. 변경 목적 기록은 실제 Git 객체와 일치할 때만 참고하며 소스 주석이나 임베딩이 필요하지 않다. 분석만 압축하고 커밋은 원본 전체를 사용한다. 상세 형식·한도·원본 재확인 계약은 [AI 커밋 실행 계약](../development/agent-sessions.md#git-ai-commit-작업)을 따른다.

AI 자동 커밋은 파일별 계획을 검증한 뒤 실제 커밋을 실행하고, 일반 대화의 `/commit`은 승인된 범위에서 에이전트가 같은 절차를 따른다. 구체적인 실행·취소 범위는 [Git 사용법](../guides/projects.md#git-작업-패널)을 따른다.

## 언어별 문서화 스킬

Mew는 한국어·영어·일본어·중국어 간체 문서화 스킬을 제공한다. **Skills 관리 → Mew**에서 원문과 언어별 교정 기준을 읽을 수 있다. 패키지 소유 파일이므로 관리창에서는 읽기 전용이며, 프로젝트나 전역에 같은 이름의 스킬을 두면 명시적 스킬 후보 목록에서는 기존 가까운 프로젝트·전용 스킬 우선순위를 따른다.

| 기본 원문 언어 | 스킬 |
| --- | --- |
| 한국어 | [korean-technical-docs](skills/korean-technical-docs/SKILL.md) |
| 영어 | [english-technical-docs](skills/english-technical-docs/SKILL.md) |
| 일본어 | [japanese-technical-docs](skills/japanese-technical-docs/SKILL.md) |
| 중국어 간체 | [chinese-technical-docs](skills/chinese-technical-docs/SKILL.md) |

에이전트 기본 지침의 **응답 언어**는 새 문서의 기본 원문 언어에도 적용된다. **mew 언어 설정에 따름**은 요청 화면의 실제 언어를 사용한다. 사용자 지정 문서 언어와 기존 프로젝트·파일의 언어 요구사항은 기본값보다 우선하므로, 응답 언어를 바꿨다는 이유로 기존 문서를 다른 언어로 고치지 않는다. 별도 지정이나 화면 언어가 없으면 현재 응답 언어 지침·사용자 메시지에서 원문 언어를 정한다. 직접 편집한 언어 지침은 해석해 덮어쓰지 않는다.

`project-context-text.ts`는 같은 요청에서 읽은 응답 언어 지침에 맞는 기본 스킬 경로를 전달한다. 언어를 확정할 수 없으면 네 경로와 선택 기준을 전달해 에이전트가 해당 언어만 읽는다. 문서 작업에서 원문 언어의 스킬로 구조·문장을 개선하고 정확성을 검수한다. 번역 요청이 있으면 확정한 원문에서 각 대상 언어로 직접 번역하고, 대상 언어 스킬로 표현과 의미를 검수한다. 원문은 한국어로 고정하지 않으며 번역 요청이 없으면 다른 언어판을 자동 생성·수정하지 않는다. 프로젝트 자동 안내를 끄면 이 연결 안내도 전달하지 않는다.

언어별 진입점은 문서화 단계를 연결하고, 각 단계에서는 아래의 기존 전문 스킬 원문을 읽어 적용한다. 한국어 원문이면 한국어 교정 후 확정하고 다른 언어로 직접 번역한다. 영어 원문이면 영어 교정 후 확정하고 다른 언어로 직접 번역한다. 대상 언어의 번역 교정과 문장 교정을 마친 뒤 최종 번역 검수를 수행한다.

| 단계 | 실제 설치한 스킬과 선정 이유 |
| --- | --- |
| 문서 구조 | [documentation](https://github.com/mcollina/skills/tree/main/skills/documentation): Diátaxis의 독자 목적과 유형별 정보 순서를 다룬다. |
| 한국어 교정 | [korean-writing-reviewer](https://github.com/CreatoonForge/korean-writing-reviewer): 기술 문서 프로필과 호응·문단 흐름·원문 보호 기준이 있다. |
| 영어 교정 | [writing-clearly-and-concisely](https://github.com/softaworks/agent-toolkit/tree/main/skills/writing-clearly-and-concisely): 문단 구성·단어 관계·간결한 문장에 집중한다. |
| 일본어 교정 | [yomiyasu](https://github.com/nanaism/yomiyasu): 기술·업무 문서용 참조와 조건·주체를 보존하는 추고, 검사 스크립트를 제공한다. |
| 중국어 간체 교정 | [tech-doc-style-chinese](https://github.com/Fenng/Tech-Doc-Style-Chinese): 사용법·API·운영 문서를 다루고 긴 문장·용어·표기와 기계 구문을 구분한다. |
| 번역·검수 | [translating-products-skill](https://github.com/BrunoMiguens/translating-products-skill)의 `translating-core`, `translating-documentation`, `translating-korean`, `translating-japanese`, `translating-chinese`, `reviewing-translations`: 의미 번역·문서 구문 보호·언어별 번역 교정·최종 대조를 분담한다. 영어 번역 교정은 core와 영어 교정 스킬을 사용한다. |

원본은 이 문서 옆 `skills/`에 있고 연결 지침은 `skills/technical-docs-common/`에 있다. 외부 스킬 11개는 `.vendor/`에 원문·참조·스크립트·라이선스를 보존해 설치했다. 이 경로는 외부 스킬 패키지이며 사람이 작성하는 current 문서 description 목록에 섞지 않는다. [의존성 기록](skills/dependencies.json)에 저장소·고정 커밋·파일별 SHA-256과 언어별 역할을 기록한다. 원문은 수정하지 않으며 갱신 시 새 원문과 구성 파일을 비교하고 기록·검증을 함께 갱신한다. 실행 시 외부 스킬을 새로 다운로드하지 않는다.

소스 설치와 사전 빌드 실행본은 같은 패키지를 사용하며 런타임 설정 파일에 복제하지 않는다. 원문 확정은 요청된 작업 안의 검수 단계로, 이미 받은 편집·번역 승인을 반복해서 요구하지 않는다. 구조 스킬의 폴더 구분·추가 질문과 번역 스킬의 설정 요구는 기존 프로젝트 정책·확인한 독자·언어·말투·승인 범위에 맞춰 적용한다. 프로젝트의 서브에이전트 권한을 따르고, 독립 검수나 실제 원어민 검수를 수행하지 않았으면 그렇게 보고하지 않는다.

`server/documentation-skills.test.ts`가 언어 설정·다음 요청·원문 보존·전문 스킬 연결·출처 해시·스킬 조회를, `server/release-runtime.test.ts`가 배포본의 원문·참조·라이선스·검사 스크립트 포함 범위를 검사한다.

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
