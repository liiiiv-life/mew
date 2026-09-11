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
