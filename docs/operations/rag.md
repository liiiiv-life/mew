---
title: "mew 내장 RAG 운영"
desc: "로컬 의미 검색의 데이터 수명주기·권한·복구 기준."
created: 2026-08-21
updated: 2026-09-11
reviewed: 2026-08-21
review-after-days: 90
---

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
