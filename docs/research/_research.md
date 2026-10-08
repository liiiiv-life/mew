---
title: "연구와 성능 측정"
created: "2026-10-08"
updated: "2026-10-08"
description: "문서 탐색 비용·파일 탐색기 성능·원격 데스크톱 화질과 지연 연구의 하위파일을 연결한다. 이전 구현에 대한 측정은 History / raw로 구분한다."
상위파일: "../MOC.md"
---

비교·실측·연구 원문을 모았다. 측정 당시의 조건과 구현 범위는 각 문서에서 확인하며, 현재 계약은 [개발 문서](../development/MOC.md)를 따른다.

## 하위파일

### 문서 탐색과 현재 성능 연구

- [description·MOC 문서 탐색 비용 비교](desc-moc-benchmark.md)
- [파일 탐색기 펼침 성능 조사](explorer-expansion-performance.md)
- [원격 데스크톱 고화질과 144Hz 최적화](%EC%9B%90%EA%B2%A9%20%EB%8D%B0%EC%8A%A4%ED%81%AC%ED%86%B1%20%EA%B3%A0%ED%99%94%EC%A7%88%EA%B3%BC%20144Hz%20%EC%B5%9C%EC%A0%81%ED%99%94.md)

### History / raw

- [RAG·MOC·일반 파일 검색 비교](document-discovery-benchmark.md)
- [이전 Electron 원격 데스크톱 지연·대역폭 조사](remote-desktop-latency.md)
- [상주 호스트 전환 이전의 첫 화면 지연 조사·일부 후속 구현](remote-desktop-startup.md)
