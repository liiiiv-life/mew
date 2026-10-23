---
title: "mew 문서 탐색 진입점"
description: "AI가 Mew 자체의 지침·문서 규칙을 읽고 description 목록에서 필요한 현재 문서와 로컬 결정을 고르는 실행 순서."
created: "2026-10-06"
updated: "2026-10-22"
---

프로젝트 [README](../README.md)와 [AGENTS](../AGENTS.md), [문서 규칙](README.md), [실행·검증 규칙](development/getting-started.md)을 읽는다. Mew 자체의 지침이 기준이며 부모 워크스페이스 문서의 탐색·갱신은 요구하지 않는다.

저장소 루트에서 `node server/document-descriptions.ts`로 문서 경로와 description을 확인한 뒤 관련 본문만 선택한다. 현재 결정은 `decisions/`, 과거 근거는 필요할 때만 `history/`에서 확인한다. MOC 탐색·등록 의무는 없다. 코드·기능·운영을 바꾸면 해당 소유 문서와 description을 같은 작업에서 갱신하고 `npm run check:docs`로 검사한다.
