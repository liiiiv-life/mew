---
title: "Mewlink 런처의 역할별 HTML과 코드 분리"
description: "기기 접속 부모·앱 브리지·관리 화면의 HTML 진입점과 JS/CSS를 분리하고, Vite의 정적 의존성 preload로 추가 라우터 왕복을 피하는 결정. 공개 설정 metadata와 격리 번들·브라우저 검증의 범위를 기록한다."
created: 2026-10-20
updated: 2026-10-20
---

## 상태

채택. 코드와 격리 검증을 완료했다. 운영 빌드·배포·실제 접속 시간은 사용자 적용 후 별도로 확인한다.

## 배경

[ADR 0028](0028-mewlink-websocket-bootstrap.md)은 별도 HTTP launch를 없애고 호스트 RTC 준비를 ticket 왕복과 겹친다. 런처는 여전히 접속 부모와 앱 브리지 양쪽에서 같은 JS를 받았다. 한 파일에 관리 화면·제공자 SVG·WebRTC·자원 브리지가 함께 들어 있어 각 역할이 사용하지 않는 코드도 내려받았다.

단일 소스를 역할별로 나누더라도 작은 라우터가 다시 JS를 요청한 뒤 연결을 시작하면 첫 접속에 왕복이 추가된다. 코드 분리와 HTML의 직접 진입을 함께 적용한다.

## 결정

`shared/remote-launcher-role.ts`가 기기·포트 주소, 앱 프레임, 관리 주소의 역할과 HTML 이름을 공유한다. 중앙 Worker는 기기 접속에 connect, 내부 launch에 app, 로그인·등록·대시보드에 dashboard HTML을 선택한다. HTML은 ASSETS의 확장자 없는 내부 경로로 읽어 공개 기기 URL을 정규 HTML 경로로 redirect하지 않는다.

세 HTML 입력은 Vite pre-transform에서 하나의 `public/index.html` 템플릿을 사용한다. 각 문서에 역할별 entry 하나를 정적으로 넣고 CSS와 재귀 modulepreload는 Vite의 HTML 처리에 맡긴다. 역할별 HTML에서 기존 통합 `launcher.js`·`launcher.css` 태그는 제거한다. 작은 `client.ts` 라우터와 기존 이름의 자원은 이전 HTML의 호환 경로로만 유지한다. [Vite HTML 변환](https://vite.dev/guide/api-plugin#transformindexhtml)·[여러 HTML 입력](https://vite.dev/guide/build#multi-page-app).

접속 부모는 기기 확인·브라우저 키·WebRTC·세션·신뢰·복구를, 앱 브리지는 자격증명을 제거한 MessagePort·Service Worker·설치 앱 프레임을 맡는다. 관리 화면은 로그인·등록·계정·기기·브라우저 관리를 맡는다. 공용 화면·요청·타입을 별도 모듈로 두되 일반 접속에서는 관리 화면·제공자 SVG를 읽지 않는다. 명시적 Mewlink 로그인이 필요할 때만 부모가 관리 로그인 모듈을 동적으로 읽는다.

공통 DOM 조작은 `launcher-ui.ts`, 브랜드·제공자 SVG는 `dashboard-ui.ts`가 소유한다. 기본·접속 CSS는 `launcher.css`, 관리 전용 CSS는 `dashboard.css`로 나누고 기존 선언과 화면 동작을 보존한다. entry와 지연 로그인 모듈 모두 기본 CSS를 관리 CSS보다 먼저 읽어 공통 버튼·헤더의 덮어쓰기 순서를 유지한다. 글꼴은 기존대로 관리 화면에서만 읽는다.

Worker는 role HTML에 중앙·앱 origin 두 공개 설정만 metadata로 넣는다. 앱 브리지는 이를 확인해 별도 `/config` 요청을 생략한다. 두 metadata가 모두 없는 이전 HTML만 기존 설정 조회를 사용하며, 일부 누락이나 잘못된 값은 오류로 처리한다. nonce·ticket·브라우저 키·세션을 HTML에 넣지 않는다. 정확한 부모·origin·토큰·instance·MessagePort 검증과 중앙/앱 origin 격리는 유지한다.

## 근거와 영향

분리 전과 같은 minify 조건의 격리 JS 측정에서 접속 부모·앱 브리지 두 문서의 본문 합계는 194,482B에서 102,017B로 47.54% 줄었다. 각 역할의 정적 공용 청크는 문서마다 합산했으며 CSS·Vite preload 보조 코드·HTTP 압축은 제외했다. 운영 빌드 크기나 로그인 완료 시간의 실측 수치는 아니다.

새 JS/CSS는 `/launcher/` 바로 아래의 정해진 파일 형식만 허용한다. source map·중첩 경로·임의 소스·중앙 API를 새로 공개하지 않는다. 역할별 HTML·청크·Worker는 같은 중앙 배포에 포함해야 한다. 소유 계약은 [원격 접속](../development/remote-access.md), 적용 조건은 [중앙 배포](../deployment/remote-central.md)가 정한다. 비공개 중앙 소스의 공개 Git 제외는 유지한다.

## 검증 경계

실제 메모리 ESM 그래프와 캐시를 끈 Chromium 두 문서에서 역할별 정적 청크·다운로드 본문을 확인했다. 일반 접속의 관리 화면·제공자 SVG와 앱 브리지의 JOSE·브라우저 키 구현은 포함되지 않았고 `/config` HTTP는 0회였다. 기존 런처 회귀 11개와 새 그래프 검사 1개가 통과했다.

Workers 83개 검사는 공통 HTML 변환과 실제 ASSETS의 GET/HEAD 200·Location 없음, 역할 선택·공개 metadata·CSP·API 격리·자원 경로 제한을 포함한다. 테스트는 임시 자원 디렉터리를 사용하고 정리하며 운영 `dist/`를 빌드하거나 바꾸지 않는다. 실제 네이티브 P2P·장시간 연결 검증과 타입·린트·문서 검사 결과는 소유 문서에 기록한다. 외부망·휴대폰과 0.5초 목표는 운영 적용 뒤 측정한다.
