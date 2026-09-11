---
title: "mew 사이드바 탐색·검색 구현 계획"
desc: "증분 카탈로그와 정확 검색 색인을 안전하게 구현하기 위한 파일 단위 실행 계획."
created: 2026-09-01
updated: 2026-09-11
reviewed: 2026-09-02
review-after-days: 30
---

이 문서는 [사이드바 탐색·정확 검색 성능 설계](sidebar-explorer-search-performance.md)를 실제 코드로 옮길
**구현 담당자용 실행 계획**이다. UI 계약은 [사이드바 파일 검색](../specs/file-search.md), 현재 지연 로드 계약은
[ADR 0088](../../../.mew/docs/decisions/0088-mew-sidebar-tree-lazy-loading.md)을 지킨다. 본문 파일은 SSoT이고 검색 자료구조는
`MEW_DATA_DIR` 아래의 삭제·재생성 가능한 파생 캐시다.

## 범위와 완료 정의

이번 작업은 다음 세 경로를 빠르게 만든다.

1. 사이드바의 루트 표시와 폴더 펼치기
2. Ctrl+P 파일명·경로 검색
3. Ctrl+Shift+F 리터럴 내용 검색

의미 검색(LanceDB), 편집기 본문 열기, 협업 방, 외부 검색 서비스는 범위 밖이다. 정규식 내용 검색은 결과의
정확성을 유지하는 fallback 경로로 남겨도 된다. 완료는 전체 트리·전체 파일 read가 평상시 요청 경로에서 사라지고,
아래 테스트·성능 기준을 만족하는 것이다.

## 구현 상태

2026-09-02에 구현과 자동 검증을 완료했다. [ADR 0105](../../../.mew/docs/decisions/0105-mew-incremental-file-catalog-and-exact-search-index.md)를
채택하고 계측, 메모리 `FileCatalog`, 영향 부모 watcher 갱신, watcher 누락 시 전체 reconcile, 서버 Ctrl+P,
versioned tree 부분 invalidation, Node 내장 SQLite FTS5, dirty 원문 fallback과 SSE batch를 적용했다. 파일 조작
API는 변경 부모를 즉시 catalog에 반영하고, 게스트에게는 경로 없는 tree 신호만 보낸다. 색인 손상·schema 변경·
삭제 복구, 0600 DB 권한, 다중 프로세스 write 경합도 검증했다.

구현은 이 계획의 PoC 폴더 분할 대신 응집된 `mew/server/searchCatalog.ts` 하나로 시작했고, 별도 worker thread 대신
비동기 파일 I/O·128개 transaction batch·`setImmediate` 양보를 사용했다. 기능 경계와 롤백 계약은 같다. 실제
브라우저 p50/p95 trace만 실행 중인 앱에 새 build를 반영한 뒤 별도로 측정한다. 이번 작업에서는 `mew/README.md`의
운영 계약에 따라 build·restart·배포를 실행하지 않았다.

## 저장소 결정

내용 색인 저장소는 ADR 0105가 다음처럼 확정했다.

- 현재 최소 런타임 Node 22.18+의 `node:sqlite`와 FTS5 trigram을 사용해
  `MEW_DATA_DIR/search/<workspace-hash>/catalog.sqlite`에 저장한다.
- 색인을 끄거나 구축·query가 실패하면 기존 scanner로 안전하게 fallback한다.
- 본문은 FTS 후보 생성용 파생 복사본이고 원문 파일이 SSoT다. schema 불일치는 자동 재구축한다.
- LanceDB RAG와 독립된 저장소를 쓴다.

## 현재 코드 지도

