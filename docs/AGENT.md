---
title: "mew 문서 탐색 진입점"
description: "AI가 프로젝트 지침을 확인한 뒤 description 목록에서 필요한 current 문서만 고르는 실행 순서."
created: 2026-10-06
updated: 2026-10-06
---

프로젝트 [README](../README.md)와 [AGENTS](../AGENTS.md), [문서 규칙](README.md), [실행·검증 규칙](development/getting-started.md)을 읽는다. 저장소 루트에서 `node server/document-descriptions.ts`로 문서 경로와 description을 확인한 뒤 관련 본문만 선택한다. MOC를 탐색하거나 새 문서를 MOC에 등록할 의무는 없다. 코드·기능·운영을 바꾸면 해당 소유 문서와 description을 같은 작업에서 갱신한다. 과거 근거가 필요할 때만 history를 확인한다.
