# 에이전트 세션과 통신 계약

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

## 탭 원장과 복원

- 탭 목록·이름·런타임·cwd별 마지막 세션 ID는 **계정에 저장**하고 루트 프로젝트 절대 경로별로 분리한다. 브라우저의 `mew:agent-tabs:<root-path>`는 서버 응답 전 연결에 쓰지 않는 로컬 fallback뿐이다. 저장 PUT은 화면마다 한 번씩 직렬화하며, 전송 중 갱신이 여럿 생기면 마지막 스냅샷만 이어 보내 오래된 응답이 최신 thread 포인터를 되돌리지 못하게 한다. 서버 복원이 끝난 뒤에만 활성 탭의 WS를 붙이므로 localStorage의 낡은 세션으로 먼저 연결하지 않는다. 세션 ID는 탭을 닫을 때 함께 지워지고, 같은 탭에서 런타임이나 cwd를 갈아타면 각 조합의 대화 포인터를 따로 보존한다. 마지막으로 보던 탭도 같은 루트 경로별로 남는다(`mew:agent-active-tab:<root-path>`) — 창을 다시 열거나 브라우저를 껐다 켜면 그 탭이 선다. 열린 패널마다 활성 탭 하나를 연결한다. 복원된 비활성 탭은 처음 선택할 때 연결하며, 숨긴 패널 때문에 새 연결을 시작하지 않는다. 탭 이동·패널 숨김은 이미 열린 연결을 유지한다. 에이전트와 일반 셸은 별도 패널이지만 계정 원장은 컨트롤러 하나가 함께 저장한다. 스와이프로 창·탭을 전환하거나 닫는 동작은 없다. 패널 열기·닫기와 이전·다음 탭 이동은 플로팅 핸들로 조작하며, 탭 닫기는 탭의 닫기 버튼이나 `Ctrl+W`를 사용한다. 탭 이름은 선택한 런타임 또는 에이전트셋 이름으로 시작하고, 탭을 두 번 누르면 직접 고친다 ([ADR 0093](../../../.mew/docs/decisions/0093-mew-account-synced-project-and-agent-tabs.md)·[ADR 0096](../../../.mew/docs/decisions/0096-mew-agent-tabs-created-after-selection.md)).
  - 새 탭은 선택 후에만 생기므로, 선택 전 히스토리 조회·세션 입력을 위한 빈 탭은 없다. 새 세션은 선택 직후부터 해당 탭에서 시작하며, 지난 세션을 고르는 기능은 탭에서 계속 제공한다
  - 플로팅 핸들의 `오른쪽 탭` 다음 4번 버튼은 `터미널`로, 기존 메뉴와 같은 권한 검사와 패널 토글을 사용한다. 터미널 접근을 위해 기존 `탭 닫기`를 대체했으며, 탭 닫기 재도입을 영구 금지하는 결정은 아니다
  - 같은 세션을 두 탭에서 열지 않는다(목록에서 잠근다) — 현재 mount된 탭뿐 아니라 같은 계정에 저장된 다른 루트 프로젝트의 숨은 탭까지 한 번의 탭 상태 응답에 포함해 판정한다. 한 전사를 두 프로세스가 붙들면 기록이 엉킨다
  - **대화가 자라도 바닥에 붙어 있을 때만 따라 내려간다**(바닥 판정 여유 48px). 위로 올려 읽는 중이면 자리를 지키고 \*\*\[새 메시지\]\*\*만 띄운다 — 누르면 바닥으로, 스스로 바닥까지 내려가도 사라진다. 내가 프롬프트를 보냈을 때와 세션을 새로 불러왔을 때(`reset`)는 다시 바닥에 붙인다
  - **탭을 닫는 것만 세션을 끝낸다**(`close_session`). 창을 닫는 것과 다르다. 안 보고 있는 탭도 WS는 붙어 있고(돌던 대화가 멎으면 안 된다), 한 번이라도 연 탭만 붙인다(복원된 탭을 한꺼번에 띄우지 않는다)
  - **턴 버블 오른쪽에 걸린 시간이 선다** — "15초"·"36분 32초"·"2시간 5분 4초" 꼴. 서버가 `turn_start`에 `startedAt`, `turn_end`에 `durationMs`를 새기므로 되받은 히스토리에서도 그대로 보인다. 돌고 있는 턴은 startedAt부터 지금까지를 1초마다 다시 세고, 시간 정보가 없는 옛 히스토리는 감춘다. 감독이 유휴 종료된 뒤에도 완료 시점에 남긴 전체 이벤트 전사를 다시 써서, 질문·답변·작업 내역과 소요 시간을 보존한다.
  - ACP가 히스토리를 다시 흘릴 때 마지막 `turn_end`를 보내지 않아도, 현재 세션 `meta.busy`가 false면 마지막 턴은 \*\*완료(초록)\*\*로 그린다. meta를 받기 전이나 아직 작업 중이면 \*\*진행 중(파랑)\*\*을 유지한다.

