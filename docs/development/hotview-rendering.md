---
title: "Hotview 입력·블록 렌더링 계약"
description: "Hotview의 블록별 Markdown 직렬화·줄 번호 캐시, Pretext 높이 예측과 화면 밖 DOM 자리표시자, 파일 링크 경계 입력과 선택·협업·탐색·글꼴 변경의 보존 범위 및 검증 방법을 정의한다."
created: 2026-10-19
updated: 2026-10-19
---

# Hotview 입력·블록 렌더링 계약

Hotview는 전체 ProseMirror 문서와 기존 Markdown 저장 형식을 유지하면서 변경한 블록의 계산과 화면에 표시할 DOM을 분리한다. [도입 결정](../decisions/0016-hotview-pretext-windowing.md)과 [도입 전 측정](../research/editor-input-performance.md)을 근거로 한다. 성능 비교와 검증 결과는 [도입 후 측정](../research/hotview-pretext-performance.md)에 둔다.

## 입력과 직렬화

[IncrementalMarkdown](../../packages/editor/src/editor/incrementalMarkdown.ts)은 `tiptap-markdown` 초기화 다음에 설치한다. 기존 노드·마크 렌더러와 상태 생성자를 사용하며, 비공개 패키지 경로를 import하거나 Markdown 규칙을 별도로 복제하지 않는다.

- ProseMirror의 변경되지 않은 최상위 노드와 블록 경계 상태를 캐시한다. 문단 하나를 수정하면 해당 블록과 경계가 바뀐 이웃만 다시 직렬화한다. 노드당 경계 변형은 최대 8개다.
- 완성한 문서 문자열은 최근 문서 하나만 보관한다. 같은 문서를 여러 번 조회할 때 전체 출력을 다시 만들지 않는다.
- 인접 목록의 구분, 빈 문단과 마지막 줄바꿈, 코드·표·HTML 저장 형식을 유지한다. 앞선 출력까지 수정하는 커스텀 렌더러는 기존 전체 직렬화로 되돌아간다.
- 클립보드의 `Fragment`는 기존 직렬화 경로를 유지한다. 선택 줄 범위를 요청할 때는 완성한 앞 블록을 재사용하고 해당 블록의 접두어만 렌더링한다.
- `onUpdate`의 저장 통지는 계속 동기적으로 전달한다. 저장을 지연하거나 입력 일부를 버리는 방식으로 지연을 숨기지 않는다. React가 방금 내보낸 본문을 돌려줄 때 재직렬화를 생략한다. 링크 양옆의 브라우저 커서를 맞추는 가벼운 transaction은 유지하며, 이때 줄 번호·본문 분석은 캐시를 재사용한다.
- [파일 링크 경계](../../packages/editor/src/editor/file-link.ts)의 커서 위젯 안에서 발생하는 취소 가능한 비조합 `insertText`는 `beforeinput`에서 모델 transaction으로 반영한다. ProseMirror가 무시하는 위젯 DOM에만 글자가 남는 입력 손실을 막고, 위젯의 제로폭 문자를 원문에 넣지 않는다. 조합 중이거나 읽기 전용인 입력에는 이 처리를 적용하지 않는다.

[LineFocus](../../packages/editor/src/editor/lineFocus.ts)는 줄 번호를 plugin state에 저장한다. 처음 읽은 원문은 Markdown line map으로 간격·주석·빈 줄을 반영하고, 편집 후에는 캐시된 블록의 원문 기여분으로 번호를 갱신한다. 커서 이동과 viewport 갱신은 번호 분석을 다시 수행하지 않는다. 외부 본문 교체는 모델이나 저장 문자열이 같아도 명시적인 `source` 메타데이터로 원문 매핑을 초기화한다. 로컬 echo와 속성 행 수 변경에는 `offset` 메타데이터를 전달해 기존 본문 캐시를 재사용한다.

## Pretext와 DOM 표시 범위

[VirtualBlocks](../../packages/editor/src/editor/virtualBlocks.ts)는 최상위 블록이 120개 이상이면 화면 높이와 위아래 700px 여유 범위를 사용한다. 처음 EditorView를 생성할 때부터 화면 밖 블록의 편집 DOM을 생성하지 않는다.

화면 밖 블록은 `contentDOM` 없는 높이 자리표시자다. 모델을 잘라내거나 Yjs 문서에서 노드를 제거하지 않는다. 각 최상위 블록의 자리표시자 하나는 남으므로 전체 DOM 개수가 문서 길이와 완전히 무관해지는 구조는 아니다.

