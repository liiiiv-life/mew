---
title: "대화 저장과 구간 동기화"
created: 2026-09-30
updated: 2026-09-30
---

# 대화 저장과 구간 동기화

[개발 지도](MOC.md) · [세션 계약](agent-sessions.md) · [ADR 0182](../../../.mew/docs/decisions/0182-mew-incremental-conversation-storage.md)

## 서버 저장

`server/agentTranscript.ts`는 `<DATA_DIR>/agent-transcripts/transcripts.sqlite`에 `sessions`와 `events`를 저장한다. 키는 기존과 같은 SHA-256(runtime, cwd, sessionId), 이벤트 기본키는 `(session_key, seq)`다. 별도 DB 서버나 새 의존성은 없으며 기존 Node 내장 `node:sqlite`를 사용한다. 디렉터리 0700·DB 파일 0600, schema `user_version=1`이며 더 높은 버전은 쓰지 않는다.

WAL·`synchronous=FULL`·1초 busy timeout을 사용한다. DB는 같은 호스트의 로컬 디스크에 둔다. 일반 스트리밍은 최초 미저장 이벤트 후 250ms에 모아 저장하고, 턴 종료·종료 처리 때 즉시 저장한다. 같은 append-only 이벤트 배열의 이미 기록한 접두부는 직렬화·INSERT를 반복하지 않는다. ACP 복원 등으로 배열이 교체되면 하나의 트랜잭션으로 해당 세션 기록을 교체한다. 같은 내용의 재저장은 DB 갱신을 생략한다.

최초 조회 시 세션 행이 없으면 기존 `<hash>.json`의 version 2·세션 키·이벤트 배열을 검사해 이전한다. JSON은 삭제하거나 덮어쓰지 않는다. 불완전한 v1 전사는 이전하지 않는다. 손상·잠금·용량 오류는 기록하며, 실패한 트랜잭션은 이전 기록을 유지한다. 다른 writer가 갱신한 전사를 오래된 append 버퍼로 덮어쓰지 않도록 revision·개수를 검사한다. 저장 실패가 진행 중 대화를 멈추지는 않는다. 이후 저장 기회에 미저장 꼬리를 다시 시도한다. 기존 JSON은 이전 시점의 원본 보존용이며, 새 DB 변경을 역으로 동기화하는 롤백 사본은 아니다.