## 메시지·재접속·큐

- **외부 CLI에서 이어 쓴 대화:** `session/load`가 반환한 최신 ACP 전사를 기준으로 복원한다. Mew 저장 전사가 있다는 이유로 전체 ACP 응답을 버리지 않는다. 질문·답변이 같은 완료된 접두 턴만 기존 Mew 이벤트(소요 시간·설정·작업 기록)를 보존하고, 달라진 지점부터는 최신 ACP 이벤트를 사용한다. ACP가 대화 이벤트를 전혀 재생하지 않는 경우에만 저장 전사로 폴백한다. 전체 복원 뒤 전사를 한 번 저장한다.
- 살아 있는 감독에 재접속하면 메모리 replay를 사용하므로 외부 CLI 변경을 실시간 감시하지 않는다. Codex **히스토리 → 현재 대화 새로고침**은 같은 세션 ID를 기존 `load_session` 경로로 다시 읽는다. 진행 중인 턴·승인·큐와 겹칠 수 없고, 어댑터 교체는 ADR 0122를 따른다. 다른 탭이 같은 세션을 소유한 경우 새로고침을 허용하지 않는다.
- 어댑터 교체는 종료 요청 뒤 `disposeAndWait()`로 실제 종료를 기다린다. 히스토리 전환뿐 아니라 자동 복원 실패 후 새 세션 생성과 선택한 기록 실패 후 이전 대화 복구에도 적용한다. `session/load`가 writer를 얻고 전사 재생 중 실패할 수 있으므로 실패한 어댑터도 종료 경계를 거쳐야 한다. 감독 로그에는 선택한 기록의 최초 불러오기 오류와 이전 대화 복구 오류를 각각 남긴다.

아래는 주요 메시지다. 전체 타입은 [agentWs.ts](../../server/agentWs.ts)의 `ClientMessage`·`ServerMessage`와 [agentAcp.ts](../../server/agentAcp.ts)의 `AgentEvent`를 따른다.

| 방향 | 메시지 |
| --- | --- |
| 클라이언트 → 서버 | `{type:'prompt', text, settings?: {model, thinking, permission}}` · `{type:'cancel'}` · `{type:'permission', id, optionId}` (`optionId`는 문자열 또는 `null`) |
| 서버 → 클라이언트 | `{type:'ready', cwd}` · `{type:'replay', events, restored?, restoreFailure?}` · `{type:'update', update, settings?}`(ACP `session/update` 원본 + 사용자 발화 설정) · `{type:'permission', id, toolCall, options}` · `{type:'permission_done', id}` · `{type:'turn_start', startedAt}` · `{type:'turn_end', stopReason, durationMs}` · `{type:'error', message, accessIssue?}` |

- **되감기는 한 프레임이다(**`replay`**).** 붙는 순간 서버가 쌓아 둔 대화(`snapshot()`)를 통째로 보내고, 그 뒤부터 이벤트가 하나씩 흐른다. 창은 마지막으로 본 전사를 탭·런타임·cwd별 `localStorage`(`mew:agent-events:*`)에 캐시해 브라우저 재진입 첫 프레임부터 그린다. 같은 세션의 `replay`는 캐시와 겹치는 꼬리를 제거한 뒤 최신분만 이어 붙이고, 다른 세션이면 `replay`로 갈아끼운다. 창은 소켓이 끊겨도 대화를 지우지 않는다. 예전에는 되감기 이벤트를 **한 개씩** 보냈고, 창은 그때마다 다시 그리느라(이벤트당 `foldEvents` 한 번 + 목록 전체) 눈에 띄게 굳었다. 지금은 긴 전사도 한 덩어리로 보내므로 이벤트 수를 이유로 질문이나 답변 앞부분을 자르지 않는다.

- 로컬 전사 캐시는 탭당 1MiB·전체 4MiB가 상한이다. 긴 대화는 상한 안에 들어가는 최근 이벤트 꼬리만 원형 그대로 저장하고, 서버의 전체 `replay`가 오면 앞부분을 복원한다. 서버 탭 원장 조회 중에는 활성 ACP 탭의 최근 텍스트를 읽기 전용으로 먼저 표시하며, 실제 세션 연결은 원장 확인 뒤에만 시작한다. 저장 전 오래된 캐시를 정리해 공간을 확보하고 quota 실패 시 전사 캐시만 비워 한 번 재시도한다. 계정 탭 원장에 없는 탭의 `mew:agent-events:*`·`mew:agent-controls:*` 캐시는 탭 동기화 때 지운다.

