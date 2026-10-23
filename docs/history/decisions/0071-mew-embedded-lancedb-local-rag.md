---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: mew RAG는 내장 LanceDB와 로컬 다국어 임베딩을 쓴다. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0071 — mew RAG는 내장 LanceDB와 로컬 다국어 임베딩을 쓴다"
created: 2026-08-21
updated: 2026-09-29
---

- 날짜: 2026-08-21
- 상태: 대체됨: 0176
- 후속 결정: [0176](0176-mew-remove-local-rag.md) — 로컬 RAG 전체 제거
- 후속 결정: [0111](0111-mew-native-deployment-and-supervisor.md) — Docker 볼륨 배포 전제; 로컬 파생 색인 계약은 유지
- 결정자: 사용자 (초안: Codex)

## 배경

docs가 약 41만 토큰이 되어 MOC만으로는 질문 표현과 문서 제목이 다른 경우의 발견성이 부족하다. 그러나 Markdown이 SSoT여야 하고, mew는 네이티브 설치가 기본이며 Docker·Postgres는 선택 사항이다([ADR 0023](0023-mew-selfhost-packaging-repo.md)). 별도 Qdrant·pgvector를 필수로 만들면 mew 한 벌을 배포한다는 계약이 깨진다.

RAG가 오래된 초안·대체 ADR을 현재 답처럼 올리거나, 게스트가 인덱스를 통해 승인 밖 문서를 읽는 것도 막아야 한다.

## 선택지

1. 외부 Qdrant — 기능은 풍부하지만 별도 서비스·백업·배포가 필요하다.
2. 기존 선택 Postgres + pgvector — 운영 인프라는 재사용하지만 네이티브 기본 설치가 DB에 종속된다.
3. SQLite BLOB + 전수 cosine — 의존성은 작지만 벡터 DB 인덱스·관리 기능을 직접 만든다.
4. mew 내장 LanceDB + 로컬 임베딩 — 프로세스 안에서 파일로 영속화하고 외부 키 없이 동작한다.

## 결정

4번을 채택한다.

- `@lancedb/lancedb`를 mew 런타임 의존성으로 둔다. DB·manifest·모델 캐시는 `<MEW_DATA_DIR>/rag/` 아래에만 저장한다. Docker의 기존 `/data` 볼륨에도 함께 영속된다.
- 기본 임베딩은 `@huggingface/transformers`의 `Xenova/multilingual-e5-small` q8 ONNX(384차원)다. 한국어·영어를 같은 공간에서 검색하고, 문서는 `passage:`, 질문은 `query:` 접두사를 쓴다.
- 모델은 첫 인덱싱 때 내려받아 data dir에 캐시한다. 네트워크가 없고 캐시도 없으면 기존 정확 검색은 정상 유지하고 의미 검색만 `unavailable`로 응답한다.
- Markdown·코드 파일이 SSoT다. LanceDB는 전부 삭제해도 재생성 가능한 파생 캐시이며 백업 대상이 아니다.
- 스코프는 현재 mew 프로젝트다. 기본 트리에서 검색 가능한 텍스트 파일만 인덱싱하고, 파일 경로·줄 범위·제목·heading을 결과에 붙인다.
- 의미 검색은 로그인 사용자만 쓴다. 게스트 승인 경로를 인덱스 쿼리로 우회시키지 않는다. 결과도 요청 시점의 가시 파일 집합으로 다시 거른다.
- docs는 MOC 링크의 `Current`와 `History / raw`, ADR 상태를 인덱스 tier로 반영한다. 기본은 current만; 사용자가 명시할 때만 history를 포함한다([ADR 0070](0070-docs-hot-cold-context-layers.md)).
- 파일 fingerprint로 변경분만 다시 임베딩한다. 모델·chunk schema가 바뀌면 해당 워크스페이스 인덱스를 자동 재생성한다.
- 검색은 벡터 유사도에 로컬 키워드 겹침을 재점수하는 hybrid 방식이다. 답을 생성하는 외부 LLM은 이번 범위에 넣지 않고, 인용 가능한 관련 문맥 묶음을 돌려주는 retrieval API를 RAG 경계로 삼는다.

## 근거

- LanceDB JavaScript SDK는 Linux·macOS·Windows 네이티브 패키지를 제공하고 로컬 경로에 연결한다. mew의 단일 Node 프로세스·Docker 이미지 구조를 유지할 수 있다.
- 로컬 ONNX 모델은 API 키·문서 외부 전송이 없고, 118MB q8 모델을 한 번 캐시하면 재사용한다.
- 400K 토큰 규모에서는 외부 분산 DB보다 내장 저장소의 배포·운영비 절감이 크다. 규모가 커져 외부 DB가 필요해지면 `EmbeddingProvider`와 retrieval API 계약을 유지한 채 저장층만 새 ADR로 바꿀 수 있다.
- 생성 답변보다 검색 결과·인용을 먼저 제공하면 환각과 권한 경계를 별도 문제로 만들지 않는다. 에이전트는 반환된 경로·줄을 직접 근거로 쓸 수 있다.

## 결과

- mew 배포물만으로 의미 검색을 사용할 수 있다. Postgres·Qdrant·OpenAI 키는 필요 없다.
- 최초 사용은 모델 다운로드·전체 인덱싱 때문에 느리고 약 130MB 모델 캐시 + 벡터 인덱스 용량을 쓴다. 이후에는 변경 파일만 처리한다.
- 모델 런타임의 이미지 처리 의존성은 RAG 경로에서 호출하지 않는다. 공급망 취약점은 정기 `npm audit` 대상으로 유지하고, 텍스트 입력만 모델에 전달한다.