[Pretext 1.0.0](https://github.com/chenglou/pretext)의 `prepare`·`layout`과 rich inline API로 문단·제목의 높이를 예측한다. 준비 결과는 노드와 글꼴·자간·줄바꿈 설정에 연결하고, 너비 변경에는 준비 결과를 재사용한다. 코드·링크 등의 인라인 차이를 반영하되 표·미디어·복잡한 블록의 최초 높이는 추정치다. 표시 후 실제 높이와 margin을 측정해 보정한다.

스크롤과 resize 처리는 프레임 단위로 합친다. 실제 높이를 측정하고 첫 가시 블록을 기준으로 위치를 보정해 스크롤 점프를 줄인다. 글꼴 로드·너비·테마 변경은 높이 캐시를 갱신한다. 노드마다 문서 시작부터 위치를 재탐색하지 않으며, 줄 번호와 파일 링크 커서의 ProseMirror 장식도 표시 범위로 제한한다. 같은 노드 객체를 공유하는 드래그 복사본도 DOM·유지 범위는 문서 위치별로 구분한다.

## 편집·탐색 보존

- 커서가 있는 블록과 선택 범위 전체는 계속 마운트한다. 긴 범위 선택이나 전체 선택은 복사·브라우저 선택의 정확성을 위해 많은 DOM을 만들 수 있다.
- DB 셀·제목 등 별도 입력창에 포커스가 있으면 해당 블록도 유지해 저장 전 초안을 보존한다. 재생 중인 HTML 오디오·영상도 유지하며, 포커스·재생이 끝나면 표시 범위를 다시 계산한다.
- IME 조합 중인 위치는 transaction mapping으로 추적하고 조합이 끝날 때까지 유지한다. 실제 OS 한글 키보드의 전체 조합 동작은 실기 확인 대상이다.
- 표시하는 블록은 기존 코드·표·이미지·미디어 노드뷰를 사용한다. 숨길 때 기존 뷰를 정리하고 다시 표시하면 생성한다. 일시정지된 영상·오디오의 재생 위치와 포커스 없는 iframe 내부 상태는 보존하지 않는다.
- 목차·검색·Plain에서 Hotview로 돌아오는 원문 줄 탐색은 DOM 전체 검색에 의존하지 않는다. 모델 위치를 찾고 `materializeVirtualPosition`으로 대상 블록을 만든 뒤 좌표를 조회한다.
- undo·redo와 Yjs 협업은 전체 문서를 대상으로 한다. 표시 범위 변경 transaction은 저장·실행 취소 이력에 넣지 않는다.
- 편집기를 닫으면 RAF·scroll/resize·글꼴·테마·composition·포커스·재생 관찰자를 정리한다.

최상위 블록 하나인 거대한 목록이나 표의 내부 항목·행은 별도로 가상화하지 않는다. 브라우저 자체의 페이지 찾기는 마운트한 텍스트만 볼 수 있으므로 문서 전체 찾기는 Mew의 문서 검색을 사용한다. 화면 밖 텍스트는 접근성 트리에도 상주하지 않는다.

## 검증

검증은 앱을 빌드하거나 서버를 시작하지 않는 격리 fixture에서 수행한다.

```bash
node --test packages/editor/src/editor/incrementalMarkdown.test.ts packages/editor/src/editor/lineFocus.test.ts packages/editor/src/editor/virtualBlocks.test.ts
node --test server/editor-virtual-blocks-ui.test.ts
MEW_BENCH_SAMPLES=20 node server/editor-performance-benchmark.mjs
```

단위 검사는 기존 native serializer와의 완전 일치, 변경 블록 재계산, 줄 번호 보존, 표시 범위와 선택·IME·포커스·재생 위치·정리, 동일 노드 객체 복사본의 위치 구분을 확인한다. UI 검사는 데스크톱·모바일과 로컬·Yjs 편집에서 숨긴 블록의 입력·undo·복사·목차·검색·원문 줄 탐색·표·이미지 노드뷰 복원과 DB 제목 초안의 스크롤 중 보존·blur 저장을 확인한다. 성능 수치는 합성 Markdown의 ASCII 입력 기준이며 현장 INP나 모바일 실기 성능을 보장하지 않는다.
