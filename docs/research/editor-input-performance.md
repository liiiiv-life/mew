---
title: "Hotview·Plain 입력 성능 측정"
description: "동일한 합성 Markdown을 사용하는 격리 Chromium에서 Hotview·Plain의 키 입력 처리, 전체 문서 직렬화·줄 번호 계산·레이아웃 비용을 측정한다. Pretext 도입 전 최적화 우선순위를 판단하는 연구이며 앱 동작은 변경하지 않는다."
created: 2026-10-18
updated: 2026-10-18
---

# Hotview·Plain 입력 성능 측정

## 목적과 범위

Pretext로 에디터를 빠르게 만들 수 있는지 판단하기 위해, 기존 입력 경로의 JavaScript 처리와 브라우저 레이아웃 비용을 분리한다. 측정 도구는 [editor-performance-benchmark.mjs](../../server/editor-performance-benchmark.mjs)다. 앱 코드나 의존성을 바꾸지 않고, 기존 UI 테스트와 같은 메모리 번들·Playwright 요청 가로채기로 합성 문서를 연다. 실행 중인 앱 서버와 `dist/`는 사용하거나 변경하지 않는다.

측정 대상은 2026-10-18 작업트리다. 본 측정 번들은 `e79076b` 기준이며, 기존에 stage된 `Editor.tsx`의 보기 전환 수정이 포함되어 있다. 진행 중 다른 작업에서 `51ba6cb`가 기록되어 후속 비교는 그 작업트리에서 실행했다. 두 실험의 guest 로컬 입력 경로와 `Editor.tsx`·`lineFocus.ts`·`CodePane.tsx`는 같다. 후속 줄 번호 제외 실험에는 같은 소스로 새 대조군을 측정했다. 이 연구의 커밋에는 기존 수정이 포함되지 않는다.

## 측정 조건

- Linux x64, AMD Ryzen 5 9600X, 논리 CPU 12개, Node.js 22.22.2, Chromium 153.0.8010.12.
- 1280×800, 기본 dark 테마, production React. 앱의 기본 글꼴 설정을 적용하고 로컬 IBM Plex Sans KR·Mono 로드를 기다린다.
- 실제 `EditorPane`과 Hotview/Tiptap·Plain/CodeMirror를 사용한다. guest의 로컬 편집이며 협업·네트워크·파일 자동저장은 모의 처리한다.
- 50·500·5000문단의 동일한 합성 Markdown을 사용한다. 각 문단에는 한글·영문·강조·인라인 코드·파일 링크가 들어간다.
- 두 편집기 모두 첫 본문 문단 맨 앞에서 준비 입력 5회를 한 뒤, 키보드 이벤트로 `x`를 20회 입력한다. 프론트매터나 제목을 입력 대상으로 삼지 않는다.
- 50·500문단은 새 페이지에서 3회, 비용이 큰 5000문단은 1회 측정한다. 라운드마다 Hotview·Plain의 실행 순서를 번갈아 바꾼다. CPU 감속은 적용하지 않는다.

측정값은 다음처럼 구분한다.

| 값 | 의미와 제한 |
| --- | --- |
| JavaScript·레이아웃·스타일 시간 | CDP `Performance.getMetrics`의 구간 증가량을 입력 수로 나눈 값. renderer에서 실행된 측정 코드·polling도 포함한다. |
| 입력 후 프레임 경계 | keydown부터 두 번째 `requestAnimationFrame`까지. 실제 paint 시각이나 INP가 아니며, 프레임 대기 시간이 포함된다. |
| 함수 시간 | `dispatch`, `viewUpdate`, `lineFocus`, `serialize`, `getMarkdown`, `update` 등의 호출 횟수·포함 시간. 중첩된 값을 합산하면 안 된다. |
| 첫 표시 시간 | React 마운트 시작부터 편집기 표시·글꼴 준비·두 프레임 경계까지. 파일 열기 전체 시간이나 네트워크 지연은 아니다. |

## 측정 결과

아래 시간의 단위는 ms다. JavaScript·레이아웃은 라운드별 키당 평균의 중앙값이고, 프레임 경계는 모든 입력 표본의 nearest-rank p50이다. 짝수 개 표본이면 가운데 두 값 중 작은 값을 택한다. 5000문단은 한 라운드의 값이다. 문서 크기는 UTF-8 바이트이며 KB·MB는 1000 단위로 표기한다.

