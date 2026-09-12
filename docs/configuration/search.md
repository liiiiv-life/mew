# 프로젝트 검색과 로컬 RAG

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

## 파일명·내용 검색과 치환

1. `Ctrl+P`는 파일명 검색, `Ctrl+Shift+F`는 파일 내용 검색을 연다. 사이드바의 돋보기·문서 돋보기 탭으로도 전환한다.
2. 검색어를 입력한다. `Aa`는 대소문자 구분, `.*`는 정규식이다. 파일명 정규식은 전체 상대 경로에 적용한다.
3. 입력줄에서 `@`로 Documents·직계 하위 프로젝트를 하나 이상 선택한다. 여러 범위는 합쳐 검색하고, 선택이 없으면 현재 루트 전체를 검색한다.
4. 결과를 누르면 파일 또는 해당 줄로 이동한다. 내용 검색의 바꾸기 입력줄을 펼치면 파일별 또는 전체 결과를 치환할 수 있다. 일괄 치환은 파일 내용을 바꾸고 Git 커밋도 만들므로 범위와 검색어를 확인한다.

파일명 결과는 상위 50개이며 내용 검색도 결과가 많으면 일부만 표시될 수 있다. 인덱스 준비·장애 중에는 원문 검색으로 보완한다. 상세 범위·표시는 [파일 검색 스펙](../specs/file-search.md)을 따른다.

## 로컬 의미 검색 (RAG)

현재 사이드바에는 **의미 검색·History / raw 버튼이 없다**. 의미 검색은 서버 API로 제공하며, 현재 프로젝트의 보이는 텍스트 파일을 청크로 나눠 로컬 LanceDB에서 검색한다. 로그인 사용자 전용이며 외부 API로 문서를 보내지 않는다.

인증된 세션에서 `GET /api/search/semantic?q=<검색어>&project=<프로젝트ID>&history=0`으로 검색한다. `history=1`은 History/raw 범위를 포함한다. `GET /api/rag/status`로 상태를 확인하고 manager·owner는 `POST /api/rag/reindex`로 재색인한다. 운영 설정은 [RAG 런북](../operations/rag.md)을 참고한다.

- 기본 모델 `Xenova/multilingual-e5-small` q8(384차원)은 첫 검색 때 약 130MB를 내려받아 `<MEW_DATA_DIR>/rag/models`에 캐시한다. Docker에서는 기존 `/data` 볼륨에 남는다.
- DB와 manifest는 `<MEW_DATA_DIR>/rag/indexes/<workspace-hash>`에 있다. Markdown·코드가 SSoT이고 이 폴더는 지워도 다음 검색에서 전부 재생성된다.
- 파일 크기·mtime fingerprint가 바뀐 파일만 재임베딩한다. docs는 MOC의 Current를 기본 검색하고 `history=1`일 때만 History/raw와 대체 ADR을 포함한다.
- 모델 다운로드·초기 인덱싱이 실패하면 `GET /api/search/semantic`만 503이다. 기존 정확/정규식 검색은 영향 없다.
- API: `GET /api/search/semantic?q=&project=&history=0|1`, `GET /api/rag/status`, `POST /api/rag/reindex`(manager/owner). 결과는 파일 경로·시작/끝 줄·heading·점수·인용 문맥을 포함한다.
