# 프로젝트 검색과 로컬 RAG

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

`Ctrl+Shift+F` 검색창의 `의미` 버튼은 현재 프로젝트의 보이는 텍스트 파일을 청크로 나눠 로컬 LanceDB에서 검색한다. 로그인 사용자 전용이며 외부 API로 문서를 보내지 않는다.

- 기본 모델 `Xenova/multilingual-e5-small` q8(384차원)은 첫 검색 때 약 130MB를 내려받아 `<MEW_DATA_DIR>/rag/models`에 캐시한다. Docker에서는 기존 `/data` 볼륨에 남는다.
- DB와 manifest는 `<MEW_DATA_DIR>/rag/indexes/<workspace-hash>`에 있다. Markdown·코드가 SSoT이고 이 폴더는 지워도 다음 검색에서 전부 재생성된다.
- 파일 크기·mtime fingerprint가 바뀐 파일만 재임베딩한다. docs는 MOC의 Current를 기본 검색하고 `이력` 버튼을 켰을 때만 History/raw와 대체 ADR을 포함한다.
- 모델 다운로드·초기 인덱싱이 실패하면 `GET /api/search/semantic`만 503이다. 기존 정확/정규식 검색은 영향 없다.
- API: `GET /api/search/semantic?q=&project=&history=0|1`, `GET /api/rag/status`, `POST /api/rag/reindex`(manager/owner). 결과는 파일 경로·시작/끝 줄·heading·점수·인용 문맥을 포함한다.