| 책임 | 현재 파일 | 구현 중 바뀌는 방향 |
| --- | --- | --- |
| 트리 순회·가시성·정렬 | `mew/server/tree.ts` | 정책 함수는 유지하고, 디스크 walk를 `FileCatalog` 초기 구축/증분 갱신으로 감싼다. |
| 변경 감시 | `mew/server/watcher.ts` | 전체 watcher 재순회·전체 JSON 비교 대신 영향 경로를 catalog에 넘긴다. |
| API | `mew/server/api.ts` | `/tree`, `/search/stream`은 catalog query를 사용하고 version·상태를 돌려준다. |
| 내용 scanner | `mew/server/search.ts` | 원문 검증·정규식 fallback만 남기고, 색인 candidate query와 합친다. |
| API client | `mew/src/api/client.ts` | tree envelope·파일명 검색 API·abort 가능한 검색을 타입화한다. |
| 화면 상태·범위 | `mew/src/App.tsx` | `fetchFullTree` 기반 Ctrl+P 후보 생성을 제거한다. |
| 트리 렌더 | `mew/src/components/FileTree.tsx` | 버전별 부모 캐시 무효화로 관련 열린 폴더만 다시 읽는다. |
| 검색 UI | `mew/src/components/SearchPanel.tsx` | 서버 파일명 검색, abort, stale/bulding 상태, 결과 batch를 처리한다. |
| 현재 보호 규칙 | `mew/server/guestAccess.ts`, `mew/server/ignoreList.ts`, `mew/server/paths.ts`, `mew/server/reqAuth.ts` | 색인에 복제하지 않고 결과 반환 직전에 반드시 재사용한다. |

`buildTreeAsync`, `listTreeDirAsync`, `flattenTextFiles`, `searchInProjectProgressively`의 기존 public export는
한 PR에서 지우지 않는다. 새 경로가 기존 테스트와 동등함을 확인한 뒤 내부 구현을 옮긴다.

## 공통 데이터 계약

### 서버 내부 타입

`mew/server/fileCatalog.ts`를 새로 만들고 다음 타입을 export한다. 실제 필드 이름은 바꿀 수 있지만 의미는 유지한다.

```ts
type CatalogNode = {
  path: string
  parent: string
  name: string
  type: 'file' | 'dir'
  project: boolean
  size: number | null
  mtimeMs: number | null
  indexedAtVersion: number
}

type CatalogSnapshot = {
  project: string
  version: number
  builtAt: number
  childrenByParent: ReadonlyMap<string, readonly CatalogNode[]>
  files: readonly CatalogNode[]
}

type CatalogChange =
  | { kind: 'upsert'; path: string }
  | { kind: 'remove'; path: string }
  | { kind: 'rescan-parent'; path: string }
  | { kind: 'rescan-project' }
```

- snapshot은 불변이다. 갱신 중인 Map을 HTTP 요청이 읽으면 안 된다.
- `version`은 실제로 보이는 경로 집합이나 자식 목록이 달라질 때만 증가한다.
- `CatalogNode`에 역할·guest 권한을 저장하지 않는다. 그 값은 사용자별이고 변경 가능하므로 응답 시 계산한다.
- `filtersFor`, `fileVisible`, `isPathVisible`은 `tree.ts`에서 export하거나 `treePolicy.ts`로 추출해 catalog,
  tree API, watcher, 검색이 한 정의를 공유한다. 이름·확장자 정책을 두 군데 복제하지 않는다.

### HTTP 계약

기존 `GET /api/tree`의 배열 응답은 호환성을 위해 유지한다. 새 클라이언트가 opt-in query `v=1`을 보낼 때만
envelope를 받는다. 기존 guest 재귀 응답도 배열을 유지한다.

```ts
type TreeResponseV1 = {
  version: number
  state: 'ready' | 'building' | 'stale'
  entries: TreeNode[]
}

type FileNameSearchResponse = {
  version: number
  state: 'ready' | 'building' | 'stale'
  results: Array<{ path: string; project: string; scope: FileSearchScope }>
}
```

- `GET /api/search/files?q=&scopes=&project=`을 새로 둔다. file-name 검색은 `/tree` 전체 응답을 사용하지 않는다.
- `GET /api/search/stream`은 현 SSE event 이름 `result`, `done`, `error`를 유지한다. `done`에
  `{ truncated, state, version, scannedDirtyFiles }`를 추가한다.
