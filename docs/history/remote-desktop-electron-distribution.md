---
title: "이전 Electron 배포·라이선스 검토"
created: 2026-10-01
updated: 2026-10-01
description: "네이티브 호스트 전환 전 Electron·Chromium·VP8 배포물의 라이선스·고지·상업 이용 검토를 보존한다. 현재 배포 계약은 별도 문서를 따른다."
---

ADR 0188 이전 배포물의 검토 기록이다. 현재 기준은 [배포 계약](../development/remote-desktop-distribution.md)이다.

## 고지와 확인한 조건

| 범위 | 조건과 배포물 |
| --- | --- |
| 직접 작성한 전송·입력·프로토콜 코드 | Mew의 MIT. 보조 앱도 `license: MIT`를 선언하고 설치 복사 목록에 독립 배포용 `LICENSE`를 포함 |
| Electron 44.3.0 | Electron 자체 MIT, Chromium 및 내장 구성 요소는 각자 라이선스. 원본 `node_modules/electron/dist/LICENSE`와 `LICENSES.chromium.html`을 보존하며 설치 완료 검사에서 누락을 거부 |
| node-datachannel 0.33.4 / libdatachannel 0.24.5 | MPL-2.0. 적용 대상 파일의 라이선스·대응 소스 조건과 binary 부속 고지 보존 |
| VP8/libvpx | WebM BSD 형식 고지 및 별도 특허 허여. 브라우저/Chromium 내장 구현을 사용하고 libvpx 코드를 복사하지 않음 |
| koffi 3.2.1, dbus-next 0.10.2, ws | 각 MIT. 설치된 npm 패키지의 LICENSE/NOTICE를 제거하지 않음 |
| 간접 npm 의존성 | 잠금 파일의 MIT·ISC·BSD·Apache-2.0·BlueOak·Unlicense 등의 조건 유지. `json-schema`는 BSD-3-Clause 선택 가능. 라이선스 메타데이터가 없는 jsbi 2.0.5는 패키지 LICENSE의 Apache-2.0, map-stream 0.1.0은 LICENCE의 MIT를 확인 |
| 전용 Windows Node | 공식 ZIP 전체 디렉터리를 이동하므로 Node 및 포함 구성 요소의 LICENSE를 함께 보존 |

