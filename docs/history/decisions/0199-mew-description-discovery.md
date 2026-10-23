---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
title: "0199 — mew 문서 description 기반 탐색"
description: "mew의 문서 탐색을 프론트매터 description으로 전환하고 MOC 수동 등록 의무를 제거한 결정."
created: 2026-10-06
updated: 2026-10-06
---

- 상태: 채택
- 결정자: 사용자 지시
- 부분 대체: [0132](0132-docs-project-owned-documentation.md) — mew 프로젝트의 MOC 탐색·문서 등록 의무
- 부분 대체: [0155](0155-mew-project-agent-context.md) — 자동 안내·신규 문서 초기화의 MOC 기본 경로

## 결정

mew의 모든 docs Markdown은 대상과 범위를 구별하는 `description` 프론트매터를 가진다. AI는 경로와 description을 먼저 읽고 관련 current 본문만 선택한다. 제목만 있는 새 태스크에는 제목 기반 기본 설명을 자동 작성하며, 상세 본문 작성 시 설명도 구체화한다. description은 탐색 힌트이며 사실의 기준본은 본문이다.

새 문서마다 MOC를 수동 등록하는 의무를 없앤다. 기존 MOC는 화면 대표·기존 링크 호환을 위해 보존하며, Documents의 파일 이동 시 실제 링크 보정은 유지한다. 소유권·동일 작업 write-back·중앙 ADR·archives 불변 원칙은 바꾸지 않는다. history는 기본 검색에서 제외한다.

성능은 [실측](../../research/desc-moc-benchmark.md)에서 시간 차이가 작았으며, 선택 이유는 문서 추가와 탐색 목록 관리의 중복 작업을 없애는 것이다. 다른 프로젝트의 기존 지침은 자동 덮어쓰지 않는다.

세부 규칙: [mew 문서 규칙](../../README.md).
