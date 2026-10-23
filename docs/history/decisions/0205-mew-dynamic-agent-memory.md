---
provenance: "Liiiiv 중앙 ADR 이관본, 2026-10-14"
description: "이관한 결정 기록: 가용 메모리에 따른 에이전트 합산 예산. 당시 선택·근거·후속 변경을 보존하며 현재 계약은 Mew 소유 문서에서 확인한다."
title: "0205 — 가용 메모리에 따른 에이전트 합산 예산"
created: 2026-10-09
updated: 2026-10-09
---

- 상태: 채택
- 부분 대체: [0164](0164-mew-agent-memory-protection.md)의 고정 설치 비율과 MemoryHigh 속도 제한
- 결정자: 송상훈 (WSL 메모리 변화에 따른 동적 가용 메모리 90% 제한 지시), Codex (구현)

## 결정

Linux MemTotal·MemAvailable과 에이전트 slice의 회수 불가능 사용량을 반복 측정한다. 이미 에이전트가 사용하는 메모리를 가용 풀에 더하고 호스트 총량으로 제한한 뒤 90%를 합산 MemoryMax로 적용한다. MemoryHigh는 infinity로 두어 초기화가 조용히 멈추는 속도 제한을 제거한다. 다른 앱 부하와 WSL 총량 변화도 다음 측정에 반영한다.

현재 사용량 이하로 MemoryMax를 내리지 않는다. 예산 부족은 기존 작업 취소·보류로 처리하고 사용량이 줄어든 다음 OS 상한을 낮춘다. 회복 후 자동 이어가기·큐 재개는 [0192](0192-mew-agent-memory-auto-resume.md)를 유지한다. scope·감독 경계와 swap 제한은 유지한다. 현재 계약과 적용 절차는 [운영 문서](../../operations/agent-memory.md)에 둔다.
