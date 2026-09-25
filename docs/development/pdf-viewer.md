---
title: "PDF 렌더링·필기·저장 계약"
created: 2026-09-15
updated: 2026-09-15
---

# PDF 뷰어

[개발 지도](MOC.md) · [사용법](../guides/editor.md#pdf-읽기와-필기) · [ADR 0147](../../../.mew/docs/decisions/0147-mew-canvas-pdf-and-ink-annotations.md)

## 실행과 렌더링

`MediaViewer`가 PDF 탭에서만 `pdf-viewer.tsx`를 지연 로드한다. 브라우저 내장 PDF iframe 대신 설치된 PDF.js의 display API를 사용한다. PDF 파싱은 PDF.js worker, 화면과 필기는 앱이 만든 Canvas·텍스트 레이어가 맡는다. 타 PDF UI 프레임워크와 CDN은 사용하지 않는다.

- `/api/pdf`, `/api/fs/pdf`의 HEAD로 원본 버전·편집 가능 여부를 받은 후 같은 경로에 버전 조건을 붙여 문서를 연다. Express의 Range 응답과 256KiB 단위 요청을 사용하며 PDF.js의 전체 문서 자동 선행 다운로드·stream을 끈다. 파일 구조에 따라 첫 페이지에 필요한 바이트 수는 달라진다. 저장 시에는 원본 전체 바이트가 필요하다.
- 화면과 앞뒤 한 페이지만 마운트한다. 페이지 오프셋은 누적 높이 배열·이진 탐색으로 구한다. 방문 전에는 첫 페이지 크기로 추정하고 방문한 페이지의 실제 크기·회전·CropBox·UserUnit으로 보정한다. 선행 페이지 크기 보정·확대·분할 칸 너비 변경 시에는 읽던 페이지를 paint 전에 유지한다.
- 문서별 렌더 큐는 한 번에 한 페이지를 그린다. 화면 밖·이전 확대 배율의 대기 작업은 건너뛰며 진행 작업은 취소한다. 비싼 그리기는 PDF.js의 continuation을 animation frame에 넘긴다.
- 한 Canvas는 최대 4백만 픽셀·한 변 8192픽셀·DPR 2다. 보이는 페이지들의 PDF·완성 필기·현재 스트로크 Canvas 합계 예산은 1600만 픽셀이다. 페이지 교체 중 작업 버퍼·PDF.js 내부 디코드 메모리는 별도이며 이 값은 전체 프로세스 메모리 상한이 아니다. 종이의 CSS 크기는 유지하고 고배율에서 raster 해상도를 제한한다.
- 페이지별 operator list·Canvas를 떠날 때 정리하고, 탭이 언마운트되면 문서·worker·렌더 작업을 파기한다. 스크롤 저장·복원은 `EditorPane`의 기존 [UI 계약](ui-contracts.md)과 `scrollMemory`에 `.pdf-scroll`·`.pdf-pages`를 연결한다.
- `pdf-assets-plugin.ts`가 설치된 PDF.js 버전의 worker·CJK CMaps·표준 폰트·WASM/JS 디코더·ICC·라이선스를 `/pdf-assets/<version>/`에 제공한다. 개발 미들웨어와 프로덕션 asset emission이 같은 파일 집합을 쓴다. 서버가 새 뷰어와 assets를 함께 반영해야 한다.
- CSP는 `frame-ancestors 'none'`, `object-src 'none'`을 유지한다. `script-src`의 `'wasm-unsafe-eval'`은 로컬 이미지 디코더의 WASM 컴파일을 허용하며 JavaScript `'unsafe-eval'`은 추가하지 않는다. PDF 스크립트·폼 action 실행 UI는 제공하지 않는다.

## 플로팅 도구와 PDF 전체화면

확대 비율과 펜 굵기는 공통 `SelectField`의 자체 목록으로 고른다. 확대 버튼으로 만든 현재 비율도 선택 목록에 유지한다. 일반 편집 칸에서는 목록을 body에, 전체화면에서는 PDF 루트에 portal하므로 플로팅 바의 transform·overflow와 전체화면 경계에 잘리지 않는다. 전체화면 종료도 공통 오버레이 스택에 등록해 Esc·뒤로가기가 드롭다운을 먼저 닫고 다음 입력에서 전체화면을 종료한다. 목록 탐색만으로 확대·굵기를 바꾸지 않는다.

탐색·저장·필기·색상·전체화면 조작은 문서 위 하단 중앙의 반투명 플로팅 바 하나에 모은다. 배경은 테마 토큰의 84% 불투명도와 국소 backdrop blur, 18px 모서리를 사용한다. 좁은 칸에서는 중복 확대 버튼·저장 글자를 줄이고 필기 줄을 가로 스크롤한다. 본문 끝에는 도구 높이만큼 여유를 둬 마지막 내용도 도구에 가리지 않고 읽을 수 있다. 상태·저장 오류도 바 내부에서 표시한다.

`use-pdf-fullscreen.ts`는 **PDF 내부 div**에만 `requestFullscreen`을 요청한다. 문서 전체/앱 루트를 전체화면 대상으로 삼지 않는다. 지원하지 않거나 거절되면 상시 마운트된 `pdf-stage` dialog를 `showModal` top layer로 전환한다. 조상 칸의 transform·overflow·앱의 높은 z-index를 벗어나며 외부 UI의 입력을 차단한다. 이 fallback에서 브라우저 주소창 숨김까지 보장하지는 않는다.

전체화면 진입·종료는 뷰어 DOM과 PDF worker를 재생성하지 않는다. 기존 페이지 위치 보정과 초안을 유지한다. 종료 버튼·Esc·네이티브 fullscreenchange를 처리하고, Tab 포커스를 PDF 안에 유지하며 종료 시 진입 버튼에 돌려준다. 언마운트 시 이 뷰어가 소유한 전체화면·modal·이벤트 리스너를 정리한다. 대용량 다운로드 확인창은 플로팅 바 밖의 PDF 루트에 portal로 두어 blur/transform에 잘리거나 전체화면 밖에 표시되지 않게 한다.

검증은 `server/pdf-viewer-ui.test.ts`에서 네이티브 전체화면, 앱 UI hit-test 차단, Esc, 동일 worker·초안 유지, 모바일 API 거절 fallback, 포커스·종료 버튼과 재열람을 포함한다. API 기준은 [MDN Fullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen)과 [modal top layer](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal)다.

## 색 반전

플로팅 도구 줄의 `pdf.invertColors` 토글은 뷰어 로컬 상태이며 기본값은 꺼짐이다. `aria-pressed`로 활성 상태를 알리고 읽기 전용에서도 제공한다. `.pdf-inverted .pdf-page`에 CSS `filter: invert(1)`을 적용해 흰 종이·PDF 본문·텍스트 선택·완성 필기·현재 스트로크를 합성한 뒤 함께 반전한다. 도구 UI와 색상 견본은 원래 색을 유지한다. 페이지별 필터로 가상화·Canvas 픽셀 예산을 유지하며 PDF 재파싱·Canvas 재렌더를 유발하지 않는다. PDF 바이트·필기 색·저장 초안은 바꾸지 않으며 전체화면·확대·스크롤·저장 후에도 뷰어가 마운트된 동안 상태를 유지한다.

## 필기와 저장

Pointer Events·pointer capture·coalesced events로 입력을 받는다. 이동 중 React state를 갱신하지 않고 현재 스트로크 Canvas만 frame 단위로 갱신한다. 좌표는 `PageViewport.convertToPdfPoint`로 PDF 좌표에 저장하며, 끝난 스트로크는 0.25 화면 픽셀 허용오차로 단순화한다. 펜은 둥근 벡터 선, 형광펜은 투명 노란 선, 지우개는 새로 그린 스트로크 단위 삭제다. 점 하나의 입력과 pointer cancellation도 보존한다.

PDF 저장은 명시적이다. PDF-LIB를 별도 worker에 올려 `/Ink`, `/InkList`, 색·폭·투명도, 벡터 `/AP` appearance stream, 인쇄 플래그를 추가한다. 원본 페이지를 이미지로 바꾸지 않는다. 원래의 텍스트·페이지 크기·회전·타 도구 주석을 유지한다. PDF 저장과 사본 다운로드가 같은 직렬화 경로를 사용한다. 원본 저장은 Git 커밋을 만들지 않는다.

- 원본 저장 API는 `PUT`, `Content-Type: application/pdf`, `If-Match: <HEAD 버전>`, 바이너리 본문을 받는다. 업로드 전후 기존 인증·게스트 파일 권한을 검사한다. 외부 경로는 manager/owner 전용이며 실제 경로의 `archives`는 읽기 전용이다. 프로젝트 밖으로 향하거나 차단 디렉터리로 향하는 심볼릭 링크는 거부한다.
- 최대 업로드 크기는 **100MiB**다. 읽기는 이 업로드 상한을 적용하지 않는다. 큰 문서의 필기는 브라우저 메모리가 허용하면 사본으로 내려받을 수 있다.
- 버전은 device/inode/size/mtimeNs/ctimeNs다. Range 요청에도 같은 버전을 고정해 변경 전후 조각이 섞이지 않게 한다. 버전 누락 저장은 428, 변경 충돌은 409다.
- 실제 경로별 쓰기를 직렬화한다. 동일 폴더 임시 파일에 기록·권한 비트 보존·fsync한 뒤 버전을 재검사하고 rename으로 교체한다. 실패한 임시 파일은 제거한다. 다른 OS 프로세스가 최종 검사와 rename 사이에 쓰는 극히 짧은 경쟁 구간까지 잠그는 분산 트랜잭션은 아니다.
- 저장 중 같은 창의 동일 문서 뷰어들이 편집 잠금을 공유한다. 성공하면 새 원본을 다시 열고 저장된 스트로크를 초안에서 제거한다. 실패하면 초안을 유지한다. 원본 바이트가 이미 확보된 문서는 충돌 후에도 필기 사본을 다운로드할 수 있다. 미수신 Range가 있는 상태에서 원본이 바뀌면 옛 원본 전체를 복구할 수 없다.

## 초안과 수명

`mew:pdf-draft:<계정>:<PDF URL>`은 버전과 벡터 스트로크만 담는다. 본문 PDF는 localStorage에 복제하지 않는다. 프로젝트 URL·계정으로 나누며 동일 창의 분할 뷰는 메모리 초안을 공유한다. 스트로크 완료 후 250ms 모아쓰기, 언마운트·pagehide flush, 미저장 필기가 있는 beforeunload 경고를 제공한다. undo는 최근 50회다.

초안은 [브라우저 저장 계약](browser-storage.md)의 중요 데이터이며 캐시 정리 대상이 아니다. 저장소 차단·quota 오류는 화면에 표시한다. 복구한 초안의 버전과 현재 원본이 다르면 자동 적용·삭제하지 않고 명시적 초안 폐기 버튼을 제공한다. 저장소가 허용한 초안은 새로고침·탭 재열람에도 남는다. 다른 브라우저 창 사이의 실시간 필기 병합은 지원하지 않는다.

## 지원 범위

- 페이지 이동, 너비 맞춤, 25–400% 확대, 텍스트 선택·복사, 펜 색상·굵기, 형광펜, 새 필기 지우기, undo/redo, 원본 저장·사본 다운로드.
- 저장된 주석은 PDF 원본으로 표시하며 이 뷰어의 지우개·undo로 다시 편집하지 않는다. 다른 PDF 도구에서는 표준 주석으로 다룰 수 있다.
- 암호 PDF의 비밀번호 입력·읽기는 지원하지만 암호화·전자서명·인증된 PDF의 필기 재저장은 지원하지 않는다. 전자서명을 보존하며 증분 서명하는 도구가 아니다.
- 전체 문서 검색·OCR·목차 패널·링크/폼 인터랙션·실시간 공동 필기는 제공하지 않는다.

## 검증

- `src/utils/pdf-geometry.test.ts`: 1만 페이지 위치 탐색·혼합 크기·픽셀/한 변 예산·스트로크 단순화.
- `src/utils/pdf-annotations.test.ts`: 표준 주석·appearance stream·점 입력·잘못된 좌표 거부·원본/기존 주석/회전/CropBox 보존.
- `server/pdf.test.ts`: 버전 조건·Range·동시 쓰기·원자 교체·권한 모드·오류 시 원본 보존.
- `server/pdf-access.test.ts`: 실제 API의 게스트 보기/편집, 외부 파일 역할, archives, 경로 탈출·심볼릭 링크.
- `server/pdf-assets.test.ts`: 설치 버전과 일치하는 worker·CJK 자원·폰트·디코더·라이선스 출력.
- `server/pdf-viewer-ui.test.ts`: 실제 Chromium과 프로덕션 CSP에서 500페이지 문서 열기·250페이지 이동·가상화·텍스트 레이어·필기·undo/redo·탭/새로고침 초안 복구·PDF 저장·충돌 후 사본 다운로드·모바일/다크·라이트 UI·읽기 전용을 검사한다. API와 파일은 격리 fixture다. 측정 시간은 fixture·호스트 부하에 의존하며 실제 스캔 문서/모바일 기기의 성능 보장이 아니다.

실제 iOS/Android 펜 기기, 대형 스캔·CJK 글꼴·복잡한 벡터 문서 전 범위는 별도 기기 검증이 필요하다. 개발 중 실행 중인 서버의 빌드·재시작은 하지 않는다.

API 참고: [PDF.js display API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [PDF.js Canvas 예제](https://mozilla.github.io/pdf.js/examples/), [PDF-LIB 저장 API](https://pdf-lib.js.org/docs/api/classes/pdfdocument).
