---
title: "Documents 링크 그래프 엔진"
created: 2026-10-02
updated: 2026-10-03
description: "Documents의 Markdown 링크 그래프 API와 문서 선택·열기, 권한 필터·파일 제한·분석 캐시 및 검증 계약을 정의한다."
---

# Documents 링크 그래프

상위: [개발 계약](MOC.md) · [Documents 기능](../features/%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%C2%B7%ED%8C%8C%EC%9D%BC%C2%B7%EA%B2%80%EC%83%89/Documents%C2%B7%EB%AC%B8%EC%84%9C%20%EC%A7%80%EB%8F%84%20%EA%B4%80%EB%A6%AC.md).

## 범위와 API

Docs 루트의 **그래프 보기**는 **문서 홈**보다 위에 한 번만 표시한다. 하위 폴더와 일반 파일 보기에는 표시하지 않는다. 그래프는 현재 연결된 Documents 안의 `.md` 문서를 대상으로 하며 링크가 없는 문서도 포함한다. 문서 선택은 연결을 강조하고, 더블클릭 또는 **문서 열기**는 기존 Docs 스코프의 에디터 탭으로 연다. 검색·목록으로도 문서를 선택하거나 열 수 있다. [상위·하위 문서](document-pages.md)의 대표 파일도 본문 문서로 분석한다. 포함 관계는 디스크 계층이며 실제 본문 하이퍼링크가 있을 때만 그래프 간선을 만든다.

`GET /api/docs/graph`는 `filesRead`와 요청자의 파일 열람 권한을 적용해 `{ nodes, edges, skipped }`를 반환한다. 노드는 `{ path, title, group }`, 방향 있는 간선은 응답 노드의 인덱스 `[source, target]`다. 숨김·차단 파일과 읽을 수 없는 노드·제목·간선을 반환하지 않는다. 그래프 응답은 `no-store`이며 권한 변경 시 클라이언트 그래프를 즉시 비우고 다시 요청한다. 분석 중 Documents 루트가 바뀌면 409로 재요청을 유도한다.

Markdown 인라인·참조형 링크를 Markdown 파서로 읽는다. 상대경로, Docs 루트 기준 `/path`, URI 인코딩과 문서 뒤의 fragment/query를 처리하며 확장자를 생략하면 `.md`를 확인한다. `[[문서#제목|표시명]]`은 현재 폴더·Docs 루트·유일한 파일명 순으로 해석한다. 같은 파일명이 여러 곳에 있어 모호하면 추측하지 않는다. 외부 URL·이미지·코드·frontmatter·자기 문서·없는 대상·Docs 밖 경로는 연결에서 제외하며 같은 방향의 중복 링크는 하나로 합친다. HTML 링크와 문서 밖의 파일은 대상이 아니다.

파일별 8 MiB를 넘거나 읽기 오류가 발생하면 해당 문서를 제외하고 `skipped`로 알린다. 심볼릭 링크의 실제 경로도 Docs 루트 안인지 확인한다. 전체 문서 본문을 API나 브라우저에 전달하지 않는다.

## 처리·성능 계약

- `server/document-graph.ts`는 기존 파일 카탈로그를 사용하며 최대 12개 파일 I/O를 병렬 처리한다. 활성 Docs 루트 하나의 링크·제목만 메모리에 캐시하며 mtime·ctime·크기와 카탈로그 변경 신호로 변경된 문서만 다시 파싱한다. 삭제된 항목과 루트 전환 시 낡은 캐시를 제거한다.
- `src/utils/document-graph-layout.ts`는 직접 구현한 결정적 힘 기반 배치다. 사분 트리의 Barnes–Hut 반발력은 평균 `O(n log n)`, 간선 스프링은 `O(e)`다. 동일 위치의 노드와 빈 그래프를 처리하고, 감쇠 뒤에는 계산을 멈춘다.
- `document-graph-worker.ts`는 짧은 작업 묶음으로 배치를 계산한다. Float32 좌표를 transferable buffer로 전달하고 노드 드래그 때만 다시 가열한다. 그래프를 닫거나 새 데이터로 교체하면 Worker를 종료한다.
- `document-graph-canvas.ts`는 Canvas 하나로 간선·노드를 그린다. 그리기는 `requestAnimationFrame`으로 병합하고 DPR은 2로 제한한다. 공간 그리드로 포인터의 가까운 노드를 찾고 화면 밖 요소와 겹치는 라벨을 줄인다. 라벨은 최대 65개이며 선택한 노드와 이웃을 우선한다.
- 휠·버튼·두 손가락으로 확대하고 빈 영역 드래그로 이동한다. 노드를 드래그하면 그 위치를 잠시 고정한다. 키보드 방향키는 이동, +/-는 확대·축소, Home은 전체 보기, Enter는 선택 문서 열기다. 검색과 페이지 단위 목록은 Canvas를 사용할 수 없는 환경에서도 문서 접근을 제공한다.
- 그래프 화면은 기존 `DialogFrame`의 포커스 복원·Esc/뒤로가기 닫기를 사용한다. 검색·새로고침·문서 목록·크기/읽기 오류 및 Worker 실패 상태를 제공하며 데스크톱과 모바일의 기존 테마를 따른다.

## 검증

링크 파싱·경로 경계·중복/모호한 링크·권한 projection·파일 변경/삭제·루트 교체는 `server/document-graph.test.ts`, 실제 API 권한 적용은 `server/document-graph-access.test.ts`에서 확인한다. 배치의 수렴·겹친 좌표·드래그 고정·대규모 계산은 `src/utils/document-graph-layout.test.ts`에서 검증한다. 실제 Worker/Canvas의 데스크톱·모바일 동작은 `server/document-graph-ui.test.ts`, Docs 루트 버튼 배치는 `server/workspace-switch-ui.test.ts`에서 확인한다.

2026-10-02 합성 자료 3,000개 노드·2,999개 간선의 배치 20회는 약 90ms, 마지막 단계는 256,122개 셀 방문이었다(전체 쌍 비교 9,000,000개). 이는 이 개발 환경에서 배치 엔진만 측정한 값이며 초기 문서 읽기·네트워크·그리기 시간은 포함하지 않는다.
