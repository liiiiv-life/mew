# 협업 방과 멤버 채팅

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

## 협업 방 (Yjs 릴레이)

- `server/collab.ts` — 방·클라이언트·awareness·`/api/collab` 웹소켓. 방 하나 = `프로젝트:상대경로`
- `server/syncCodec.ts` — 프레임 인코딩/디코딩. **와이어 포맷이 코드 결합 계약이다**: 바깥 varUint 채널(`0` sync · `1` awareness) + sync 안의 varUint 종류(`0` step1 · `1` step2 · `2` update) + varUint8Array 본문. y-protocols와 바이트 단위로 같아야 하고 `server/syncCodec.test.ts`가 그것을 대조한다 — 어긋나면 배포 순간 열려 있는 모든 탭이 조용히 깨진다. 신뢰할 수 없는 바이트에는 던지지 않고 `null`을 준다
- `server/roomDoc.ts` — CRDT 백엔드 둘(JS Yjs · Rust yrs). 요구 면은 셋뿐: `stateVector()` · `encodeStateAsUpdate(sv?)` · `applyUpdate(update)`. `applyUpdate`는 **방이 새로 얻은 업데이트**를 돌려준다(없으면 `null`) — 브로드캐스트는 이 값으로 한다. 상태 벡터 diff로 계산하면 삭제만 있는 업데이트가 빈 diff로 보여 사라진다
- `server/collabAgent.ts` — 디스크→방 브리지. **자기 Y.Doc + awareness를 들고 방의** `connect()`**로 붙는 인프로세스 클라이언트다** — 방의 doc을 붙들지 않는다(백엔드를 갈 수 없게 된다). 루프백 소켓을 쓰지 않는 이유는 `authorizeCollab`(게스트 차단) 우회 통로를 뚫어야 하기 때문. 터미널에서 고친 `.md`가 열려 있는 Yjs 방에 `agent` 커서로 실시간 주입되는 정상 기능이다 — 2026-07-25에 지운 에이전트 창과는 무관하니 헷갈려서 지우지 말 것. `appWrites` 메아리 원장이 사용자의 정상 타이핑을 보호한다
- 인증·`MAX_ROOMS`·awareness·방 수명은 백엔드와 무관하게 JS에 남는다. 방을 살려두는 것은 **실제 접속자뿐**이다 — 브리지의 인프로세스 클라이언트를 세면 방이 영원히 닫히지 않아 헤드리스 에디터와 fs watcher가 쌓인다

Rust 백엔드는 선택이고 기본은 꺼져 있다([ADR 0035](../../../.mew/docs/decisions/0035-mew-collab-rooms-rust-yrs.md)):

```bash
npm run build:native        # native/collab (cargo, napi-rs) → native/collab/mew-collab.node
MEW_COLLAB_RUST=1 npm run serve
```

`.node`는 플랫폼별 산물이라 커밋하지 않는다. `MEW_COLLAB_RUST=1`인데 로드가 실패하면 **조용히 JS로 돌지 않고 던진다** — 어느 구현이 도는지 모르는 상태가 협업 경로에서 제일 위험하다.

서버의 헤드리스 에디터 DOM은 `window`·`document`와 함께 같은 Window를 가리키는 `self`를 제공한다. 브라우저 전역 일부만 있으면 RAG의 Transformers.js가 브라우저 경로를 감지한 뒤 `self is not defined`로 초기화에 실패한다. 기존 전역은 덮어쓰지 않는다. RAG는 DOM 유무와 관계없이 Node CPU·파일 캐시를 사용한다.

## 활성 mew 세션 (presence)

