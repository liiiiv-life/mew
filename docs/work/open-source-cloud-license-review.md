---
title: "Mew 오픈소스·클라우드 수익화 라이선스 검토"
created: 2026-09-14
updated: 2026-09-14
---

# Mew 오픈소스·클라우드 수익화 라이선스 검토

[진행 작업 지도](MOC.md) · [공개 준비 계획](open-source-release-hardening-plan.md)

목표는 2026-09-30까지 오픈소스 홍보·배포를 준비하고 관리형 클라우드로 수익화하는 것이다. 이 문서는 현황·권고·미해결 사항을 기록하며 라이선스 변경 결정이나 출시 적합성 보증은 아니다. 현행 MIT 결정은 [ADR 0023](../../../.mew/docs/decisions/0023-mew-selfhost-packaging-repo.md)과 [ADR 0112](../../../.mew/docs/decisions/0112-mew-public-release-security-and-credential-boundaries.md)를 따른다.

## 판단과 선택지

**후속 대화에서 요구가 구체화되어 MIT 유지 추천은 보류했다.** 사용자는 기업 내부 사용, 비공개 수정, 비상업적 무료 재배포를 허용하면서 Mew·수정본 자체의 판매와 유료 호스팅을 제한하려 한다. 이에 맞는 용도 제한형 소스 공개 라이선스를 검토하되 아직 채택하지 않았다. 현행 MIT는 그대로이며, 실제 변경 시 중앙 ADR을 먼저 작성한다. 초기 MIT 권고는 보급·도입 편의와 관리형 클라우드 과금을 우선한 것이었고, 경쟁 서비스 제한이라는 요구에는 맞지 않는다.

| 선택 | Mew의 유료 클라우드 | 경쟁사 유료 호스팅 | 소스 공개 조건·의미 |
| --- | --- | --- | --- |
| MIT 유지 | 가능 | 가능 | 수정본 비공개 가능. 저작권·라이선스 고지 보존 |
| Apache-2.0 | 가능 | 가능 | 비공개 수정 가능. 명시적 기여자 특허 허여, 상표권 비허여, NOTICE·변경 고지 등 추가 조건 |
| AGPL-3.0 | 가능 | 가능 | 수정한 프로그램을 네트워크로 제공하면 이용자에게 그 버전의 Corresponding Source를 무료로 받을 기회를 제공 |
| 경쟁 서비스 제한을 넣은 source-available 라이선스 | 조건에 따라 가능 | 문구에 따라 제한 | 사업 분야를 제한하므로 OSI 정의의 오픈소스로 소개할 수 없음 |

