# 에이전트 런타임 설정

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../guides/getting-started-ko.md)

## 설치·로그인·구독

- **설치와 로그인은 별개다**. ACP 런타임은 공급자 ACP 인증 또는 등록된 browser(내부 서버 브라우저)/terminal 작업을 쓴다. Antigravity는 Google 공식 ACP 서버의 인증 방법과 Google 로그인 주소를 사용한다. Claude는 공식 CLI의 계정 로그인과 Console 로그인을 구분한다. 수동 승인 코드는 해당 CLI로 일시 전달하고 OAuth 토큰은 별도 입력·저장하지 않는다([ADR 0142](../../../.mew/docs/decisions/0142-mew-claude-acp-and-cli-authentication.md)). 화면 문구와 배치는 [표시 기준](../specs/agent-panel.md#로그인-화면)을 따른다.
- **로그인과 구독·한도도 별개다**([ADR 0130](../../../.mew/docs/decisions/0130-mew-agent-account-entitlement.md)). Claude·Kimi·Codex·Cursor ACP 채팅의 **i(세션 정보)** 팝업과 지원 런타임 설정의 `연결 계정 · 구독`에서 서버 CLI 계정·플랜을 조회한다. 명시적 구독 필요·사용량 소진·크레딧 부족 오류는 ACP가 `Authentication required`로 감싸도 로그인 화면으로 전환하지 않는다. 기존 대화와 대기 메시지를 유지하고 자동 연속 전송을 멈춘다. 대기 메시지 편집·재연결·계정 재조회는 재전송하지 않으며, 사용자가 새 메시지를 전송하면 대기 순서대로 재개한다.
  계정 조회는 Kimi의 `web --host 127.0.0.1 --port 0 --no-open --log-level error` 임시 프로세스에서 `/api/v1/oauth/userinfo`·`usage`·`region`, Codex의 호스트 CLI `app-server`에서 `account/read`·`account/rateLimits/read`, Cursor의 `status --format json`, Claude의 동일 CLI 엔진 `auth status --json`을 사용한다. 실행 파일·환경은 런타임 설정을 따르고 상태 명령 인자는 고정한다. 임시 프로세스는 20초 제한·256KiB stdout 제한과 종료 후 강제 종료 대기를 가지며, Kimi 서버의 접속 토큰은 해당 자식의 시작 출력에서만 일시 사용한다. 공급자 인증 저장소는 직접 읽지 않고 모델 프롬프트도 보내지 않는다.
  계정·플랜은 확인된 필드만 표시한다. 무료 플랜은 사용 불가 판정이 아니며, `VIP10` 같은 미확인 플랜 코드는 미구독으로 단정하지 않는다. CLI 버전·네트워크 문제나 조회 기능이 없으면 `확인할 수 없음`과 재조회 경로를 제공한다. Cursor는 계정 정보만 확인되고 플랜이 반환되지 않을 수 있다. API 키 기반 Codex는 ChatGPT 구독과 구분한다.
  Codex·Claude·Kimi Code의 구독 잔여율은 세션 도구 바의 배터리에서 확인한다. Codex의 `usedPercent`·`windowDurationMins`·`resetsAt`, Kimi CLI가 정규화한 `summary`·`limits`의 `used`·`limit`·`window`·`resetAt`을 공개 `quota` 배열(`remainingPercent`, `windowMinutes`, `resetsAt`, 선택적 `name`·`secondaryBucket`)로 투영한다. 전체 한도 팝업에는 Codex 추가 metered bucket과 Claude 모델별 주간 한도도 포함하고, `secondaryBucket`은 요약 배터리 선택에서 제외한다. Claude는 OAuth 연결일 때 동일 CLI의 stream-json SDK 제어 프로토콜로 `initialize` → `get_usage`만 요청하고 `rate_limits.five_hour`·`seven_day`의 utilization(0–100)·초기화 시각을 읽는다. `--no-session-persistence`, 빈 설정 소스, hooks 비활성, 빈 strict MCP 설정과 빈 tools로 모델 프롬프트·기존 세션·사용자 훅/MCP 실행을 피한다. 실험적인 `get_usage`를 지원하지 않는 CLI와 조회 실패는 잔여율을 제공하지 않는다. 각 임시 프로세스에 기존 20초·256KiB 제한을 적용한다. 계정 상태와 사용량은 순차 프로세스로 조회되므로 Claude의 전체 조회는 최대 약 40초다. 실제 API 키 연결에서는 구독 조회를 하지 않는다. 브라우저는 잔여량만 계정·런타임별 메모리에 최대 5분 유지하고 동시/반복 조회를 합친다. 세션 토큰·API 환산 비용은 기존 i 팝업에서 확인한다. `구독 관리`·`구독하기` 버튼은 공급자별 고정 URL을 같은 계정의 내부 DOM 브라우저로 연다(Kimi 리전 반영). 페이지를 닫으면 그 창과 팝업을 정리하고 상태만 다시 조회한다. 구독 페이지의 계정이 표시된 CLI 계정과 같은지 사용자가 확인하며, 결제나 프롬프트 재전송은 자동 실행하지 않는다. 계정 결과는 메모리에서만 표시하고 전사·localStorage에 저장하지 않는다. Antigravity의 계정·플랜·잔여량 조회와 terminal 본문은 이 정보 카드의 적용 대상이 아니다. Antigravity 로그인과 채팅은 ACP로 지원한다.

## 모델·권한 기본값과 런타임 선택

- 이전 Codex 에이전트셋처럼 추론 강도 없이 모델명만 저장된 경우, 모델 선택 요청 시 ACP가 광고한 같은 모델의 `모델명[추론 강도]` ID로 연결한다. 정확히 일치하는 ID를 우선하고, 변환이 필요하면 현재 세션의 추론 강도 → `medium` → 같은 모델의 첫 지원 항목 순으로 고른다. 명시한 추론 강도·다른 런타임의 ID는 변경하지 않으며, 같은 모델이 없으면 다른 모델로 대체하지 않고 연결기의 오류를 표시한다. 저장된 셋 파일은 변경하지 않는다.

- **모델·권한 선택기 옆 저장 아이콘은 현재 값을 그 런타임의 기본값으로 남긴다**([ADR 0063](../../../.mew/docs/decisions/0063-mew-agent-runtime-saved-defaults.md)). 값은 브라우저가 아니라 `<DATA_DIR>/agent-defaults.json`에 런타임별로 저장되어, 새 탭·서버 재시작 뒤 `session/new`·`session/load`에도 적용된다. 현재 선택이 저장값과 같으면 아이콘이 강조된다. 저장값이 없는 **권한 모드 기본값은 그 런타임의 "전체 허용"이다**([ADR 0037](../../../.mew/docs/decisions/0037-mew-agent-bypass-permissions-default.md)). ACP 세션은 제한 모드로 시작하므로(claude `default`·codex `auto`) 서버가 `session/new`·`session/load`뒤마다 다시 걸어 준다(`#applyDefaults`). 이름이 런타임마다 달라 한 값으로 박지 않고 후보 순서 (`FULL_ACCESS_MODES`)로 고른다 — claude `bypassPermissions` · codex `agent-full-access` · hermes `dont_ask`. claude의 `dontAsk`는 뜻이 반대(미리 승인 안 된 건 거절)라 순서로 갈린다. 헤더 선택기로 턴마다 바꿀 수 있다. `MEW_AGENT_MODE`에 모드 id를 박으면 운영자 강제값으로 저장된 권한보다 우선한다. 모드 목록은 백엔드가 광고하는 것을 그대로 쓴다 — 광고에 없으면(예: root 실행) 조용히 넘어간다.

- **새 탭은 런타임 또는 에이전트셋을 고르기 전에 세션을 띄우지 않는다**([ADR 0096](../../../.mew/docs/decisions/0096-mew-agent-tabs-created-after-selection.md)). 마지막 탭을 닫으면 가운데 `새 탭` 버튼만 남고, `+`와 이 버튼은 선택기만 연다. 설치되지 않은 런타임은 서버 등록표의 고정 설치 명령으로만 설치하고, 성공하면 새로고침 없이 그 런타임을 선택한다. 선택 후에만 WS·히스토리·입력창이 생긴다. 런타임은 탭별로 `mew:agent-tabs` 안에 남고, 예전 탭은 마지막 `mew:agent-runtime` 값으로 한 번 승격한다.

- **세션 창의 헤더 아이콘은 런타임 드롭다운이다**([ADR 0074](../../../.mew/docs/decisions/0074-mew-agent-header-runtime-switch.md) — 0062의 탭 안 전환 금지를 해제). 누르면 새 탭의 목록과 같은 등록표(아이콘·설치 상태·사용/설치)가 펼쳐지고, 다른 에이전트를 고르면 **그 탭의 세션이 갈아탄다** — 새 탭을 만들지 않는다. WS 연결 effect가 `runtime` 의존이라 재접속하며 새 세션을 붙이고, 옛 세션은 서버 감독에 그대로 남는다. 설치도 드롭다운 안에서 같은 고정 명령 경로로 한다.

- 실행 표면과 명령은 `server/agentRuntimes.ts`의 `RUNTIMES` 등록표가 정한다. 클라이언트에 같은 목록이 또 있는 이유는 **아이콘**뿐이고 판정은 서버가 한다:

  | 런타임 | 에이전트 탭 표면·명령 | 인증 | 환경변수 |
  | --- | --- | --- | --- |
  | `claude` | 고정 `claude-agent-acp` → 공식 Claude CLI 엔진 | 내부 서버 브라우저 · 공식 CLI `auth login --claudeai` / `--console`, 필요 시 승인 코드 입력 | ACP: `MEW_AGENT_CMD` · `MEW_AGENT_CLAUDE_CMD` 및 대응 `ARGS`; 엔진: `MEW_AGENT_CLAUDE_CLI_CMD` · `CLAUDE_CODE_EXECUTABLE`; 인증 환경: `MEW_AGENT_CONFIG_DIR`/`CLAUDE_CONFIG_DIR` |
  | `antigravity` | Google 공식 `agy_acp_server.par` 1.1.1 | 공식 ACP의 Google OAuth · Enterprise · API key · Agent Platform | `MEW_AGENT_ANTIGRAVITY_ACP_CMD` · `MEW_AGENT_ANTIGRAVITY_ACP_ARGS` · `GEMINI_HOME` · `GEMINI_API_KEY` |
  | `codex` | 로컬 `node_modules/.bin/codex-acp`(버전 고정) → 컴퓨터에 설치된 `codex` 엔진, 자격증명은 `~/.codex` | 내부 서버 브라우저 · 호스트 `codex login` · 서버 loopback callback | `MEW_AGENT_CODEX_CMD` · `MEW_AGENT_CODEX_ARGS` · `MEW_AGENT_CODEX_CLI_CMD` · `CODEX_PATH` · `NO_BROWSER`(기본 `1`) |
  | `hermes` | `hermes acp` — mew가 번들하지 않는다 | `hermes acp --setup` | `MEW_AGENT_HERMES_CMD` · `MEW_AGENT_HERMES_ARGS` |
  | `kimi` | `kimi acp` | 내부 서버 브라우저 · `kimi login`(.com) / `kimi login --region global`(.ai) | `MEW_AGENT_KIMI_CMD` · `MEW_AGENT_KIMI_ARGS` |
  | `openclaw` | `openclaw acp` | `openclaw onboard --tui` | `MEW_AGENT_OPENCLAW_CMD` · `MEW_AGENT_OPENCLAW_ARGS` |
  | `opencode` | `opencode acp` | `opencode auth login` | `MEW_AGENT_OPENCODE_CMD` · `MEW_AGENT_OPENCODE_ARGS` |
  | `cursor` | `agent acp` | 내부 서버 브라우저 · `agent login`(`NO_OPEN_BROWSER=1`) | `MEW_AGENT_CURSOR_CMD` · `MEW_AGENT_CURSOR_ARGS` |
  | `prime` | Mew 내장 어댑터 → 공식 `prime-agent --mode rpc` — 공식 인스톨러로 설치(`curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh \| sh`) | TUI `/login`(공급자 선택) | `MEW_AGENT_PRIME_ARGS` (옛 `MEW_AGENT_PRIME_CMD`는 읽지 않음) |

  공통은 `MEW_AGENT_MODE`(안 주면 이 문서의 전체 허용 후보 순서). 진입점이 없거나 로그인 전 ACP를 말하지 않으면 오류와 terminal auth를 함께 보여 준다 — 목록에서 감추거나 탭을 닫지 않는다. 로그인 완료 뒤에도 실패하면 같은 화면에 최신 시작 오류를 남긴다. Prime Agent는 연결당 세션 하나라 mew의 탭 하나가 곧 하나의 Prime 세션이 된다(둘째 탭은 프로세스를 하나 더 띄운다).

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/agent-runtimes` | manager·owner | 등록 런타임의 실행 파일 존재와 설치·안전 제거·로그아웃 가능 상태 |
| `GET /api/agent-runtimes/:id/models` | agent 권한 | 에이전트셋용 ACP 모델 후보 `{models: [{modelId, name}]}`. 지원하지 않는 런타임은 400, 조회 실패는 502 |
| `POST /api/agent-runtimes/:id/terminal/:tab` | manager·owner | terminal 런타임의 탭별 전용 tmux를 검증된 cwd에서 만들고 등록표의 공식 CLI 실행 |
| `DELETE /api/agent-runtimes/:id/terminal/:tab` | manager·owner | 탭이 소유한 전용 tmux와 CLI 종료 |
| `POST /api/agent-runtimes/:id/install` | manager·owner | id에 대응하는 등록표의 고정 설치 명령 실행. 임의 명령·인자는 받지 않음 |
| `DELETE /api/agent-runtimes/:id/install` | manager·owner | 등록표가 선언한 고정 역설치 명령 실행. 안전한 제거 계약이 없으면 거부 |
| `POST /api/agent-runtimes/:id/logout` | manager·owner | 등록표가 선언한 비대화형 CLI 로그아웃만 실행. 자격증명 값은 읽거나 전송하지 않음 |
| `POST /api/agent-runtimes/:id/auth/:method/run` | manager·owner | ACP가 광고했거나 등록표에 박힌 terminal auth 고정 명령을 숨김 tmux에서 실행. body는 `{tab}`만 |
| `GET /api/agent-runtimes/:id/account` | manager·owner | 공식 CLI 상태 기능으로 계정 표시명·플랜·구독/한도 상태·고정 구독 URL을 일시 반환. `Cache-Control: no-store`, 동시 조회만 병합; 지원 런타임의 정규화된 `quota` 배열 포함 |
| `GET /api/agent-runtimes/:id/auth/:method/status?tab=<id>` | manager·owner | 인증 작업 상태·exit code, browser 표면의 allowlist URL·일회용 코드, 필터된 실패 이유. 출력·비밀값은 기록하지 않음 |
| `GET /api/agent-defaults/:id` | manager·owner | 런타임별로 저장된 모델·권한 기본값 |
| `PUT /api/agent-defaults/:id` | manager·owner | 현재 모델·권한을 그 런타임의 기본값으로 원자적 저장 |
| `GET /api/agent-runtimes/:id/settings` | manager·owner | 런타임 설정(실행 파일·추가 인자·env). **env 값은 마지막 4자만 마스킹해서** 돌려준다 |
| `PUT /api/agent-runtimes/:id/settings` | manager·owner | 병합 저장 — 보낸 키만 갈아끼우고 없는 env 키는 기존 값을 유지(시크릿 원문을 브라우저가 모르므로) |
| `DELETE /api/agent-runtimes/:id/settings` | manager·owner | 그 런타임의 사용자 설정을 지우고 등록표 기본값으로 돌아간다 |

- 런타임 설정창은 공통 `DialogFrame`으로 `document.body`에 표시하여 런타임 목록·패널 레이어에 가려지지 않는다. 설정창과 삭제·로그아웃 확인창 안의 조작은 뒤쪽 런타임 드롭다운을 닫지 않는다. Esc·뒤로가기와 포커스 제한·복원은 공통 모달 계약을 따른다.
- **런타임 설정 팝업**(목록의 톱니 아이콘) — 설치·삭제·로그인·로그아웃과 실행 파일 경로·추가 인자·공급자 env를 런타임별로 저장한다. ACP 런타임은 `resolvedSpec`, terminal 런타임은 `resolvedTerminalSpec`이 다음 탭 시작과 설치 판정에 적용한다. Claude의 실행 파일 설정은 기존대로 공식 CLI 엔진 경로이며, ACP 어댑터 자체는 환경변수로 지정한다. 이전 TUI의 추가 인자(`extraArgs`, `MEW_AGENT_CLAUDE_CLI_ARGS`)는 보존만 하고 ACP에 전달하지 않는다. 모델·권한은 채팅 설정으로 선택한다. 대화·예약 실행·로그인·상태 조회·로그아웃은 같은 CLI 엔진과 공급자 환경을 사용한다. 시크릿은 서버에만 있고 화면은 `****끝4자`만 본다. 제거·로그아웃은 확인 뒤 등록표의 고정 명령만 실행하며, 안전한 역설치 계약이 없는 Antigravity는 임의 파일을 지우지 않는다.
- ACP 런타임의 모델 후보와 실행 ID는 ACP가 광고한 값을 사용한다. Codex 패널의 표시만 기본 모델별로 묶으며, 노력도는 별도 사고 선택기로 조정한다([표시 계약](../specs/agent-panel.md#모델노력도-선택)). `session/set_model` 성공 후 광고된 복합 ID 목록으로 사고 선택값·지원 목록을 갱신하고, `session/set_config_option` 응답과 `config_option_update.configOptions`도 모델·사고 상태에 반영한다. 기본값에는 실제 복합 모델 ID와 별도 사고 값을 함께 유지한다. 에이전트셋 후보 API는 기존 정확한 ID를 유지한다. Claude와 Antigravity 모두 공통 ACP 모델·권한·히스토리 화면을 사용한다. 실제 목록과 세션 복원 범위는 각 서버 capability에 따른다.
- 에이전트셋 편집 시 모델 후보 API는 `probeModels`의 런타임별 메모리 캐시와 동시 요청 병합을 재사용한다. 캐시가 없으면 모델 조회용 임시 ACP 세션을 열고 목록을 받은 즉시 종료한다. 사용자 탭·WS·프롬프트는 만들지 않는다. 응답은 `no-store`이며 조회는 20초 제한을 따른다. 설치·로그인 미완료 등 실패 시 폼에서 재시도하거나 모델 ID를 직접 입력한다. 런타임 전환·폼 닫기 이후의 응답은 UI에서 폐기한다.

## Antigravity 공식 ACP

[ADR 0143](../../../.mew/docs/decisions/0143-mew-antigravity-official-acp.md)에 따라 일반 `agy` TUI 대신 Google 공식 ACP 서버를 사용한다.

- **설치**: 목록의 설치 버튼이 `dl.google.com`의 버전 고정 1.1.1 ZIP을 받아 `<DATA_DIR>/runtimes/antigravity-acp/1.1.1-<platform>-<arch>/`에 배치한다. Node 내장 다운로드와 시스템 `unzip`을 사용한다. Linux x64·arm64, macOS arm64를 지원하며 Intel Mac용 공식 배포본은 현재 없다. Linux x64 기준 압축 약 650 MiB·해제 약 1.9 GiB이므로 설치 중 약 2.6 GiB 여유 공간이 필요하다. 다운로드·압축 해제 실패 시 임시 파일을 정리하고 기존 설치를 덮어쓰지 않는다. 재배포 바이너리·npm 의존성은 추가하지 않는다.
- **Google 계정**: 새 탭에서 `Log in with Google` 선택 → 로그인 페이지 열기 → 내부 서버 브라우저에서 Google 승인 → 공식 서버의 loopback callback으로 인증 완료. Free·Pro·Ultra 이용권은 Google 계정에 따른다. URL은 인증 중 메모리에만 유지한다. 취소·시간 초과 시 해당 ACP 프로세스의 로그인 listener를 종료하고 새 연결로 재시도한다. 실패하면 인증 화면으로 돌아온다.
- **API 키**: 런타임 설정의 환경변수에 `GEMINI_API_KEY` 저장 → 새 탭 → `Gemini API key`. 공식 1.1.1 서버는 authenticate `_meta`로 받은 키를 무시하므로 별도 키 입력 폼을 제공하지 않는다.
- **Enterprise / Agent Platform**: 공식 서버가 광고하는 인증 방법을 그대로 제공한다. Enterprise의 project/location은 `<GEMINI_HOME>/antigravity-acp/settings.json`의 `gcp` 설정을 사용한다. Agent Platform은 `GOOGLE_API_KEY` 또는 `GOOGLE_CLOUD_PROJECT`·`GOOGLE_CLOUD_LOCATION` 및 ADC를 사용한다. 이 구성은 실제 기업 계정으로 검증하지 않았다.
- **설정과 이전 값**: 예전 `MEW_AGENT_ANTIGRAVITY_CMD`·`ARGS`와 저장된 `cmd`·`extraArgs`는 TUI용이라 ACP로 전달하지 않는다. ACP 실행 파일·인자는 서버의 `MEW_AGENT_ANTIGRAVITY_ACP_CMD`·`ARGS`로 명시한다. 저장된 공급자 환경변수는 유지한다. 별도 경로가 필요하면 `GEMINI_HOME`을 설정한다(기본 `~/.gemini`).
- **계정·이력**: 공식 ACP 서버가 `~/.gemini/antigravity-acp/` 아래 인증과 대화를 관리한다. 일반 CLI의 `antigravity-cli/`와 별개이므로 필요하면 새로 로그인한다. 기존 CLI 대화를 ACP로 자동 이관하지 않는다. 계정 이메일·구독 잔여량 정보 카드는 제공하지 않으며 공식 `/logout` 등 서버 명령은 서버가 처리한다. Mew 설정의 자동 로그아웃·제거 버튼은 아직 제공하지 않는다.
- **검증 범위**: 공식 Linux x64 배포본의 initialize·미인증 session/new 응답을 확인했다. 설치 성공/실패·이전 설정·OAuth URL 분할 수신·재접속·취소·실패 후 재시도는 격리된 테스트로 확인한다. 실제 Google 로그인·유료 프롬프트·Enterprise·macOS 실행은 자동 검증하지 않는다.

공식 근거: [Google Zed 연동·인증](https://antigravity.google/docs/ide/extensions/zed/), [ACP Registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json). 공식 바이너리는 Google 약관을 따르며 Mew 소스 라이선스로 재라이선스하지 않는다.

### Prime 설치 감지·업데이트

- 설치 여부는 내장 Node 어댑터가 아닌 `MEW_PRIME_AGENT_EXECUTABLE` 또는 PATH의 `prime-agent` 실행 파일로 판정한다.
- 최신 조회는 npm 공개 레지스트리·GitHub 릴리스 대신 공식 설치 스크립트의 배포 저장소 채널을 사용한다. 업데이트는 공식 CLI의 `update` 명령을 개별 실행한다([업데이트 계약](../deployment/native.md#설치된-의존성에이전트-통합-업데이트)).