- 모든 새 요청은 `AbortSignal`과 요청 번호를 사용한다. 중단된 요청은 server queue에 취소를 전달하거나,
  최소한 결과 write를 즉시 멈춘다.

### 실시간 신호

presence WebSocket의 기존 `{ type: 'tree' }`는 호환을 위해 남긴다. 새 서버는 가능할 때만 다음처럼 범위를 보낸다.

```ts
{ type: 'tree', project: string, version: number, parents: string[] }
```

클라이언트는 `parents`가 없거나 project가 다르면 기존처럼 root를 다시 읽는다. `parents`가 있으면 그 부모의
`directoryChildren`만 stale 처리하고, 펼쳐진 폴더만 다시 요청한다. 신호에는 파일명·경로·권한 정보를 싣지 않는다.

## 구현 단계

각 단계를 독립 PR/커밋으로 만들고, 이전 단계를 통과한 뒤 다음 단계로 간다. `npm run build`는 실행 중인 mew를
즉시 바꾼다는 README 계약이 있으므로 구현 담당자는 `npm test`, `npm run lint`, `npx tsc -b`로 검증하고
사용자 승인 없이 build/serve/restart하지 않는다.

### 0. 기준선 계측과 fixture

**목적:** 이후의 "개선"을 수치로 증명할 기준을 만든다.

1. `mew/server/perfMarks.ts`를 추가한다. `process.hrtime.bigint()` 기반 `measure(name, fields, fn)`을 제공하고,
   개발 모드 또는 `MEW_PERF_LOG=1`일 때만 JSON 한 줄을 쓴다. 기본 실행에서는 로그·개인 경로를 내보내지 않는다.
2. `tree.ts`, `search.ts`, `watcher.ts`, `/api/tree`, `/api/search/stream`에 다음 구간을 각각 찍는다:
   `tree.list`, `tree.full`, `search.candidate-build`, `search.read`, `search.match`, `watch.sync`, `watch.signature`,
   `api.serialize`. 파일 수·읽은 바이트·결과 수만 부가한다.
3. `mew/server/perfFixture.ts`와 테스트 전용 fixture 생성기를 만든다. 1만 파일까지는 기본 test에서,
   10만/50만 파일은 `MEW_PERF_FIXTURE=1`에서만 생성한다. binary·ignore·docs·subproject·긴 경로를 섞는다.
4. `mew/server/perf.test.ts`에 회귀 예산을 넣되 CI의 절대 시간 assertion은 피한다. 대신 full tree 호출 횟수,
   읽은 후보 수, 반환 행 수 같은 결정적 상한을 검사한다.

**통과:** 현재 병목 표의 모든 구간이 로그로 구분되고, fixture가 작업 트리·사용자 파일을 만들거나 지우지 않는다.

### 1. 메모리 FileCatalog와 tree API 전환

**목적:** 평상시 탐색과 watcher에서 전체 재귀 tree 재구축을 없앤다. 이 단계는 새 DB가 없다.

1. `fileCatalog.ts`에 프로젝트별 `Map<project, Catalog>`를 구현한다. `ensure(project)`는 첫 요청에서 한 번만
   async 초기 스캔을 시작하고, 동시에 온 요청은 같은 Promise를 공유한다.
2. 초기 scan은 `fs.promises.readdir`로 한다. 재귀 순회는 64~256개 디렉터리 단위로 `setImmediate`에 양보하며,
   무제한 `Promise.all`을 쓰지 않는다. `.git`·`node_modules`·`.data`·ignore·download-only의 기존 정책을 그대로 적용한다.
3. `listChildren(project, parent, opts)`를 구현한다. `listTreeDirAsync`와 같은 정렬·`project` 판별 결과를 만들고,
   stale/building 중에는 마지막 완전 snapshot을 반환한다. snapshot이 전혀 없을 때만 기존 `listTreeDirAsync`로 안전하게 fallback한다.
4. `tree.ts`의 public 함수는 유지하되, `/api/tree`만 catalog adapter를 이용하게 바꾼다. guest의 path 보존을 위한
   전체 필터는 아직 기존 `buildTreeAsync`를 사용해도 된다. guest 최적화는 권한 회귀 없이 별도 PR로 한다.
