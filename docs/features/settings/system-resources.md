---
id: "mew-settings-system-resources"
parent: "mew-settings"
title: "시스템 자원·프로세스 보기"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-28"
status_hash: "20544b07271a698d27b55dfdbbdbc97abb3472a36115cbbbcdffed7759ae2d9f"
files: ["src/components/SystemStatsModal.tsx", "server/sysStats.ts"]
commits: []
---

## 요구사항

- 서버의 현재 자원 사용량과 프로세스를 확인한다.

### 범위

- CPU·메모리·GPU·온도·프로세스와 팝업을 연 동안의 최근 추이를 표시한다.

### 경계와 제한

- OS·도구가 제공하지 않는 측정치는 비어 있거나 지원하지 않음으로 표시한다.
- 최근 추이는 서버의 장기 모니터링 이력이 아니다.

### 상세 계약

- [명령·예약 작업](../../guides/commands.md)

- 상위: [분야 지도](MOC.md) · [상위 기능](../settings.md).

<!-- mew:implementation:start -->
## 구현 내용

- CPU·메모리·GPU·온도·프로세스와 팝업을 연 동안의 최근 추이를 표시한다.
- 제목 줄 오른쪽의 X 버튼으로 팝업을 닫는다. 로딩·오류 상태에서도 표시하며 번역된 접근성 이름과 키보드 포커스 표시를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

- 아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다:
  - 지원 환경별 측정치·미지원 표시와 팝업을 닫은 뒤 추이 초기화를 확인한다.
  - 데스크톱·모바일에서 오른쪽 위 X 버튼이 보이고 클릭·터치·키보드로 팝업을 닫을 수 있는지 확인한다.

<!-- mew:validation:end -->
