---
id: "mew-projects-documents"
parent: "mew-projects"
title: "Documents·문서 지도 관리"
status: "implemented"
created: "2026-09-18"
updated: "2026-10-04"
status_hash: "67f36d128f8ff98f55ff2f44e2197710413f6968309439a998bd606dad06b477"
files: ["src/components/DocsSettingsModal.tsx", "src/components/FileTree.tsx", "server/docsRepo.ts", "src/components/DocumentGraph.tsx", "server/document-graph.ts", "src/utils/document-graph-layout.ts", "server/document-pages.ts", "src/hooks/useTabs.ts"]
commits: []
---

## 요구사항

- Documents에서 상위 문서와 하위 문서를 탐색하고 같은 에디터에서 연다.

### 범위

- 폴더를 상위 문서로 표시하며 이름을 누르면 `_폴더이름.md` 대표 본문을 연다. 대표 파일은 하위 목록에 중복 표시하지 않는다.
- 자식 없는 문서는 `이름.md`로 저장하며 첫 자식 추가·마지막 자식 제거 때 저장 구조를 전환한다.
- 일반 클릭은 현재 탭에서 열고 Ctrl/Cmd+클릭은 새 탭을 유지한다.
- 탐색기 상단 전체 너비 문서/Documents 토글에서 문서 목록만 표시한다. 파일 보기와 전환해도 열린 에디터 탭은 유지한다.
- Docs 루트의 문서 홈 위에 그래프 보기 진입점을 제공하고 내부 문서 링크를 빠르게 탐색한다.
- 그래프에서 확대·이동·노드 드래그·검색·연결 강조·문서 열기를 제공한다.
- 문서 폴더 변경·가져오기·내보내기를 제공한다.
- Documents와 일반 파일은 현재 루트 프로젝트의 같은 에디터 탭·분할 배치를 사용한다. 파일을 번갈아 열어도 기존 탭과 옮긴 패널 위치를 유지한다.

### 경계와 제한

- 문서 가져오기는 기존 내용을 교체하는 작업이다.
- Documents는 별도 프로젝트 탭이 아니며 경로 변경은 현재 프로젝트 내부에서만 허용한다.

### 상세 계약

- [프로젝트·파일 사용법](../../guides/projects.md)
- [Documents 링크 그래프 엔진](../../development/document-graph.md)
- [Documents 상위·하위 문서 계약](../../development/document-pages.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../projects.md).

<!-- mew:implementation:start -->
## 구현 내용

- Docs 이름 클릭과 하위 펼침을 분리했다. 하위 문서 추가·이동·삭제·이름 변경·복제는 대표 파일과 본문 링크를 함께 처리하고 열린 탭 및 자동저장 경로를 갱신한다. 기존 MOC는 호환하며 실제 문서를 일괄 이전하지 않는다. [ADR 0191](../../../../.mew/docs/decisions/0191-mew-documents-parent-and-child-pages.md)을 따른다.
- 문서 그래프는 Docs 내부 Markdown·참조형·위키 링크를 권한에 따라 연결한다. 서버는 변경된 문서만 다시 분석하며 직접 구현한 Web Worker 배치와 Canvas 렌더링으로 화면 스레드의 부담을 줄인다. 그래프 진입점은 Docs 루트 문서 홈 위에만 표시한다.

- 문서/파일 토글은 탐색기 맨 위의 독립 행에서 전체 너비를 채우며, 두 버튼이 너비를 나눠 사용한다. 목록과 겹치지 않고 키보드 전환을 유지한다. 에이전트 패널 + 탭의 런타임/에이전트셋 토글과 같은 모양·색상을 사용한다. 기본 surface 배경과 둥근 사각형 안에 선택 항목만 raised 배경·기본 글자색으로 표시하며, 미선택 항목은 muted 글자색을 사용한다.
- 파일 보기에는 연결된 문서 폴더 이름의 진입점을 표시한다. 클릭하면 폴더를 펼치지 않고 문서 보기로 전환하며 새 파일 목적지도 문서 루트로 바꾼다.
- Documents 트리와 에디터 탭은 실제 파일명 대신 `document-pages` → `Document Pages`, `api-reference` → `API Reference` 같은 자연어 표시명을 사용한다. 저장 경로와 링크 대상은 기존 소문자 케밥 케이스를 유지한다.

- Documents는 일반 파일 트리에 중첩하지 않고 독립 목록으로 표시한다. 펼침·스크롤과 새 파일 목적지는 보기별로 유지하며 owner의 문서 토글 우클릭으로 기존 폴더 설정을 연다. [ADR 0190](../../../../.mew/docs/decisions/0190-mew-explorer-top-toggle-and-docs-entry.md)을 따른다.