5. `watcher.ts`에 `catalog.note(change)`를 주입한다. 이벤트의 filename을 신뢰할 수 있으면 해당 부모만,
   filename이 없거나 `rename`이면 부모 재스캔을 예약한다. watcher 집합의 증분 추가/삭제가 이 단계의 목표가 아니므로
   기존 `collectWatchDirsAsync`는 남긴다.
6. catalog 변경이 반영되면 affected parents와 version을 포함한 tree 신호를 broadcast한다. `lastJson` signature 비교는
   catalog 경로에서는 제거한다.

**필수 테스트:**

- `fileCatalog.test.ts`: 최초 scan dedupe, 파일/폴더 생성·rename·delete, parent만 재스캔, immutable snapshot, 정렬.
- 기존 `tree.test.ts`: member/manager/owner/guest의 결과 배열이 이전과 동일.
- `watcher.test.ts`를 추가 또는 확장: 파일 하나 변경 시 full recursive build 없이 영향 부모만 publish.

**통과:** 반복 `/tree?path=`는 디스크 `readdir` 없이 snapshot을 사용하고, 프로젝트 변경 뒤 현재 열린 폴더만 갱신된다.

### 2. Ctrl+P 서버 파일명 색인

**목적:** `App.tsx`의 `fetchFullTree` 두 번과 브라우저 전체 후보 정렬을 제거한다.

1. `mew/server/fileNameSearch.ts`를 추가한다. catalog snapshot의 files에서 scope별 후보 view를 만들고, 정규화된
   basename·segment·전체 경로를 보관한다. scope 판정은 현재 `App.tsx`의 Documents/직계 `.mew` 하위 프로젝트 규칙과
   결과가 같아야 한다.
2. fuzzy 알고리즘은 `mew/packages/editor/src/utils/fuzzy.ts`의 이미 검증된 함수를 먼저 조사·재사용한다.
   재사용이 부적절하면 순수 함수로 추출하고 한 곳만 기준으로 둔다. 순위는 basename exact/prefix, segment prefix,
   경계 match, subsequence 순으로 deterministic tie-break(`path.localeCompare`)를 둔다.
3. `/api/search/files`를 `api.ts`에 붙인다. query 2글자 미만이면 빈 검색 결과 대신 `recent` 슬롯을 돌릴 수 있으나,
   최근 파일 저장 기능은 이 단계의 선행조건이 아니다. 결과는 최대 50개다.
4. `client.ts`에 `searchFiles()`를 추가하고 `App.tsx`의 `loadSidebarFileSearchResults`와 `fetchFullTree` import를 삭제한다.
5. `SearchPanel.tsx`는 파일 모드에서 debounce 후 `searchFiles`를 호출한다. 이전 `fileCandidatesRef` 전체 후보 cache를
   없애고 `AbortController`·request id로 늦은 응답을 버린다. 기존 정규식·대소문자 옵션과 tooltip·scope UX는 유지한다.
6. 파일명 결과가 100개 이상으로 확장될 가능성에 대비해 목록 행을 `react-window` 같은 새 의존성 없이 간단한
   viewport window로 렌더하거나, 상한 50을 유지한다. 이번 단계에서는 상한 50 유지가 기본이다.

**필수 테스트:**

- `fileNameSearch.test.ts`: 한글, camelCase, kebab-case, 동일 basename, scope OR, docs/하위 프로젝트, regex/case.
- `SearchPanel` 또는 pure helper test: 취소된 옛 응답이 새 query 결과를 덮지 않음.
- 정적 검사: Ctrl+P 경로에서 `fetchFullTree` 호출 0회.

**통과:** 10만 파일 fixture에서 Ctrl+P 요청이 전송·파싱하는 후보 수가 50개 이하이며, 검색 중 UI main thread 긴 task가 없다.

### 3. 클라이언트 tree version·부분 invalidation

**목적:** 변경 신호마다 root·docs·활성 프로젝트 트리 전체를 다시 읽는 흐름을 없앤다.