공급자 ACP 기록은 에이전트 컨텍스트의 기준이다. 외부 CLI 변경·설정·완료 시간 병합은 기존 [세션 복원 계약](agent-sessions.md#메시지재접속큐)을 따른다. SQLite는 Mew 표시 전사이며 공급자 저장소를 수정하지 않는다. 감독은 현재 전체 이벤트 배열을 여전히 메모리에 보유하고 ACP 복원 시 전체 히스토리를 조정하므로, 이 변경은 공급자 복원 시간이나 감독 메모리 전체의 상한을 보장하지 않는다.

## 구간과 연결

`shared/agent-history.ts`의 범위는 `[start, end)`다. 감독 생성·전사 교체마다 새 generation을 만들고 현재 질문 경계를 증분 인덱싱한다. 기본 화면은 최근 **20개 질문과 연결된 답변·도구 기록**이다. 한 질문의 연속 청크·답변은 분리하지 않는다. 따라서 하나의 거대한 턴은 20턴 정책만으로 바이트 크기가 제한되지 않는다.

- WS의 `history=1&generation=...&after=...`는 마지막으로 실제 보유한 순번을 전달한다. 같은 generation이고 최근 구간 안의 유효한 순번이면 새 꼬리만 `append`, 그 밖에는 최근 구간 `replace`다.
- `history` 응답은 세션 ID·generation·start/end/total·앞선 질문 수(`usersBefore`)·events·현재 모델/권한/thinking controls를 담는다.
- `{type:'history', range:{generation,before:start}}`는 바로 앞 최대 20개 질문을 `prepend`로 읽는다. 저장된 부분은 SQLite의 기본키 범위 조회, 아직 저장되지 않은 꼬리는 감독 메모리에서 얻는다.
- 실시간 `history_event`는 event와 `{generation,seq}`를 함께 보낸다. 브라우저는 중복을 무시하고 누락·세대 변경을 발견하면 최근 구간을 재요청한다. 순번은 화면 state 반영보다 먼저 메모리 기록에 반영하므로 빠른 재접속에도 잘못된 커서를 보내지 않는다.
- 감독은 hello의 capability와 subscribe로 협상한다. 구 클라이언트에는 전체 replay, 구 감독에는 기존 replay 경로를 사용한다. 실행 중인 구 감독은 교체 전까지 전체 전송을 계속할 수 있다.
- 조회는 인증·기능 권한을 재검사하는 기존 탭 WS/감독 IPC 안에서만 가능하다. 임의 세션 키를 받는 공개 조회 API를 추가하지 않는다. 자동 복원 실패 시 원래 탭 포인터·기기 전사를 보존한다.

## 브라우저와 화면

`src/utils/agent-history-cache.ts`는 `mew-agent-history` IndexedDB의 sessions/events 저장소를 사용한다. 키는 로그인 계정·런타임·탭·cwd이고 이벤트는 순번별 행이다. 최근 20개 질문만 저장하며, 동일 구간에 새 기록이 붙으면 새 행만 저장한다. 느린 저장 중 갱신은 최신 스냅샷 하나로 합쳐 대기열이 계속 자라지 않게 한다.

상한은 항목별 4MiB, 전체 32MiB, 최대 128개, 마지막 기록 후 7일이다. 크기는 직렬화 길이 기반 추정치이며 실제 브라우저 quota와 다르다. 초기 열기 때 만료분, 저장 때 만료·용량·개수 초과분을 정리한다. 한 구간이 항목 상한을 넘으면 기기 캐시를 생략하며 서버 기록은 유지한다. quota·저장 금지·업그레이드 지연은 캐시 없는 연결로 폴백한다. 캐시 읽기 대기는 최대 200ms다. 일반 동작 중 비동기 저장하며 종료 이벤트 저장 완료를 가정하지 않는다.

서버 탭 원장을 확인한 뒤 동일 계정·세션의 유효한 기기 기록을 실제 버블로 먼저 표시한다. 오래된 localStorage 줄글 미리보기는 사용하지 않고 새 구간을 받으면 해당 레거시 전사 키를 제거한다. 기기 캐시를 세션 포인터의 기준으로 사용하지 않는다. 입력 초안·설정·컨트롤 캐시는 기존 [브라우저 저장 계약](browser-storage.md)을 유지한다. 탭의 명시적 종료는 해당 계정·탭의 모든 런타임/cwd IndexedDB 기록도 제거한다.

위로 스크롤해 상단 80px에 도달하면 이전 구간을 요청한다. 앞쪽 삽입 전후 높이 차이로 읽던 위치를 유지하고, 전역 이벤트 순번을 버블 키에 사용해 펼침 상태를 보존한다. CLI 배치와 새 CLI의 질문 수는 `usersBefore`를 포함한다. 이미 읽은 과거 구간은 열린 화면에 유지하며, 재접속/기기 저장의 기본 구간은 최근 20개다.

## 검증과 측정

- `agentTranscript.test.ts`: v2 비파괴 이전·v1 제외·다시 열기·키 격리·긴 전사·증분 INSERT·범위 읽기·교체·실패 rollback·여러 프로세스의 WAL 쓰기.
- `agent-history.test.ts`: 모의 ACP와 격리 WS/감독의 최근/이전 구간·실시간 순번·재접속 delta·clear generation 변경. 실제 공급자 호출 없이 검사한다.
- `agent-history-state.test.ts`·`agent-command-timeline.test.ts`: 전체 재구성·중복/누락·동시 prepend/append·캐시 최근 구간·전역 버블 키·CLI 순서.
- `agent-history-ui.test.ts`: 격리 Chromium의 PC/모바일·양 테마에서 스크롤 유지·IndexedDB 복원·계정 격리·delta 재접속·quota rollback·탭 캐시 정리. 기존 연결/큐 UI 테스트도 함께 검사한다.

2026-09-30 합성 500턴(턴당 답변 청크 20개, 청크당 256자), 이벤트 11,500개의 로컬 단일 실행 결과:

| 지표 | 기존 전체 JSON | 새 구조 |
| --- | --- | --- |
| 누적 직렬화 payload | 925,911,740 bytes | 이벤트 payload 3,684,780 bytes |
| 최초 전송 payload | 3,696,281 bytes | 최근 20턴 148,002 bytes |
| 읽기 평균(20회) | 전체 파싱 6.37ms | 최근 구간 조회 0.38ms |
| 500회 저장 경과 시간 | 1,799ms | 2,608ms |

SQLite 수치는 DB 페이지·WAL·인덱스 쓰기 바이트를 제외한 이벤트 payload다. JSON은 fsync 없는 write+rename, SQLite는 FULL commit이므로 내구성 조건이 다르다. 이 측정에서는 읽기·전송량을 줄였지만 쓰기 지연은 증가했다. 실제 사용자 체감·공급자 복원·전원 장애 복구 성능은 측정하지 않았다.
