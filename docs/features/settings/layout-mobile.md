---
id: "mew-settings-layout-mobile"
parent: "mew-settings"
title: "패널 배치·모바일·상태 복원"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-22"
status_hash: "018bca32e486b43c386b29de3e2087d6d1447fae6a33abc99d745367947a9382"
files: ["src/App.tsx", "src/hooks/useTabs.ts", "server/userUiState.ts"]
commits: []
---

## 요구사항

화면 크기와 작업 흐름에 맞춰 문서·도구 패널을 배치한다.

### 범위

- 문서 탭·분할·도킹·크기 조절·계정별 복원과 모바일 플로팅 핸들·전체화면·뒤로가기를 제공한다.

### 경계와 제한

브라우저 패널은 좌우 배치만 지원한다. 패널 닫기와 작업 세션 종료를 구분하며 기기별 설정과 계정별 화면 상태의 소유권을 유지한다.

### 상세 계약

[편집 칸·모바일](../../guides/editor.md) · [패널·오버레이 계약](../../development/ui-contracts.md)

상위: [분야 지도](MOC.md) · [상위 기능](../settings.md).

<!-- mew:implementation:start -->
## 구현 내용

문서 탭·분할·도킹·크기 조절·계정별 복원과 모바일 플로팅 핸들·전체화면·뒤로가기를 제공한다.

모바일 화면 왼쪽 가운데에 사이드바 열기 버튼을 제공한다. 본문을 덜 가리도록 외형과 아이콘을 작게 표시하고, 투명 여백으로 터치 영역을 확보한다. 기존 패널 전면 스택을 사용하고, 사이드바가 전면이면 숨긴다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 데스크톱 분할·모바일 전환·닫기·재열기 뒤 탭과 실행 중 작업이 올바르게 유지되는지 확인한다.

<!-- mew:validation:end -->