1. `client.ts`에 `fetchTreeV1()`을 추가한다. 배열 구 API는 호출자가 모두 옮겨질 때까지 남긴다.
2. `App.tsx`에 프로젝트별 `{ version, rootEntries, staleParents }` 상태를 둔다. 현재 tree state를 한꺼번에 바꾸지
   말고 adapter 함수로 `FileTree`가 기대하는 `TreeNode[]`를 만든다.
3. `usePresence.ts`의 tree 메시지 타입을 확장하고, `App.tsx`의 `onTreeChange`에서 `parents`만 stale 처리한다.
   열린 parent는 즉시 background refetch, 접힌 parent는 다음 expand 때 fetch한다. 서버가 구 신호만 보내면 기존 전체 reload를 fallback으로 쓴다.
4. `FileTree.tsx`에 `catalogVersion`과 `invalidateParents(paths)` 또는 동등한 props를 추가한다. `directoryChildren` 중
   영향 없는 key·openDirs·focus·scroll identity를 보존한다.
5. 파일 조작 성공 뒤의 낙관적 UI는 유지하되, catalog version 응답이 올 때까지 전체 root refetch를 강제하지 않는다.

**필수 테스트:**

- `usePresence` 메시지 parsing test: 구/신 tree 신호 모두 동작.
- `FileTree` test: `docs/a` 변경이 `src`의 펼침 cache를 지우지 않음.
- 프로젝트 전환 중 늦은 v1 응답이 새 root state를 덮지 않음.

**통과:** 한 파일 수정이 열린 관련 폴더 외 UI 스크롤·펼침 상태를 바꾸지 않고, `/tree` root 재요청을 만들지 않는다.

### 4. 내용 색인 PoC

**목적:** scanner를 대체할 만큼 정확하고 복구 가능한 후보 색인을 증명한다. 이 단계는 feature flag 뒤에 둔다.

1. `mew/server/searchCatalog/`를 만든다: `storage.ts`, `schema.ts`, `indexer.ts`, `query.ts`, `manifest.ts`.
   database path와 schema version은 이 폴더 밖에 흩어놓지 않는다.
2. schema에는 `files(project, path, mtime_ms, size, content_hash, indexed_at)`와 FTS table을 둔다. project/path unique,
   transaction, prepared statement를 사용한다. SQLite가 FTS 구문상 같은 한글 substring을 못 찾는 경우를 ADR에서 정한
   tokenizer/보조 trigram table로 처리한다.
3. `SearchCatalog.ensure(project, visibleFiles)`는 manifest와 filesystem fingerprint를 비교해 dirty 파일만 index한다.
   초기 구축은 background job으로 실행하고 API는 `{ state: 'building' }`을 즉시 반환한다. 검색 요청의 event loop에서
   대량 index를 수행하지 않는다.
4. write·upload·rename·delete API와 watcher의 catalog change가 search catalog update를 예약한다. rename은 old row 삭제와
   new row upsert를 한 transaction으로, 삭제는 tombstone 없이 row 삭제한다.
5. `/search/stream`은 literal query에서 `SearchCatalog.candidates()`를 먼저 부른다. 후보 각 파일의 현재 `mtime/size`를
   확인한 뒤 `searchInProjectProgressively`의 line/match 계산으로 검증한다. dirty·stale 파일은 original scanner를 추가로
   돌려 색인 지연이 결과를 빠뜨리지 않게 한다.
6. regex는 기본적으로 기존 scanner를 사용한다. PoC에서 FTS candidate filter가 regex 결과의 **superset**임이 증명되기 전에는
   regex에 색인을 사용하지 않는다.
7. 색인 open/migration/build 실패는 503이 아니라 `state: 'stale'` + 기존 scanner fallback이다. 오류는 사용자에게
   경로·본문 없이 일반 메시지로만 보인다.

**필수 테스트:**

