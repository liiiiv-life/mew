---
name: korean-technical-docs
description: "한국어를 원문 또는 번역 대상으로 삼는 기술 문서 작업을 연결한다. 설치된 documentation으로 구조를 설계하고 korean-writing-reviewer로 문장을 교정한다. 요청된 번역은 translating-core·문서 보호·대상 언어 전문 스킬과 reviewing-translations를 순서대로 적용한다."
---

# 한국어 기술 문서화 연결

이 스킬은 단계와 언어를 선택하는 진입점이다. 문장 교정과 번역은 포함된 기존 전문 스킬의 원문을 읽고 수행한다.

1. [공통 흐름](../technical-docs-common/workflow.md)으로 원문 언어·요청 범위·독자를 정한다. 새 문서의 기본 원문 언어는 mew의 실제 응답 언어를 따른다. 명시적인 문서 언어와 기존 프로젝트·파일 규칙을 우선한다.
2. 원문 구조 설계에서는 [documentation](../.vendor/documentation/SKILL.md)을 읽는다. 내부 명세·개발 계약은 프로젝트 형식을 유지한다.
3. 한국어 원문은 [korean-writing-reviewer](../.vendor/korean-writing-reviewer/SKILL.md)의 기술 문서 프로필로 교정한다. 수정 요청은 점수 없이 `improve`, 검토 요청은 `review`를 사용한다. 원문·조건·코드·링크를 대조한 뒤 원문을 확정한다.
4. 요청된 번역은 [번역 연결 순서](../technical-docs-common/translation.md)를 따른다. 한국어가 대상이면 `translating-korean` 후 `korean-writing-reviewer`로 표현을 다듬고, 마지막에 `reviewing-translations`로 확정 원문과 대조한다.

한국어가 원문이 아니면 해당 원문 언어의 진입점부터 사용한다. 전문 스킬을 읽지 않고 요약된 규칙만으로 대신하지 않는다. 공통 참조는 SKILL.md의 실제 위치에서 찾는다.