| 문단·크기 | Hotview JS/키 | Plain JS/키 | Hotview 레이아웃/키 | Hotview 프레임 경계 | Plain 프레임 경계 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50 · 11.3KB | 5.4 | 2.1 | 1.2 | 31.9 | 32.1 |
| 500 · 113.0KB | 61.1 | 2.6 | 8.8 | 82.2 | 32.0 |
| 5000 · 1.13MB | 16047.9 | 6.4 | 97.0 | 15668.2 | 31.8 |

Hotview의 전체 문서 직렬화는 모든 크기에서 **4회/키**, `getMarkdown`과 `lineFocus`는 각각 **2회/키**였다. 직렬화 포함 시간의 키당 평균 중앙값은 1.9·39.6·15435.0ms다. JavaScript 구간 대비 약 36%·65%·96%에 해당한다. 함수 시간과 CDP 시간은 별도 계측이므로 이 비율은 비용의 대략적인 비중으로 해석한다.

5000문단의 Hotview는 DOM 하위 요소 30001개, Plain은 319개를 유지했다. 첫 표시 시간은 각각 10311.1ms와 135.0ms였다. 따라서 큰 문서는 입력 경로 외에 첫 표시와 화면 밖 DOM 처리도 별도 최적화 대상이다.

### 줄 번호 제외 비교

113KB 문서에서 같은 소스·동일 조건으로 각각 3회×20키를 측정했다. 줄 번호 제외는 **마운트 이후** 해당 플러그인을 제거하므로 입력 비용만 비교한다.

| 조건 | JS/키 | 직렬화/키 | 직렬화 횟수/키 | 레이아웃/키 | 프레임 경계 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 기존 Hotview 대조군 | 59.4 | 38.4 | 4 | 8.6 | 80.6 |
| 줄 번호 플러그인 제외 | 36.0 | 22.0 | 2 | 7.5 | 53.1 |

JavaScript 구간은 약 **39%**, 입력 후 프레임 경계는 약 **34%** 줄었다. 줄 번호만 생략한 실험이므로 기능을 유지하는 수정의 개선율로 보장하지 않는다. 직렬화 중복과 줄 번호의 전체 문서 재계산을 줄이는 방향의 근거다.

함수별 래퍼를 생략한 같은 크기의 Hotview도 3회×20키 측정했다. JavaScript 구간의 중앙값은 59.2ms/키로, 래퍼를 사용한 대조군 59.4ms/키와 비슷했다. 따라서 이 크기에서 관측한 수십 ms의 비용을 계측 래퍼만으로 설명하기는 어렵다.

### CPU 프로파일

113KB의 별도 Hotview 20키를 1ms 표본 간격으로 프로파일링했다. `tiptap-markdown`·`prosemirror-markdown` 직렬화 경로의 `atBlank`, `normalizeInline`, `text`가 주요 JavaScript self 표본에 나타났고, `getClientRects`와 GC도 관측했다. 프로파일의 이름 기반 `parse`·`render` 집계는 직렬화 함수와 겹칠 수 있으므로 별도 병목 비율로 더하지 않는다.

## 최적화 판단

이 측정에서는 Pretext 도입보다 **전체 문서 직렬화 4회/키의 중복 제거와 줄 번호 계산의 증분 처리**를 먼저 검증하는 편이 적합하다. 문서 모델을 Markdown 문자열로 다시 만드는 비용은 텍스트 높이·줄바꿈 계산을 대체해도 남기 때문이다. 이후 긴 문서의 DOM 표시 범위를 줄일 때 Pretext를 블록 높이 예측에 사용하는 실험을 검토한다.

이 판단은 위 합성 입력의 비용 분포에 따른 추론이다. Pretext의 실제 개선율이나 가상화 구현 후 성능은 측정하지 않았다.

## 확인한 입력 경로

정상적인 controlled 입력에서는 다음 네 경로가 전체 문서 직렬화를 호출한다.

1. 입력 transaction을 표시하기 위한 `LineFocus.decorations`의 `serializer.serialize(state.doc)`.
2. `Editor.onUpdate`의 `getMarkdown()`.
3. React의 본문 prop을 확인하는 비협업 동기화 effect의 `getMarkdown()`.
4. 본문 prop이 바뀐 뒤 보낸 빈 transaction에서 줄 번호 캐시를 갱신하는 `LineFocus.decorations`.

소유 코드는 [Editor.tsx](../../packages/editor/src/Editor.tsx)와 [lineFocus.ts](../../packages/editor/src/editor/lineFocus.ts)다. `tiptap-markdown`의 `getMarkdown()`은 ProseMirror 문서 전체를 Markdown 문자열로 만든다. 이 합성 문서에서 일반 문단의 직렬화는 화면 DOM의 텍스트 치수를 측정하지 않는다.