근거: [MIT 원문](https://opensource.org/license/mit), [Apache-2.0 §§3–6](https://www.apache.org/licenses/LICENSE-2.0), [AGPL §§5·13](https://opensource.org/license/agpl-3.0), [OSI 정의 §6](https://opensource.org/osd).

AGPL은 무상 서비스 의무나 경쟁 금지가 아니다. 수정본 공개 의무를 지키는 경쟁사는 유료 호스팅할 수 있고, 원본 그대로 운영하는 경우에도 경쟁을 금지하지 않는다. 공개 대상은 해당 프로그램의 대응 소스이며 고객 문서·비밀번호·운영 회사의 모든 독립 시스템이 자동으로 포함되지는 않는다. 별도 결제·운영 코드가 독립 저작물인지 파생·결합 프로그램인지는 실제 구조로 판단한다. 단순히 폴더나 프로세스를 나누는 것만으로 확정할 수 없다.

클라우드 개량을 공개하게 하는 것이 핵심 목표라면 AGPL을 다음 버전 후보로 검토한다. 이 경우 별도 약관 SDK와 결합하는 범위, 상업용 예외 라이선스를 제공할 권리, 기여 정책을 함께 설계해야 한다. Apache-2.0 전환은 기업 도입·특허 허여가 목적일 때 고려하며 경쟁 클라우드 방어 효과는 없다.

## Mew 제작자의 상업 이용 권한 — 제3자 코드 확인

**현재 확인한 핵심 OSS 의존성은 제작자가 Mew를 유료 클라우드로 운영하거나 유료 제품으로 배포하는 것을 허용한다.** 이것과 Mew 자체에 어떤 라이선스를 부여할지는 별도 문제다. 루트에 MIT를 적었다는 사실만으로 이 판단을 내리지 않았다. 아래 의존성 목록에 더해 직접 의존성의 lock 메타데이터, 주요 설치 패키지의 LICENSE, 초기 커밋과 출처 주석을 확인했다.

| 구성 요소 | 확인한 라이선스 | 제작자의 상업 이용과 조건 |
| --- | --- | --- |
| React, Tiptap 및 사용 중인 확장, CodeMirror, Yjs, xterm, node-pty, Express, rrweb | MIT | 유료 서비스·제품 가능. 원저작권·라이선스 고지를 보존 |
| LanceDB, Transformers.js, PDF.js, Playwright, ACP 어댑터 | Apache-2.0 | 유료 서비스·제품 가능. 라이선스와 적용되는 NOTICE·변경 고지 등 준수. 어댑터 하위 Claude SDK의 별도 계약은 제외 |
| sharp-libvips 사전 빌드 라이브러리 | LGPL-3.0-or-later 등 | 상업 이용 가능. 바이너리 배포 시 해당 라이브러리 소스·고지와 연결 방식별 교체·재결합·디버깅 권리 등을 준수 |
| lightningcss | MPL-2.0 | 상업 이용 가능. 해당 코드를 배포하면 MPL 부분의 소스·고지 조건을 지킴. Mew 전체에 MPL을 적용할 의무로 보지 않음 |
| Electron 내장 Chromium·FFmpeg 등 | 복수 라이선스 | 전체가 MIT인 것은 아님. 원격 데스크톱 배포 문서의 구성 요소별 조건 확인 |

근거: 실제 package-lock과 설치 패키지 원문, [MIT](https://opensource.org/license/mit), [Apache-2.0 §4](https://www.apache.org/licenses/LICENSE-2.0), [LGPL §4](https://opensource.org/license/lgpl-3-0), [Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/), [FFmpeg 배포 안내](https://ffmpeg.org/legal.html).

이 허용적 OSS를 이용한다고 Mew의 독자 코드까지 똑같은 라이선스로 공개해야 하는 것은 아니다. 별도 상업 조건을 설계할 수 있지만 **제3자 코드를 전부 Mew 소유라고 표시하거나 그 코드의 원래 이용 권리를 없앨 수는 없다.** 제3자 구성 요소에는 각 원래 라이선스가 적용된다는 예외를 두고, LGPL·MPL의 권리를 Mew 이용 제한으로 막지 않아야 한다. 특히 배포하는 MPL 수정 파일이나 LGPL 수정 라이브러리까지 비공개로 유지할 수 있다고 포괄적으로 약속하면 안 된다. 아직 작성하지 않은 Mew 제한형 라이선스의 호환성을 승인한 것은 아니다.

GPL·AGPL도 그 자체가 상업 이용 금지 라이선스는 아니다. 다만 그 적용을 받는 파생·결합물에 Mew의 재판매 금지 조건을 더하는 것은 별도 충돌을 만들 수 있다. 현재 npm lock과 출처 검색에서는 Mew 자체를 GPL/AGPL 파생물로 명백히 표시한 근거를 찾지 못했다. Rust의 선택적 LGPL 항목은 아래 표의 OR 조건을 따른다.

초기 `535570a` 커밋의 README는 React·TypeScript·Vite 템플릿 안내이며 초기 package.json에도 편집기·서버 라이브러리 의존성이 선언돼 있다. 출처 검색에서 별도의 제한형 라이선스 제품을 통째로 가져왔다는 명시적 근거는 찾지 못했다. **2026-09-14 사용자는 다른 프로젝트의 코드를 직접 복사한 적이 없다고 확인했다.** 이 사용자 진술을 검토 전제로 반영하며, 미확인 수동 복사 프로젝트를 가정한 추가 확인 요구는 두지 않는다. 패키지·자산 라이선스의 확인 범위는 그대로다.

**남은 확인은 상업 이용 불허 판정과 구분한다.** Claude SDK·공식 CLI 및 다른 선택 런타임의 공급자 계약, RAG 변환 모델의 권리 근거, 기존 Oreo Cat의 과거 공개, 실제 배포물 고지·소스 제공은 아래 항목대로 남아 있다. 따라서 핵심 OSS의 상업 이용은 가능하다고 판단하지만 모든 기능과 배포 형태의 법적 검토가 완료됐다고 보고하지 않는다.

## 이미 공개된 MIT의 의미

- 인증 없는 GitHub API와 공개 페이지에서 [liiiiv-life/mew](https://github.com/liiiiv-life/mew)가 public이며 MIT로 표시됨을 확인했다. 공개 main은 `8d2f1d2e8dd4983abf12336543b6a6985882ffab`였다.
- 로컬 기준 HEAD는 `abadf3b79ef5b7c39a60de811fcd9394024f87af`이며 미커밋 변경이 있다. 아래 의존성 검토는 현재 작업 트리 기준이다. 공개 main과 동일한 배포물로 취급하지 않는다.
- [LICENSE](../../LICENSE)와 [package.json](../../package.json)은 MIT, 저작권 표기는 `2026 mew contributors`다. `private: true`는 npm 게시 방지 설정이며 소스의 비상업적 사용 제한이 아니다.
- 로컬 이력에는 2026-07-31 MIT 추가, 09-03 제거, 09-07 재추가가 있다. 라이선스 파일의 일시적 삭제를 이미 허여한 권리의 회수로 볼 수 없다.

향후 새 코드를 다른 조건으로 내더라도 **이미 적법하게 MIT로 제공된 버전의 이용·수정·재배포를 소급 금지할 수 있다고 전제하면 안 된다.** 옛 버전으로 경쟁 포크를 만들 수 있다는 사업 가정이 필요하다. MIT 코드에 새 조건을 적용할 때에도 기존 고지는 보존해야 한다. 기여자 이름 하나나 커밋 수만으로 회사·고용주·외부 저작물의 권리 귀속을 입증할 수 없다. 근거: [MIT 허용 범위](https://choosealicense.com/licenses/mit/), [GitHub의 라이선스 변경·권리자 안내](https://opensource.guide/legal/).

MIT를 유지한다면 복잡한 CLA가 반드시 필요한 것은 아니다. 외부 기여 전 기여 권한 확인과 동일 라이선스 수락 절차를 문서화하고, 필요하면 [DCO](https://developercertificate.org/)를 쓴다. 향후 AGPL 기여까지 포함한 독점 상업용 버전을 판매하려면 그 권리를 허용하는 기여 계약 등이 필요하다. DCO 자체는 저작권 양도나 무제한 재라이선스 허가가 아니다.

## 공개 홍보 전 우선 해결할 사항

### 1. 삭제된 Oreo Cat 이미지가 공개 과거 커밋에 남아 있음

현행 ADR 0112는 재배포 권한이 확인되지 않은 Oreo Cat 자산을 제거하고 재도입하지 않도록 결정했다. 현재 추적 트리에는 이미지가 없고 원본 ZIP은 ignore되어 있다. 하지만 2026-09-02 `7e344d3`에서 추가한 `public/oreo-cat-aichan-owo.png`를 09-05 `ac5626a`에서 삭제했을 뿐, 과거 객체는 남아 있다.

검토일 인증 없는 GitHub contents API가 과거 경로에 **200 응답과 78,601바이트 파일 정보**를 반환했다. 현재 트리 삭제만으로 공개 접근이 끝나지 않았다. 외부 노출 확인에 쓴 참조는 `7e344d3:public/oreo-cat-aichan-owo.png`다.

후속 조치는 권리자로부터 필요한 재배포 허가를 확보하거나, 허가가 없으면 해당 객체를 포함하는 공개 브랜치·태그·이력과 GitHub에 남은 접근 경로를 정리하는 것이다. 재도입 금지의 변경은 새 ADR이 필요하다. 이력 재작성·강제 push는 별도 작업으로 준비하고, 기존 클론·포크·캐시까지 자동 회수되는 것으로 보지 않는다. 이번 검토에서는 원격 이력을 변경하지 않았다.

이 자산의 재배포 불가 판단은 기존 ADR에 근거한다. 원저작자 판매 약관을 이번에 독립적으로 재확인하지 못했으므로 권리 확인 때 원문도 확보한다. 로컬 ZIP은 표준 ZIP 파서로 열리지 않아 약관 원문을 확인하는 증거로 사용하지 않았다.

### 2. Claude Code 호스팅과 SDK 기반 기능의 계약을 분리

후속 [Zed·에이전트·RAG 상세 검토](agent-model-license-review.md)를 함께 읽는다. Anthropic의 최신 변경 보류 공지는 SDK·ACP의 개인 구독 사용을 인정하므로 이를 일괄 금지로 해석하지 않는다. 개인의 구독 사용과 제3자 상업 플랫폼의 토큰 보관·로그인·재판매는 적용 범위가 다르다.

초기 검토에서는 대화형 Claude를 공식 CLI terminal 화면으로 실행했다. 후속 사용자 요청으로 [ADR 0142](../../../.mew/docs/decisions/0142-mew-claude-acp-and-cli-authentication.md)에 따라 ACP 채팅과 공식 CLI 인증으로 복원했다. 현행 실행·인증 계약은 [런타임 설정](../configuration/agent-runtimes.md)을 따른다. 동시에 예약 작업 등에 쓰는 ACP spec과 `@agentclientprotocol/claude-agent-acp@0.65.0` 의존성이 남아 있고, 이것이 `@anthropic-ai/claude-agent-sdk@0.3.220`을 포함한다. ACP 어댑터는 Apache-2.0이지만 SDK와 플랫폼 패키지는 Anthropic 별도 계약을 가리킨다. 어댑터의 라이선스를 SDK에 그대로 적용할 수 없다.

검토일의 [공식 법률·컴플라이언스 문서](https://code.claude.com/docs/en/legal-and-compliance)는 다음을 구분한다.

- 원본 Claude Code를 호스팅하는 경로: 상업 약관 수락, 바이너리 무수정, 내장 인증 선택지 보존, 사용자 자신의 자격증명·공급자 직접 청구 등의 조건. 사용자가 원본 CLI에서 직접 구독 로그인을 하는 경우까지 일괄 금지라고 해석하지 않는다.
- 자체 SDK 제품 경로: API 키 또는 지원 클라우드 인증을 기준으로 검토한다. 플랫폼이 사용자 대신 Claude 구독 토큰을 수집·저장·중계하거나 사용량을 재판매할 수 있다고 전제하지 않는다.

Mew 호스팅 요금과 Claude 사용료를 분리하는 모델이 검토 출발점이다. "Mew 요금에 Claude 구독 사용량 포함"이나 SDK 기반 예약 작업에 구독 로그인을 재사용하는 모델은 별도로 계약 적합성을 확인한다. 공급자 토큰을 저장하지 않는다는 사실만으로 SDK 호스팅·재배포 계약까지 충족한 것은 아니다.

SDK 자체는 고객용 제품에 활용할 수 있다고 공식 안내가 설명하므로, 비오픈소스 의존성이라는 이유만으로 Mew의 상업 이용 전체가 금지된다고 결론 내리지 않는다. 다만 SDK 기반 기능의 명칭·로고는 별도 지침 대상이다. 공식 CLI 안내와 SDK 기능을 모두 "Claude Code"로 표시해도 되는지 구분해야 한다. 근거: [SDK 이용 조건·브랜딩](https://code.claude.com/docs/en/agent-sdk/overview), [상업 약관](https://www.anthropic.com/legal/commercial-terms).

Codex·Cursor·Antigravity·그 외 선택 런타임의 코드 라이선스와 구독/API 서비스 이용 계약도 분리한다. 이번 검토에서 모든 공급자의 클라우드 재판매·호스팅 조건을 승인한 것은 아니다. 최초 유료 상품에서 실제 제공할 런타임과 인증·청구 주체를 확정한 뒤 그 범위만 계약표로 완성한다.

### 3. 배포물별 제3자 고지·소스 제공 산출물이 미완성

루트의 Mew MIT 파일은 제3자 패키지 고지를 대신하지 않는다. 현재 추적 파일에서 Mew 전체를 대상으로 한 SBOM·제3자 고지 산출물과 이를 생성·검증하는 릴리스 경로를 찾지 못했다. 기존 공개 준비 계획에도 이 작업이 릴리스 게이트로 남아 있다.

소스 clone 후 사용자가 upstream에서 설치하는 경우, 브라우저에 전달하는 JS·WASM, 완성된 네이티브 설치 파일, 향후 VM 이미지·컨테이너 배포는 서로 확인할 구성 요소와 의무가 다르다. 서버에서만 실행하는 코드와 클라이언트에 사본을 보내는 코드를 구분해야 한다. [Mozilla의 배포 설명](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)도 서버 실행과 클라이언트 전달을 구분한다.

권고 산출물은 배포 버전별 패키지·버전·출처·라이선스·원문 고지를 담은 목록, 필요한 NOTICE, 해당 라이브러리의 정확한 소스·패치·빌드 정보다. 앱의 고지 화면이나 배포 파일에서 접근 가능하게 하고, 프런트엔드 번들링 후에도 실제 포함 여부를 확인한다. SBOM 목록만으로 원문 고지·소스 제공 의무가 충족되지는 않는다.

## 의존성·자산 확인 범위

루트 npm lock의 외부 설치 경로 **552개**, 원격 데스크톱 npm lock **151개**, Rust lock의 registry 패키지 **68개**를 검토했다. npm 수에는 여러 OS의 선택 패키지와 중복 경로가 포함되며, 실제 배포물 수나 실행 중인 패키지 수가 아니다. `dev` 플래그만으로 배포 포함 여부를 확정하지 않았다. Rust는 로컬 Cargo manifest 58개와 crates.io 버전 메타데이터 10개를 확인했다. 메타데이터 전수 확인은 각 바이너리 안의 모든 제3자 코드를 검사한 것과 다르다.

| 범위 | 확인 결과 | 남은 배포 조치 |
| --- | --- | --- |
| React·Tiptap·CodeMirror·Yjs·xterm 등 | 잠금 파일상 주로 MIT·Apache·BSD·ISC | 번들에 포함된 저작권·고지 보존. 유료 Tiptap 제품 사용 여부와 일반 MIT 패키지를 혼동하지 않음 |
| Claude Agent SDK 및 OS 패키지 | 별도 Anthropic 계약 | 위의 CLI/SDK·인증·청구 경계를 확정 |
| sharp 0.34.5와 플랫폼 sharp-libvips 패키지 1.2.4 | sharp Apache-2.0, 사전 빌드 libvips 배포물 LGPL-3.0-or-later. 일부 패키지는 여러 라이선스의 AND 조합 | 바이너리 재배포 시 LGPL 원문·고지, 대응 소스, 연결 방식별 재결합/교체·디버깅 권리 확인 |
| lightningcss 1.32.0 및 플랫폼 패키지 | MPL-2.0 | 현재 Tailwind 빌드 경로. 생성 CSS를 곧바로 MPL로 취급하지 않음. 라이브러리 자체를 배포할 경우 해당 파일의 소스 접근·고지 확인 |
| busboy 1.6.0·json-bignum 0.0.3·streamsearch 1.1.0 | npm 메타데이터 누락, 설치 패키지 LICENSE 본문은 MIT | 누락을 금지 라이선스로 오판하지 말고 실제 원문 고지를 수집 |
| 원격 데스크톱 helper와 Electron | 별도 [배포 검토](../development/remote-desktop-distribution.md)가 있음. 현재 helper는 미커밋 변경 포함 | Electron 내부 Chromium·FFmpeg 등의 조건 유지. MIT 한 줄로 전체 런타임을 표시하지 않음 |
| Rust collab | 확인한 68개에 MIT·Apache 등 허용적 선택지가 있음. unicode-ident는 Unicode-3.0 의무도 포함 | `OR`는 허용하는 라이선스를 선택하고 `AND`는 모두 준수. `r-efi`의 LGPL 선택지를 필수 LGPL 의무로 오판하지 않음 |
| 내부 packages 5개와 Cargo manifest | 개별 `license` 필드 없음 | 루트 LICENSE가 있는 모노레포 사용과 독립 게시를 구분. 독립 배포 시 메타데이터·LICENSE 동봉 정리 |
| RAG 모델 | 기본값 `Xenova/multilingual-e5-small`. 변환 모델 카드에 독립 license 필드 없음. 원본 `intfloat/multilingual-e5-small`은 MIT 표시 | 변환 배포물의 원본 고지·변환물 권리 근거와 모델 revision을 확인. 모델을 포함한 이미지 배포 전 정확한 파일 목록·고지 고정 |
| 웹폰트·AI 브랜드 아이콘 | Google Fonts 원격 로딩, `@lobehub/icons-static-svg` MIT 메타데이터 | 실제 폰트를 자체 포함하면 폰트별 원문 고지 수집. 아이콘 패키지 라이선스는 브랜드 상표 사용 허락을 대신하지 않음 |

근거: 설치된 패키지 LICENSE와 lock, [sharp-libvips 제3자 고지](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md), [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/), [변환 모델 카드](https://huggingface.co/Xenova/multilingual-e5-small), [원본 모델 카드](https://huggingface.co/intfloat/multilingual-e5-small), [Lobe Icons](https://github.com/lobehub/lobe-icons).

이 메타데이터 범위에서 Mew 전체를 GPL/AGPL로 바꾸도록 명백히 요구하는 직접 의존성은 찾지 못했다. LGPL·MPL은 상업 이용 금지가 아니며 조건 준수 하에 MIT 프로젝트와 함께 사용할 수 있다. 단, 내장 바이너리·모델·브랜드 권리와 최종 배포물 검토는 별도로 남는다.

## 9월 말까지의 후속 순서

1. **공개 홍보 전:** Oreo Cat 과거 객체의 공개 접근 해결과 권리 근거 확보. 코드·외부 자산의 실제 저작권 귀속 확인.
2. **라이선스 방향 확정:** 기업 내부 사용·비공개 수정·무료 재배포 허용, Mew 자체의 판매·유료 호스팅 제한이라는 사용자 요구에 맞는 조건을 검토. 변경한다면 중앙 ADR을 먼저 작성하고 LICENSE·메타데이터·기여 정책을 일관되게 반영. 옛 MIT 버전의 이용 권한은 별개로 설명.
3. **릴리스 후보 고정:** 현재 미커밋 상태와 공개 main의 차이를 정리한 뒤, OS·CPU·배포 형태별 실제 산출물을 기준으로 SBOM·제3자 고지·필요한 소스 제공을 검증. 이 문서의 숫자를 영구적인 승인 목록으로 사용하지 않음.
4. **클라우드 상품 정의:** Mew 운영비와 AI 공급자 사용료, 공식 CLI와 SDK 기능, 사용자의 자격증명과 서비스 운영자 자격증명의 범위를 문서화. 미확인 공급자 기능은 최초 유료 상품의 제공 범위에서 제외하거나 계약 확인 후 제공.
5. **외부 기여·브랜드 준비:** 기여 권한 절차와 Mew 공식 서비스/포크의 구분 원칙을 작성. 상표의 실제 등록 가능성·침해 여부는 별도 확인하며 MIT가 이름의 독점권을 확보해 주지는 않음.

클라우드 이용약관·개인정보 처리·환불·책임 범위는 OSS LICENSE와 별도의 계약 작업이다. 또한 현재 보안 모델은 manager/owner에게 호스트 셸 권한을 주므로, MIT의 상업 이용 허용을 공용 멀티테넌트 배포 승인으로 해석하지 않는다. 고객별 격리 구조는 별도 설계 대상이다([SECURITY](../../SECURITY.md)).

이번 작업은 검토 문서만 추가한다. 법률적 해석은 출시 판단을 돕는 예비 검토이며, 권리 귀속·실제 공급자 계약·비표준 라이선스 채택은 해당 원문과 계약 당사자 정보를 갖춰 전문 검토로 확정한다.
