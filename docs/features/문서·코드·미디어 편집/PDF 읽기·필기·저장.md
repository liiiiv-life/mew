---
id: "mew-editor-pdf"
parent: "mew-editor"
title: "PDF 읽기·필기·저장"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "b749b40de63eb8c6d48b59612004c55dac7bc042f3883af412cbf26f08966f92"
files: ["src/components/pdf-viewer.tsx", "src/components/pdf-page.tsx", "server/pdf.ts"]
commits: []
---

## 요구사항

- PDF를 읽고 펜·형광펜 주석을 남겨 저장한다.

### 범위

- 전체화면·페이지 이동·확대·텍스트 선택과 플로팅 도구를 제공한다.
- 펜·형광펜 필기를 원본 PDF에 저장하거나 사본으로 다운로드한다.

### 경계와 제한

- PDF 접근·저장은 대상 파일 권한을 따른다.
- 지원 주석·렌더링·실기기 제약은 PDF 개발 계약을 따른다.

### 상세 계약

- [편집 사용법](../../guides/editor.md) · [PDF 개발 계약](../../development/pdf-viewer.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](_%EB%AC%B8%EC%84%9C%C2%B7%EC%BD%94%EB%93%9C%C2%B7%EB%AF%B8%EB%94%94%EC%96%B4%20%ED%8E%B8%EC%A7%91.md).

<!-- mew:implementation:start -->
## 구현 내용

- 확대 비율·펜 굵기는 자체 드롭다운이며 PDF 전체화면·모바일 대체 전체화면에서도 선택·우선 닫기를 유지한다.

- 전체화면·페이지 이동·확대·텍스트 선택과 플로팅 도구를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 데스크톱·모바일에서 페이지·확대·필기 위치와 저장 사본 재열기를 확인한다.

<!-- mew:validation:end -->