Electron 44.3.0의 [DEPS](https://github.com/electron/electron/blob/v44.3.0/DEPS)는 Chromium 152.0.7977.78과 내장 Node v24.20.0을 지정한다. 보조 앱이 필요 시 별도 설치하는 Windows Node 24.21.0과 구분한다. 공식 [Electron 라이선스](https://github.com/electron/electron/blob/v44.3.0/LICENSE), [WebM 소프트웨어 라이선스](https://www.webmproject.org/license/software/), [추가 특허 허여](https://www.webmproject.org/license/additional/)를 기준으로 확인했다.

## 런타임을 함께 묶어 배포할 때

현재 설치기가 받는 Electron 원본 고지에는 FFmpeg 등 LGPL 구성 요소도 포함된다. 따라서 전체 런타임을 모두 MIT라고 표시하거나 라이선스 파일만 남기면 모든 조건을 충족한다고 주장하지 않는다. Electron 바이너리까지 포함한 새 설치 파일을 배포한다면 고지 보존 외에 **해당 바이너리와 정확히 대응하는 소스·패치·빌드 정보 제공 및 LGPL의 교체/디버깅 권리 등**을 배포 방식에 맞게 충족해야 한다. 근거는 [FFmpeg 공식 배포 안내](https://ffmpeg.org/legal.html)와 해당 배포물에 들어 있는 라이선스 원문이다. 현재 작업은 그런 번들 설치 파일을 만들지 않는다.

## 2026-09-14 공식 배포물 상세 확인

[Electron 44.3.0 릴리스](https://github.com/electron/electron/releases/tag/v44.3.0)의 Linux x64 공식 ZIP을 내려받아 실행 없이 확인했다. ZIP 크기는 122,830,582바이트이며 SHA-256 `8b49b9efdd73c0f467edc3c1cd5678392c384ccf224f34ff54179f736e2f384b`가 같은 릴리스의 `SHASUMS256.txt`와 일치했다. 내부 `version`은 `44.3.0`, `LICENSES.chromium.html`은 20,111,209바이트다.

생성된 고지에서 중복을 포함한 제품 항목 779개를 확인했다. 이는 **779개 라이브러리가 모두 해당 플랫폼 바이너리에 연결되었다는 증거는 아니다.** 플랫폼 조건부·참조 구성 요소가 포함될 수 있으며, 아래는 실제 고지에 수록된 대표 항목이다. Windows·macOS 배포물과 개별 바이너리의 연결 관계는 이번에 확인하지 않았다.

| 구성 요소 | 역할 | 배포물에서 확인한 라이선스 범위 |
| --- | --- | --- |
| Electron / Node.js | 데스크톱 셸·서버 JavaScript 런타임 | 자체 MIT, 포함 구성 요소는 별도 고지 |
| V8 / ANGLE / WebRTC | JavaScript·그래픽·실시간 통신 | BSD 계열 중심, 각각의 부속 고지 유지 |
| libvpx | VP8·VP9 코덱 | BSD 계열 및 WebM 특허 허여 |
| BoringSSL / ICU | 암호화·국제화 | Apache-2.0 / Unicode License V3 및 부속 고지 |
| dav1d / OpenH264 | AV1·H.264 관련 구성 요소 | BSD 계열. 고지 수록만으로 특허 조건까지 충족한다고 판단하지 않음 |
| FFmpeg | 미디어 처리 | 기본 LGPL-2.1-or-later. 원문에 선택적 GPL 구성 설명이 있다고 이 바이너리를 GPL 빌드로 단정하지 않음 |
| liblouis | 점자 변환 | LGPL-3.0-or-later |
| libbrlapi / libsecret / libusbx / Speech Dispatcher | 접근성·시스템 통합 | LGPL-2.1 관련 고지 |
| GTK | Linux GUI 통합 | GNU Library GPL v2 고지 |
| axe-core / Eigen / symphonia | 접근성 검사·수치 연산·미디어 | MPL-2.0 관련 고지 |

이 라이선스들은 상업 이용 자체를 금지하지 않는다. LGPL 구성 요소를 이용한다고 Mew 전체가 자동으로 GPL이 되는 것도 아니다. 다만 배포 시 연결 방식·수정 여부·각 라이선스 버전에 맞는 의무가 생긴다. MPL은 배포하는 적용 대상 파일과 수정본의 소스 제공이 핵심이며, 별도 Mew 파일까지 일괄 공개시키는 라이선스는 아니다. 근거: [LGPL-3.0 원문](https://opensource.org/license/lgpl-3-0), [MPL 공식 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

### 이전 VP8 선택과 Electron의 코덱 구성

현재 Mac/Linux와 이전 서버 전송이 VP8로 협상하는 것은 실제 화면 전송 형식에 관한 선택이다. Electron 44.3.0의 [공식 빌드 설정](https://github.com/electron/electron/blob/v44.3.0/build/args/all.gn)은 `ffmpeg_branding="Chrome"`, `proprietary_codecs=true`를 지정한다. 따라서 VP8만 사용한다고 배포하는 Electron에서 H.264·AAC 지원이나 다른 미디어 라이브러리가 제거되지는 않는다. 여기서 `proprietary_codecs`는 코덱 지원 빌드 옵션이지 Electron 전체의 소프트웨어 라이선스가 독점 라이선스라는 뜻은 아니다.

소프트웨어 저작권 허락과 코덱 특허 허락은 구분한다. WebM의 허여에도 명시된 범위·조건이 있으며 모든 제3자 특허를 보증하지 않는다. 반대로 이 빌드 옵션만 보고 Mew에 특정 특허 사용료가 반드시 발생한다고 단정할 수도 없다. 향후 코덱 또는 배포 시장을 바꿀 때 실제 배포·사용 형태를 기준으로 판단한다.

### 클라우드와 고객 배포의 차이

| 배포 형태 | Mew에 적용할 확인 |
| --- | --- |
| Mew 소스·설치기를 배포하고 고객 환경에서 공식 런타임을 다운로드 | 현재 방식. Mew가 제공하는 파일의 고지와 설치된 upstream 고지를 보존. 다운로드 경로를 분리했다고 모든 의무가 사라지는 것은 아님 |
| Mew 운영 서버 내부에서만 런타임 실행 | 서버 내부 LGPL/MPL 사용만으로 고객에게 서버 전체 소스를 제공하는 의무가 자동 발생하지 않음. 고객에게 내려가는 웹 코드·보조 앱은 따로 판단 |
| Electron을 포함한 설치 파일·ZIP·고객 다운로드용 VM/컨테이너 이미지 제공 | 해당 바이너리의 고지, 적용 대상의 정확한 대응 소스·패치·빌드 정보, LGPL 교체·재결합 및 수정 디버깅 권리를 배포 방식에 맞게 충족 |

현재 확인 결과만으로 Electron을 제거할 이유는 없다. 공식 다운로드 방식을 유지하되, 런타임을 직접 묶어 출시하기 전에는 지원 OS별 실제 배포물과 연결 관계를 확인하고 라이선스 고지·소스 제공 절차를 마련한다. Mew 자체에 별도 상업 제한을 도입하더라도 제3자 LGPL/MPL 구성 요소의 권리를 그 제한으로 덮어쓰지 않는다. 모델·에이전트 도구의 별도 검토는 [에이전트·모델 라이선스 검토](../work/agent-model-license-review.md)를 참조한다.

이 검토는 원격 데스크톱 변경과 고정한 의존성의 배포 조건에 한정한다. Mew 전체 의존성 감사나 모든 국가·제3자 특허에 대한 무분쟁 보증은 아니다. 런타임·의존성 버전 또는 배포 형태가 바뀌면 다시 확인한다.
