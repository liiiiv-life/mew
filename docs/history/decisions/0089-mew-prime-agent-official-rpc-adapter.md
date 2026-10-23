---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: Prime Agent는 공식 CLI의 RPC를 Mew 어댑터로 연결한다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0089 — Prime Agent는 공식 CLI의 RPC를 Mew 어댑터로 연결한다"
created: 2026-08-27
updated: 2026-09-11
---

- 날짜: 2026-08-27
- 상태: 채택
- 후속 결정: [0090](0090-mew-agent-reasoning-and-permission-controls.md) — Prime thinking을 권한 mode로 표시; RPC 어댑터는 유지
- 대체: [0076](0076-mew-prime-agent-local-acp-compatibility-fork.md)
- 결정자: 송상훈 (지시)

## 배경

공식 Prime Agent에는 RPC 모드가 있고 세션 전환·전사 조회·모델 조회/변경·thinking level 변경을 제공한다.
반면 ACP 표면에는 Mew가 필요한 세션 목록/불러오기와 모델·mode 계약이 없다. 이 차이 때문에 0076은
Prime 본체의 로컬 포크를 빌드해 ACP 기능을 직접 추가했다.

## 결정

- Mew는 `server/primeAdapter.ts`에서 공식 `prime-agent --mode rpc`를 실행하고, 그 JSONL을 Mew의 기존
  ACP 감독 경계로 변환한다.
- `prime` 런타임은 Node로 이 어댑터를 실행하며, 저장된 `prime.cmd`와 `MEW_AGENT_PRIME_CMD`로 로컬
  포크를 다시 지정할 수 없다. 공식 실행 파일 변경이 필요할 때만 `MEW_PRIME_AGENT_EXECUTABLE`을 쓴다.
- 어댑터는 Prime RPC의 `switch_session`·`get_messages`·`get_available_models`·`set_model`·
  `set_thinking_level`을 각각 ACP 세션/모델/mode로 변환한다. 세션 목록은 Prime의 공식 저장 디렉터리를
  제목·cwd 필터 용도로만 읽고, 실제 로드와 전사는 RPC로 수행한다.
- Prime의 thinking level은 Mew의 mode 선택기에 그대로 노출한다. 이 값은 파일 도구 권한을 뜻하지 않는다.

## 결과

- 로컬 Prime 소스·빌드·rebase 운영 의존성이 사라진다.
- 공식 CLI의 RPC wire 형식이 바뀌면 Mew 어댑터만 갱신한다. Prime 저장 파일은 목록 최적화에만 쓰므로,
  그 형식 변화로 세션 전환 또는 대화 실행이 깨지지 않는다.
