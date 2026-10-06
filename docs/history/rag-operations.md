---
title: "mew 내장 RAG 운영"
created: 2026-08-21
updated: 2026-09-28
reviewed: 2026-08-21
review-after-days: 90
description: "제거 전 RAG의 원문·색인 저장 위치, 검색 경계·비용·복구·임베딩 초기화와 문서 탐색 비교 운영 절차를 보존한다."
---

> 2026-09-28: [ADR 0176](../../../.mew/docs/decisions/0176-mew-remove-local-rag.md)에 따라 RAG를 제거했다. 아래는 당시 기록이며 현재 실행 지침이 아니다. 사용자 요청 없이 재도입·재색인·모델 다운로드를 재시도하지 않는다.


mew 의미 검색 운영 기준(reference). 구현·환경 변수·API 계약은 [검색 설정](../configuration/search.md)·[환경변수](../configuration/environment.md), 선택 근거는 [ADR 0071](../../../.mew/docs/decisions/0071-mew-embedded-lancedb-local-rag.md).

## SSoT와 저장 위치

- 원문 Markdown·코드가 SSoT다. LanceDB·manifest·임베딩 모델은 모두 파생 캐시다.
- 캐시는 `MEW_DATA_DIR/rag/`에 있어 네이티브 설치와 Docker `/data` 볼륨에서 같은 수명주기를 갖는다.
- 백업·Git 추적 대상이 아니다. 손상·모델 변경 시 캐시를 버리고 원문에서 재생성한다.

## 검색 경계

- 현재 선택 프로젝트의 기본 트리에 노출되는 텍스트 파일만 인덱싱한다.
- 의미 검색은 로그인 사용자만 가능하다. 게스트는 승인 경로가 있어도 정확 검색만 쓴다.
- 쿼리 결과를 요청 시점의 가시 파일 집합으로 다시 거른다. 인덱스가 과거 경로를 갖고 있어도 반환하지 않는다.
- docs는 MOC의 Current를 기본으로 하고 History/raw·폐기/대체 ADR은 명시적으로 포함할 때만 검색한다.

## 비용·복구

- 최초 검색: q8 모델 약 130MB 다운로드 + 전체 파일 임베딩. 이후 변경 파일만 갱신한다.
- 외부 DB·API 키·문서 전송 비용은 없다. CPU와 로컬 디스크만 쓴다.
- 의미 검색 장애는 정확/정규식 검색과 서버 부팅을 막지 않는다.
- 결과 품질 회귀는 경로·줄 인용이 정답 문서를 포함하는지 평가 세트로 확인한다. 생성 답변의 정확도와 분리한다.

## 공통 설정·진입

독의 RAG에서 설정과 현재 색인을 확인한다. `DATA_DIR/rag-settings.json`은 사용자 설정이며 파생 캐시와 달리 보존한다. CLI와 서버는 같은 워크스페이스 색인 잠금을 사용하고 종료된 프로세스의 잠금은 다음 접근에서 복구한다. 검색 명령·권한·적용 시점은 [검색 설정](../configuration/search.md)을 따른다.

## 서버 DOM과 임베딩 초기화

협업 편집기 초기화 후에만 `self is not defined`가 나오면 브라우저 호환 전역의 누락을 확인한다. `server/collabAgent.ts`가 `window`와 같은 Window의 `self`를 설치하고, `server/rag/embeddings.ts`가 Node CPU·파일 캐시·로컬 모델 읽기를 명시한다. 실패한 모듈 import는 프로세스에 남을 수 있어 수정 반영 후 서버 재시작이 필요하다. 에이전트가 직접 빌드·재시작하지 않는다.

회귀 검사는 `node --test server/rag/embeddings.test.ts`다. 실제 협업 DOM 초기화 뒤 라이브러리를 로드한다. 캐시가 준비된 환경에서는 `MEW_RAG_TEST_MODEL_CACHE=<모델 캐시 절대 경로> node --test server/rag/embeddings.test.ts`로 외부 다운로드 없이 임시 Docs의 실제 임베딩·색인·검색·재색인도 검증한다. 사용자 문서나 운영 색인은 변경하지 않는다.

## 문서 탐색 방식 비교

`python3 server/rag/benchmark-discovery.py --output .data/benchmarks/<새 실행명>`은 현재 문서의 별도 스냅샷으로 RAG·MOC·일반 파일 검색을 비교한다. **실제로 모델을 9회 호출하므로 계정 사용량을 소비한다.** 기존 Codex CLI 인증과 `.data/rag/models`의 다운로드된 모델이 필요하다. 앱 빌드·서버 재시작은 하지 않는다.

- 기본값은 GPT-6 Astra·medium·standard이며 `--model`·`--effort`로 바꾼다. 매 실행은 대화 이력이 없는 새 세션이며, 방식별 안내 외에는 같은 질문·출력 형식·문서 범위를 사용한다.
- 일반 검색 조건은 파일 접근과 `rg` 등을 제공한다. 전체 문서를 모델 입력에 미리 넣지 않는다. MOC 지도 내용과 RAG 사용은 제외한다.
- 최초 색인 준비 시간, 세션 전체 경과 시간, CLI가 반환한 입력·캐시·출력 토큰, 셸 명령 수, 기대 문서 경로 회수를 기록한다. 정답 설명의 품질과 방법 준수는 원문·실행 기록으로 별도 검토한다.
- 스냅샷·해시·프롬프트·JSONL·답변·결과는 지정한 `.data` 아래에 보관한다. 세션 임시 디렉터리도 metadata에 남긴다. 원시 실행 로그를 문서에 복제하지 않는다.
- 모델·질문별 1회인 탐색적 비교다. 실행 순서를 교차해도 네트워크·호스트 부하·공급자 캐시를 완전히 통제하지 못한다. 토큰 단가 환산은 실제 구독 청구액과 구분한다.

첫 실행의 조건·결과·한계는 [문서 탐색 비교 측정](../research/document-discovery-benchmark.md)에 기록한다. 기존 `npm run rag:eval`의 검색 정답 경로 평가와 별도다.