- **히스토리를 열 때마다** 계정의 모든 루트 프로젝트 탭이 주장한 ACP 세션을 다시 읽는다. 현재 탭 또는 다른 탭이 이미 연 세션은 목록에서 잠가 두므로, 이미 붙은 writer를 다시 `session/load`해 ACP의 `Internal error`가 나는 경로가 없다.

- **창은 들어오는 이벤트를 한 프레임에 모아 한 번만 그린다**(`requestAnimationFrame`). 스트리밍 청크는 초당 수십 개다. `reset`도 그 줄에서 순서대로 처리돼 "비우기"와 "새 대화"가 같은 프레임에 들어간다.

- `meta`**·**`sessions`**·**`reset`**은 이벤트 버퍼에 쌓지 않는다.** `meta`는 상태 스냅샷이라 붙을 때·바뀔 때 통째로 보내고(`sessionId`·`startedAt`·`turns`·`busy`·`queued`·`usage`·`canLoad`·`canList`), `sessions`는 **물어본 창에만, 물어봤을 때만** 답한다(claude 런타임은 세션이 뜨기를 기다리지 않고 디스크에서 바로 읽는다). 세션 목록의 cwd 비교는 대소문자를 구분하지 않아, 이전 기록의 경로 표기가 현재 실제 경로와 달라도 같은 폴더 히스토리로 찾는다. `reset`을 받은 창은 지금까지 그린 대화를 버린다.

- 서버는 소켓에 **30초마다 핑**을 보낸다 — 조용한 대화(에이전트가 긴 작업 중일 때)가 중간 장비의 유휴 타임아웃에 끊기지 않게. 그래도 끊기면 창이 1초 뒤 다시 붙고 `replay`로 복구한다.

- **진행 중에 온** `prompt`**는 던지지 않고 줄을 세운다.** 턴이 끝나면 서버가 순서대로 이어 돌리고, `cancel`은 대기열도 함께 비운다. 대기 항목은 창에서 자리를 옮기고(`move_queued`) 내용도 고칠 수 있다(`edit_queued`) — 고치는 사이 앞 턴이 끝나 큐가 당겨질 수 있으므로 `expect`(창이 보고 있던 원본)가 지금 그 자리의 값과 다르면 서버가 무시한다.

- 불러오기(`/resume`)는 **ACP 메서드**(`session/list`·`session/load`)다. 진행 중인 턴·승인·대기열과는 겹치지 않는다. 다른 런타임은 같은 자식 프로세스에서 세션만 갈아끼우지만, **Codex는 히스토리 전환 전에 어댑터를 재시작**해 이전 thread writer를 반납한다([ADR 0122](../../../.mew/docs/decisions/0122-mew-codex-history-load-restarts-writer.md)). 선택한 Codex 기록 불러오기가 실패하면 새 어댑터에서 바로 전 thread를 다시 불러와 현재 대화를 복구한다. 자동 복원 실패 시 `replay.restoreFailure`로 실패한 ID를 내려 원래 탭 포인터와 브라우저 전사를 보존한다. 사용자가 다른 히스토리를 고르거나 새 메시지를 보낼 때만 fallback 새 세션을 채택한다. 목록을 물어볼지는 `initialize`의 capability(`meta.canList`)로 정한다. 정확한 `/clear`는 CLI에 프롬프트로 넘기지 않는다. 작업 중이면 서버 큐의 **세션 경계**로 들어가 앞선 작업을 마친 뒤 ACP 새 세션을 열고, 그 뒤 큐에 넣은 메시지는 새 대화에서 실행한다. 이전 대화는 히스토리에만 남는다.

- Prime Agent는 공식 `prime-agent --mode rpc`를 Mew 내부 어댑터가 ACP로 변환한다. 따라서 Prime ACP의 구현 유무와 무관하게 세션 목록/불러오기, 모델, thinking mode를 Mew 창에서 제공한다.
- Codex `/clear`는 큐 경계에서 어댑터와 자식 프로세스 그룹의 종료를 기다린 뒤 새 ACP 연결을 초기화하고 `session/new`를 호출한다([ADR 0140](../../../.mew/docs/decisions/0140-mew-codex-clear-releases-writer.md)). `AgentSession`·감독·탭·대기 큐와 편집 소유권은 유지한다. 실패하면 전사와 포인터를 보존하고 큐를 멈추며 `/clear` 재시도가 성공한 뒤에만 뒤 메시지를 실행한다. 종료 중 dispose되면 새 프로세스를 만들지 않는다. 다른 런타임은 기존 연결을 재사용한다. `agent-clear.test.ts`는 연속 경계·전환 실패/재시도·초기화 프로세스 종료·탭 종료를, `agentHost.test.ts`는 히스토리 로드 전부터 이전 writer가 종료된 상태를 검증한다.

