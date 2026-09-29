---
id: "mew-editor-references"
parent: "mew-editor"
title: "링크·파일 참조·첨부"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-25"
status_hash: "7de6eaf2f2c15edc7c1f36bdcbbfd8639072863ca76586cd4dcc07f7c56c6cc2"
files: ["packages/editor/src/editor/LinkTooltip.tsx", "packages/editor/src/editor/file-link.ts", "packages/editor/src/editor/editor.css", "packages/editor/src/ResizableImage.tsx", "packages/editor/src/MediaNodes.ts", "src/components/EditorPane.tsx"]
commits: []
---

## 요구사항

- 문서에 링크·프로젝트 파일·이미지와 첨부를 연결한다.

### 범위

- 링크 삽입·수정, 파일 멘션, 파일 업로드·드롭·이미지 붙여넣기와 크기 조절을 제공한다.
- 내부 파일 링크는 아이콘과 컨테이너를 갖춘 블록 아이템으로 구분하고, 외부 링크는 밑줄 하이퍼링크로 유지한다.
- 선택한 파일 경로·줄 범위를 Ctrl+L로 대상 입력창에 전달한다.

### 경계와 제한

- YouTube 노드 삽입과 실제 재생 허용은 다르며 배포 CSP 제한이 남아 있다.
- 첨부 열람은 첨부 자체의 파일 권한도 필요하다.

### 상세 계약

- [편집 사용법](../../guides/editor.md) · [첨부 권한](../../development/access-control.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../editor.md).

<!-- mew:implementation:start -->
## 구현 내용

- 링크 삽입·수정, 파일 멘션, 파일 업로드·드롭·이미지 붙여넣기와 크기 조절을 제공한다.
- 내부 파일 링크는 인라인 코드처럼 본문 줄 높이를 유지하고 문장 흐름 안에서 줄바꿈한다. Hotview 표시만 바꾸며 기존 Markdown 형식과 링크 조작을 유지한다.
- 내부 링크 뒤에 2px 바깥 여백을 둔다. 줄바꿈된 링크는 전체 시작·끝에만 좌우 테두리와 둥근 모서리를 표시하고, 줄이 이어지는 중간 경계는 열어 둔다.
- 상세 표시는 [편집 사용법](../../guides/editor.md#링크와-첨부)을 따른다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 참조가 올바른 파일·줄로 열리고 이미지 조절·첨부 저장과 권한 차단이 유지되는지 확인한다.
- 내부 파일 링크의 컨테이너·긴 이름 줄바꿈·밝은/어두운 테마를 확인하고, 외부 링크의 밑줄과 Markdown 왕복 저장·링크 수정 동작이 유지되는지 확인한다.

<!-- mew:validation:end -->