`lineFocus` 시간에는 직렬화와 별도의 MarkdownIt 분석·장식 생성이 포함된다. `getMarkdown`에도 직렬화 시간이 포함된다. `parseMarkdown`은 `editor.storage.markdown.parser.parse`만 감싸므로, 표본이 없더라도 줄 번호 계산의 MarkdownIt 분석이 없다는 뜻은 아니다.

## 재현

저장소 루트에서 실행한다. 앱 빌드나 서버 시작은 필요 없다. 결과와 선택적 CPU 프로파일은 `/tmp`에 저장한다.

```bash
MEW_BENCH_SAMPLES=20 node server/editor-performance-benchmark.mjs
```

줄 번호 제외 비교와 CPU 프로파일은 다음 조건으로 실행했다. 대조군은 첫 명령에서 `MEW_BENCH_NO_LINE_FOCUS=1`을 빼고 실행한다.

```bash
MEW_BENCH_SIZES=500 MEW_BENCH_ROUNDS=3 MEW_BENCH_SAMPLES=20 MEW_BENCH_MODES=hotview MEW_BENCH_NO_LINE_FOCUS=1 MEW_BENCH_OUTPUT=/tmp/mew-editor-no-line-focus.json node server/editor-performance-benchmark.mjs
MEW_BENCH_SIZES=500 MEW_BENCH_ROUNDS=3 MEW_BENCH_SAMPLES=20 MEW_BENCH_MODES=hotview MEW_BENCH_INSTRUMENT=0 MEW_BENCH_OUTPUT=/tmp/mew-editor-uninstrumented.json node server/editor-performance-benchmark.mjs
MEW_BENCH_SIZES=500 MEW_BENCH_ROUNDS=1 MEW_BENCH_SAMPLES=20 MEW_BENCH_MODES=hotview MEW_BENCH_PROFILE=/tmp/mew-editor-profile.cpuprofile MEW_BENCH_OUTPUT=/tmp/mew-editor-profile.json node server/editor-performance-benchmark.mjs
```

`MEW_BENCH_SIZES`, `MEW_BENCH_ROUNDS`, `MEW_BENCH_LARGE_ROUNDS`, `MEW_BENCH_SAMPLES`, `MEW_BENCH_MODES`, `MEW_BENCH_OUTPUT`으로 문단 수·반복·저장 위치를 지정한다. 5000문단 이상의 기본 반복은 1회다.

`MEW_BENCH_NO_LINE_FOCUS=1`은 해당 격리 페이지에서만 줄 번호 플러그인을 제외한다. `MEW_BENCH_INSTRUMENT=0`은 함수별 래퍼를 생략한다. `MEW_BENCH_PROFILE`과 `MEW_BENCH_BUNDLE`을 지정하면 첫 라운드의 가장 큰 Hotview 사례에 대한 CPU 프로파일과 메모리 번들을 각각 저장한다.

현재 도구는 핵심 소스 네 파일을 시작 시 읽고 같은 내용을 번들에 사용하며 SHA-256을 결과에 저장한다. 측정 도중 작업트리가 바뀌어도 이 파일들의 번들 내용과 해시가 어긋나지 않는다. 본 측정의 초기 도구는 결과 기록 시 디스크를 읽었으므로, 당시 JSON의 `EditorPane.tsx` 해시는 번들 시작 시점과 다를 수 있다. 본 측정 번들의 해당 파일 해시는 `36e51faa0f52de82a3f49b2afeab2b39ddae92f08fc0dfd83ed255c34e57ec0c`, 후속 비교는 `595935b1046398bcea695f33790d3b9f4c67f8b778dc22da91585925b0ca8b3a`다.

## 해석의 한계

합성 Markdown의 첫 문단에 ASCII 한 글자를 삽입한 결과다. 한글 IME 조합·긴 단일 문단·표·이미지·대량 붙여넣기·연속 스크롤·모바일·협업·실제 저장 지연을 측정하지 않았다. 전체 앱 실행본의 현장 INP나 사용자 기기 성능으로 일반화하지 않는다. Pretext 자체를 도입한 전후 비교도 수행하지 않았다.

큰 문서 측정의 진행 상태는 Node Inspector에서 입력 사이의 루프 변수·호출 스택으로 확인했다. Node 측정기의 일시정지 동안 Chromium의 입력 처리는 중단하지 않았다. CDP 구간에는 추가 대기·백그라운드 처리가 포함될 수 있지만, 키 사이의 대기 자체는 함수 시간과 keydown 이후 프레임 경계 시간에 포함되지 않는다. 큰 문서는 한 번의 반복이며 정밀한 꼬리 지연 추정에는 표본이 부족하다.