- **토큰 사용량만 ACP 밖에서 온다** — 어댑터가 사용량을 보내지 않아 `agentUsage.ts`가 `<CLAUDE_CONFIG_DIR>/projects/<인코딩된 cwd>/<sessionId>.jsonl`을 읽는다. 읽기 전용·선택적이고, 파일이 없으면 사용량 칸만 빈다([ADR 0036](../../../.mew/docs/decisions/0036-mew-agent-session-controls-and-usage.md)).

- `GET /api/agent-cwd?path=&base=`는 주소창 입력을 서버 파일시스템 기준 절대 디렉터리로 검증한다 (owner/manager). 빈 `path`는 현재 워크스페이스, 상대경로는 `base` 기준이다.

- `GET /api/agent-cwd/suggestions?input=&base=&entered=`는 입력 중인 마지막 경로 조각의 접두어와 맞는 하위 디렉터리, 또는 이미 들어간 디렉터리의 하위를 돌려준다(owner/manager).

## CLI 도구와 프로세스 환경

- Claude는 [ADR 0142](../../../.mew/docs/decisions/0142-mew-claude-acp-and-cli-authentication.md)에 따라 대화형 ACP로 복원했다. 공식 CLI의 로그인 종료 후 감독이 ACP를 다시 초기화한다. 인증 실패·중단은 성공으로 취급하지 않으며 재시도할 수 있다. 실행·로그인·상태 조회·로그아웃은 같은 CLI 엔진과 설정 환경을 사용한다. `claude-acp-auth.test.ts`는 실제 계정을 호출하지 않는 CLI/ACP fixture로 이 경계를 검증한다.

- 클라이언트 capability는 **인증에 필요한** `auth.terminal`**·**`elicitation.url`**만 광고하고** `fs`**는 광고하지 않는다** — `fs`를 켜면 어댑터가 CLI의 `Read`·`Write`·`Edit`를 끄고 `mcp__acp__*`로 갈아끼워서, 터미널에서 만든 대화를 창에서 불러올 때 전사 속 `Edit` 참조가 API 400으로 거부된다. 도구 이름을 CLI와 맞춰 두는 것이 계약이다 ([ADR 0044](../../../.mew/docs/decisions/0044-mew-agent-cli-tool-parity.md)) — 경로 스코프는 없다.
- 워크스페이스를 갈아끼우면 **떠 있던 세션을 전부 접는다**(`disposeAllSessions`) — 자식 프로세스의 cwd는 뜰 때 정해져 옛 폴더에 매여 있다.
- 자식 환경에서 `CLAUDECODE`**를 지운다.** 남아 있으면 Claude Code가 중첩 세션으로 보고 실행을 거부해 세션 생성이 통째로 실패한다(mew 서버를 Claude Code 터미널에서 띄우면 상속된다).
- 저장한 런타임 설정은 ESM import로 읽는다. 이전 `require()` 실패를 catch로 숨기던 경로를 제거하여 CLI 실행 파일·환경 설정이 실제 spawn에 반영된다. Claude의 히스토리·사용량 경로도 적용된 `CLAUDE_CONFIG_DIR`을 따른다.

## Antigravity ACP 인증

Antigravity는 Google 공식 ACP 서버를 직접 spawn한다. `initialize.authMethods`를 유지하고 `gemini-api-key`는 환경변수 인증 버튼으로 분류한다. Google OAuth는 `authenticate` 중 stderr로 출력되는 `accounts.google.com/o/oauth2/…` HTTPS URL만 공통 `auth_url` 이벤트로 보낸다. 분할 청크를 줄 단위로 조립하고 32 KiB를 넘는 줄은 버리며, 원문 stderr는 로그·전사에 저장하지 않는다.

URL 이벤트는 재접속한 인증 화면에만 재전송된다. 성공·실패·취소 시 `auth_url_done`으로 브라우저를 닫고 URL을 버린다. ACP에 authenticate 취소 메서드가 없으므로 취소·330초 시간 초과는 해당 연결의 프로세스를 종료하고 initialize부터 다시 진행한다. 이전 연결의 늦은 응답은 새 세션을 만들지 않는다. 공급자 CLI 자격증명은 읽거나 복사하지 않는다. 설치·환경변수·지원 범위는 [런타임 설정](../configuration/agent-runtimes.md#antigravity-공식-acp), 결정은 [ADR 0143](../../../.mew/docs/decisions/0143-mew-antigravity-official-acp.md)을 따른다.