- `useTabs`는 Documents 파일을 원래 API 스코프와 상대경로를 포함한 탭 식별자로 구분해 일반 파일과 함께 관리한다. 저장·협업·댓글·첨부·문서 DB는 각 파일의 기존 스코프를 유지한다.
- 기존 Documents·일반 파일의 저장된 탭은 한 번 합치며, 같은 이름의 파일과 편집 칸 ID를 보존한다. 통합 후 닫은 탭을 옛 Documents 저장분에서 다시 복원하지 않는다.

- Docs 상단은 새 문서만 제공하고 각 문서의 +에서 하위를 만든다. 일반 파일 보기는 새 파일·새 폴더를 유지한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 2026-10-04: Documents 대표 문서들을 상위 페이지 홈처럼 보이도록 정리하고, 트리·탭 표시명 변환을 추가했다. `MEW_DATA_DIR="${TMPDIR:-/tmp}/mew-test-data" node --test server/document-pages.test.ts server/document-pages-ui.test.ts`, `npm run lint`, `npx tsc -b`, `python3 ../.mew/docs/.github/scripts/check_doc_links.py --workspace`를 통과했다. `python3 ../.mew/docs/.github/scripts/check_repo_docs.py`는 종료 코드 0이었지만 이번 변경과 무관한 `todo/docs/*` 배치 경고를 출력했다. 전체 `npm test -- --runTestsByPath ...`는 스크립트가 전체 패턴을 함께 실행해 관련 없는 에이전트 UI 시간초과·환경 실패가 섞여 중단했다.

- 2026-10-03: 상위·하위 저장 전환, 이동·복사·개명·링크 보정, 충돌·쓰기 실패 복원과 실제 API 권한 테스트를 통과했다. 실제 FileTree·useTabs에서 대표 숨김·화살표 분리·현재 탭 교체·Ctrl/Cmd 탭, 편집 직후 이동 및 구조 변경 중 입력의 보존·새 경로 자동저장을 확인했다. 기존 App 전환·생성·탭 위치 표시·터치·통합 편집기 회귀를 확인했다. TypeScript·대상 lint·문서 링크 검사를 통과했으며 빌드·재시작은 수행하지 않았다.

- 2026-10-02: 그래프 링크 분석·권한·변경/삭제·루트 교체·배치 엔진 테스트, 실제 API 권한 검사와 실제 Worker/Canvas 데스크톱·모바일 UI 테스트를 통과했다. 검색·문서 열기·줌·노드 드래그·화면 이동·핀치·오류/빈 상태·권한 변경·Esc 포커스 복원을 확인했다. Docs 루트 버튼의 MOC 앞 배치와 파일 보기 숨김도 확인했다. TypeScript·대상 lint·문서 링크 검사를 통과했으며 빌드·재시작은 수행하지 않았다.

- 2026-10-02: `workspace-switch-ui.test.ts`에서 문서 폴더 진입점의 보기 전환, 기존 키보드 전환·상태 복원과 모바일 상단 전체 너비 배치를 확인했다. 데스크톱 다크·모바일 라이트 캡처, TypeScript·대상 lint를 확인했다. 빌드·재시작은 수행하지 않았다.

- 2026-09-29: 실제 App을 사용하는 `workspace-switch-ui.test.ts`에서 문서/파일 단독 표시, 방향키·Home 전환, 현재 보기의 새 파일 입력, 파일 탭 선택 시 보기 전환, 프로젝트 복원·모바일 하단 배치를 확인했다. 펼침/스크롤·생성 회귀와 저장 형식·번역 테스트, TypeScript·대상 lint·문서 검사를 통과했다. 데스크톱 다크·모바일 라이트 캡처를 확인했으며 빌드·재시작은 수행하지 않았다.

- 그래프 보기 버튼이 Docs 루트에만 한 번 표시되고 문서 홈보다 앞서는지, 검색·선택·문서 열기가 기존 에디터와 연결되는지 확인한다. 읽을 수 없는 문서와 그 연결은 권한 변경 후에도 표시되지 않아야 한다.

- 같은 이름의 Documents·일반 파일이 탭바에 함께 표시되고 각각 올바른 본문을 열고 저장하는지 확인한다. 패널 이동 뒤 파일 전환·새로고침에도 탭과 배치를 유지해야 한다.
- 2026-09-29: `editor-files.test.ts`·`unified-editor-ui.test.ts`·`workspace-switch-ui.test.ts`에서 동명 파일의 탭·저장 분리, 기존 탭 통합, 패널 이동 후 위치 유지, 새로고침·루트 전환 복원을 확인했다. 편집기·보기 전환·사이드바 회귀를 포함해 10개 테스트가 통과했다.

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - Documents에 연결한 실제 경로와 MOC가 맞고 파일 보기의 진입점으로 문서 보기에 전환되는지 확인한다.

<!-- mew:validation:end -->

2026-10-04 자연어 파일명의 대소문자·공백 표시를 보존하고, 이름 변경 시 괄호를 포함한 경로를 안전한 Markdown 링크로 인코딩한다. 공용 지도 검사는 `_폴더이름.md` 대표 문서와 인코딩·공백 경로를 인식한다.
