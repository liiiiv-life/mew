---
id: "mew-settings-appearance"
parent: "mew-settings"
title: "화면·언어·글꼴·단축키 설정"
status: "implemented"
created: "2026-09-18"
updated: "2026-09-18"
status_hash: "4f239b57ff4cc09aac87a665e96e137692355fb592ecb3c0965c8ea2b7ff2181"
files: ["src/components/SettingsModal.tsx", "src/i18n.tsx", "src/index.css"]
commits: []
---

## 요구사항

기기에서 쓰기 편한 외형과 키 조합을 설정한다.

### 범위

- 밝은/어두운 테마·언어·강조색·글꼴과 변경 가능한 단축키 설정·초기화를 제공한다.

### 경계와 제한

화면 설정은 브라우저별이다. 고정 편집 단축키는 바꿀 수 없고, 설치하지 않은 글꼴은 시스템 폴백을 사용한다.

### 상세 계약

[계정·화면 설정](../../configuration/environment.md) · [포커스 기반 단축키](../../development/ui-contracts.md)

상위: [분야 지도](MOC.md) · [상위 기능](../settings.md).

<!-- mew:implementation:start -->
## 구현 내용

밝은/어두운 테마·언어·강조색·글꼴과 변경 가능한 단축키 설정·초기화를 제공한다.

<!-- mew:implementation:end -->

<!-- mew:validation:start -->
## 검증

아래 항목은 이번 정리에서 실행한 테스트 결과가 아닌 사용자 확인 기준이다: 설정 재열기·초기화·포커스별 단축키가 맞고 다른 기기의 화면 설정을 덮어쓰지 않는지 확인한다.

<!-- mew:validation:end -->
