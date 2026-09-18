---
id: "mew-editor-media"
parent: "mew-editor"
title: "미디어·시트 미리보기"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "bdb38320bd1b155b6c70730984096658dfbe53317f093e520d9f2717b842fa1d"
files: ["src/components/MediaViewer.tsx", "src/components/SheetViewer.tsx", "src/components/DownloadLink.tsx"]
commits: []
---

## 요구사항

이미지·음성·영상·스프레드시트를 파일 형식에 맞게 본다.

### 범위

- 이미지·오디오·영상, SVG 이미지/텍스트 전환, XLSX·CSV·TSV 보기를 제공한다.
- 직접 편집하지 않는 APK·AAB 등은 다운로드 경로를 제공한다.

### 경계와 제한

시트 보기는 완전한 스프레드시트 편집기를 뜻하지 않는다. PDF 읽기·필기는 별도 하위 기능이다.

### 상세 계약

[편집 사용법](../../guides/editor.md)

상위: [분야 지도](MOC.md) · [상위 기능](../editor.md).

<!-- mew:implementation:start -->
## 구현 내용

이미지·오디오·영상, SVG 이미지/텍스트 전환, XLSX·CSV·TSV 보기를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 지원 형식별 뷰어·다운로드가 열리고 원본이 뜻하지 않게 변경되지 않는지 확인한다.

<!-- mew:validation:end -->