- schema 생성/upgrade, DB 삭제·손상 뒤 재구축, 파일 rename/delete, watcher 누락 뒤 full reconcile.
- literal 검색 결과가 기존 `searchInProject`와 파일·줄·열·매치 수까지 동등.
- index write가 지연된 직후 저장한 문서도 검색됨(dirty fallback).
- guest/member/manager/owner별로 허용 밖 경로가 결과·snippet·진행 이벤트에 전혀 없음.

**통과:** 10만 파일 대표 literal query에서 full scan이 아닌 후보 검증만 하며, 결과 동등성 suite가 0건 누락이다.

### 5. 내용 검색 운영화

**목적:** PoC를 기본 경로로 올리되, 문제 발생 시 즉시 안전하게 되돌린다.

1. `MEW_SEARCH_INDEX_ENABLED=0|1` feature flag를 제공한다. ADR 0105에 따라 기본값은 `1`이고, `0`이면 scanner만 쓴다.
   설정 값·DB 위치·상태는 `mew/docs/configuration/`의 해당 문서에 코드 계약으로 기록한다.
2. `/api/search/stream`의 done 이벤트에 `state`, `version`, `scannedDirtyFiles`를 넣고 `SearchPanel.tsx`에
   "색인 준비 중 — 정확 검색으로 보완 중" 상태를 추가한다. 결과 없음은 index building 완료 전 확정 문구를 쓰지 않는다.
3. 결과 event는 최대 20 파일 단위, 50~100ms 단위로 flush한다. 각 파일 결과를 도착 즉시 `setResults([...])`로 append해
   수천 React render가 나는 현재 경로를 batch reducer로 바꾼다.
4. 30일간 `candidateCount`, `dirtyFallbackCount`, `queryMs`, `firstResultMs`, `indexLagMs`, fallback 비율을 기록한다.
   색인 오류 또는 누락 의심 시 flag를 0으로 바꿔 scanner만 쓰게 할 수 있어야 한다.

**통과:** 새 의존성/설정/복구 절차가 README와 ADR에 기록되고, flag off에서 기존 검색 테스트 전부 통과한다.

## 금지와 주의점

- 요청마다 `rg` 프로세스를 띄워 해결하지 않는다. 빠를 수 있어도 watcher·권한·scope·Windows 배포와 별개 계약을 다시 만들며,
  상시 검색 부하가 커진다.
- UI의 파일명 검색을 위해 `/api/tree` 전체 트리를 다시 보내지 않는다.
- 인덱스 결과를 권한 판정으로 쓰지 않는다. **반환 직전** `guestAccess`와 tree visibility를 다시 적용한다.
- worker thread, SSE, watcher callback에서 stale snapshot을 직접 mutate하지 않는다.
- 파일 본문·절대 경로·검색어를 기본 로그나 telemetry로 보내지 않는다.
- 대량 Git 변경에 이벤트마다 index transaction·WebSocket broadcast를 하지 않는다. debounce된 batch와 version 하나를 쓴다.
- `npm run build`, 서버 restart, 배포는 사용자 승인 없이 실행하지 않는다.

## 최종 검증 체크리스트

- [x] `npm test`, `npm run lint`, `npx tsc -b` 통과
- [x] `python3 .mew/docs/.github/scripts/moc_coverage.py`와 `docs_health.py` 통과
- [x] 1만 파일 기본 fixture에서 tree·파일명·내용 검색의 기능 동등성 통과
- [x] 선택 성능 fixture에서 full-tree API 호출 없이 Ctrl+P가 상위 50개만 반환
- [x] 리터럴·regex·case-sensitive·한글·빈 query·긴 query·바이너리·대용량 파일의 회귀 테스트 통과
- [x] 저장 직후·rename·delete와 watcher 누락/대량 변경 full reconcile에서 stale 결과가 남지 않음
- [x] guest 권한 변경 전후 검색 결과와 tree presence 신호에 비공개 경로가 없음
- [x] index 디렉터리 삭제·손상·migration 실패에서 재구축과 scanner fallback이 계속 동작
- [ ] 실제 브라우저 trace를 연결 가능한 환경에서 수집해 설계 문서의 p50/p95 목표를 기록