- 프로젝트 헤더의 햄버거 왼쪽 숫자는 `/api/presence`에 연결된 **브라우저 탭·창별 세션 수**다. 같은 계정의 여러 탭, 백그라운드 탭, 게스트도 각각 센다. 로그인 쿠키 수·에이전트 실행 수와는 별개이며 로그인 화면은 집계하지 않는다.
- `server/presence.ts`가 기존 `participants` 메시지에 `activeSessions: {selfId, sessions}`를 추가한다. 타입 기준본은 `shared/active-sessions.ts`. 연결 UUID는 공개 표시용이며 인증 세션 토큰과 무관하다. 이메일·표시 이름은 서버 인증과 사용자 프로필로 결정하고 클라이언트가 보낸 신원은 받지 않는다.
- 목록에는 브라우저·기기(User-Agent에서 추정), 접속 시각, 클라이언트가 보고한 프로젝트 이름·포커스 파일·백그라운드 여부를 담는다. 파일을 열지 않은 세션도 남기며 사용자별로 묶고 현재 탭을 표시한다. 연결 종료는 즉시 제거하고 30초 ping/pong으로 응답 없는 연결을 다음 주기에 제거한다. 재연결은 새로운 접속으로 센다.
- 목록은 로그인 사용자에게만 전송한다. 전송 전에 각 연결의 인증을 재검증하며 게스트·비밀번호 변경 필수 상태에는 목록·전체 수를 보내지 않는다. 게스트의 기존 경로별 참여자 색은 열람 권한으로 계속 필터링한다.
- `usePresence`는 파일·프로젝트·문서 가시성 변경 시 같은 소켓으로 상태를 갱신한다. 소켓이 끊기면 목록을 비우고 헤더 숫자는 `—`, 열린 팝업은 연결 중으로 표시한다. 3초 후 재연결하며 오래된 숫자를 유지하지 않는다. 팝업은 공통 overlay 스택의 Esc·뒤로가기, 바깥 클릭, 닫기 버튼을 지원한다.
- `AgentPanel`은 현재 프로젝트에 열려 있고 연결된 에이전트 탭의 `busy` 상태(해당 탭에서 실행 중인 CLI 명령 포함)를 `App`에 전달한다. 대기·닫힌 탭·일반 tmux는 제외하고, 패널 숨김만으로는 빼지 않는다. 프로젝트 전환·패널 제거·연결 종료 시 이전 집계를 지운다. `usePresence`는 상태 변경과 30초 주기로 `focus.runningAgents`를 보고한다.
- 서버는 0 이상의 안전한 정수만 해당 소켓의 `agents: {running, reportedAt}`로 저장하며 시각은 서버가 정한다. 90초 지난 보고·누락·잘못된 값은 `null`이다. 이는 브라우저별 현재 프로젝트의 관측값이며 서버 전체 실행 수가 아니다. 여러 브라우저의 같은 작업은 중복될 수 있어 합계를 제공하지 않는다. 이력은 저장하지 않는다. JS 힙 측정·전송·표시는 제거했으며 사용자 요청 전 재도입하지 않는다.
- 검증: `server/presence-sessions.test.ts`는 실제 WebSocket으로 연결 수·이동·인증 해제·게스트 차단을 확인한다. `server/active-sessions-ui.test.ts`는 브라우저에서 모바일·데스크톱 팝업과 재연결 표시를 확인한다.

## 멤버 채팅 (`.data/chat.json`)

단체방 하나 + 사람마다 1:1 DM. 전달은 전용 소켓 없이 **presence 신호 + REST 재조회**다 — `{type:'chat'}` 신호에는 내용이 없다(그 소켓은 게스트에게도 간다). 모델은 [ADR 0050](../../../.mew/docs/decisions/0050-mew-chat-dm-and-read-receipts.md).

**방 식별자는 없다.** `to`**(수신자 배열)가 있으면 DM, 없으면 단체방이다.** 대화는 보는 사람 기준으로 계산한다(`server/chat.ts`의 `conversationsOf`). 화면 쪽 `inConversation`이 같은 규칙이라 **둘은 같이 고쳐야 한다.**

| 요청 | 하는 일 |
| --- | --- |
| `GET /api/chat` | **그 사람이 볼 수 있는 것만** — `{messages, unread}`. 남의 DM은 응답에 실리지 않는다. 메시지마다 `unread`(아직 안 읽은 수신자 수), `unread` 맵은 대화별로 **내가** 안 읽은 수 |
| `POST /api/chat` `{text, to?}` | `to`를 주면 DM. 수신자는 실재하는 계정만 통과한다 |
| `POST /api/chat/read` `{conversation}` | 그 대화를 읽었다고 적는다. 대화 키는 `group` 또는 상대 이메일 |

- **읽음 포인터는 "지금 시각"이 아니라 읽는 순간 그 대화의 마지막 메시지 시각이다.** 지금 시각으로 찍으면 같은 밀리초에 도착한 다음 메시지가 읽은 것으로 묻힌다. 같은 이유로 원장의 메시지 시각은 **엄격히 증가**시킨다(`max(now, 마지막+1)`) — 이 둘은 한 쌍이니 따로 고치지 말 것
- 읽음은 **바뀔 때만** 방송한다. 창이 떠 있는 동안 계속 찍으면 방송이 무한히 돈다
- 500줄 상한은 단체·DM 공용이다
