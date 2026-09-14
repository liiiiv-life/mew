---
title: "Zed 외부 에이전트 비교와 Mew RAG 모델의 상업 이용 검토"
created: 2026-09-14
updated: 2026-09-15
---

# Zed 외부 에이전트 비교와 Mew RAG 모델의 상업 이용 검토

[진행 작업](MOC.md) · [전체 라이선스 검토](open-source-cloud-license-review.md) · [Electron 상세](../development/remote-desktop-distribution.md)

검토일은 2026-09-14다. 사용자는 다른 프로젝트의 코드를 직접 복사한 적이 없다고 확인했다. 이를 출처에 관한 사용자 진술로 기록하며, 미확인 수동 복사 프로젝트를 가정해 출시 조건을 추가하지 않는다. 패키지·모델·런타임의 원래 라이선스 확인은 계속 적용된다. 이 검토 후 사용자가 Claude ACP 복원을 요청했고 [ADR 0142](../../../.mew/docs/decisions/0142-mew-claude-acp-and-cli-authentication.md)로 반영했다. 아래 초기 비교의 terminal 상태는 변경 전 기준이며, 현행 인증·설정은 [런타임 설정](../configuration/agent-runtimes.md)을 따른다. 유료 클라우드 계약에 대한 미확인 범위는 그대로다.

## 결론

- **AI 도구 통합 자체를 상업 이용 불가로 볼 근거는 없다.** Zed는 공개 ACP 어댑터를 사용하며 외부 에이전트의 계약·청구를 이용자와 공급자 사이에 둔다. Mew도 이 구조를 참고할 수 있다.
- **외부 에이전트 연결과 AI 사용량 판매는 별개다.** Mew 환경 운영비에 과금하면서 사용자가 자기 AI 계정으로 인증하는 방식과, Mew가 AI 사용량을 매입·판매하는 방식은 다른 계약 검토다.
- **RAG 원본 모델의 상업 이용 근거는 MIT로 확인된다.** Xenova 변환본은 원본 출처를 밝히지만 독립적인 LICENSE·license 메타데이터가 없다. 변환본 고지·버전 증빙을 보완하거나 공식 원본으로부터 배포 경로를 확정한다.
- **Electron은 유료 제품에 사용할 수 있다.** 정확한 배포물에 포함된 제3자 조건을 지켜야 한다. 공식 Linux x64 44.3.0 ZIP과 SHA-256을 확인한 상세는 [원격 데스크톱 배포 문서](../development/remote-desktop-distribution.md)에 기록했다.

## 1. Zed가 통합하는 방식

Zed의 2025-09-03 발표는 Claude SDK를 별도 프로세스로 실행하는 ACP 어댑터를 만들었으며, 다른 편집기도 사용할 수 있도록 Apache 라이선스로 공개했다고 설명한다. 특정 편집기만 쓸 수 있는 비공개 어댑터로 보지 않는다. 현재 `@agentclientprotocol/claude-agent-acp`도 공식 Claude Agent SDK를 사용하는 ACP 어댑터다. [Zed 최초 발표](https://zed.dev/blog/claude-code-via-acp), [어댑터 원본](https://github.com/agentclientprotocol/claude-agent-acp).

최신 Zed 문서는 외부 에이전트가 런타임·인증·모델·설정을 맡고, 공급자와 사용자 사이에 과금·법률 조건·데이터 처리 관계가 있다고 설명한다. Zed는 외부 에이전트에 과금하지 않는다. Registry에서 설치하는 구조이며, Registry의 Apache-2.0이 개별 에이전트의 라이선스를 대신하지 않는다. [외부 에이전트 문서](https://zed.dev/docs/ai/external-agents), [ACP Registry](https://github.com/agentclientprotocol/registry).

| 항목 | Zed의 공개된 방식 | Mew 현재 코드와 시사점 |
| --- | --- | --- |
| UI·통신 | ACP 클라이언트와 별도 에이전트 프로세스 | Mew도 ACP 사용. 어댑터 코드를 상용 앱에 쓰는 것 자체는 허용적 라이선스 범위 |
| 설치 | Registry에서 외부 에이전트 설치 | Mew는 Claude/Codex 어댑터가 루트 npm 의존성이고, 다른 CLI는 개별 설치 명령도 제공. 설치 위치 차이를 기록 |
| Claude 대화 | Claude Agent 또는 terminal thread | Mew의 대화형 Claude는 공식 CLI의 terminal 화면. 별도로 ACP spec이 있어 예약·비대화형 실행도 검토해야 함 |
| Codex 대화 | 외부 에이전트가 자체 로그인·과금 | Mew는 Codex ACP + 호스트 Codex CLI를 지정하며 사용자 계정 경계를 확인해야 함 |
| 제공 장소 | 사용자 개발 환경의 도구 연결을 설명 | Mew는 클라우드 제공도 계획. 서로 다른 고객에게 서버 프로세스·홈·자격증명을 공유하면 동일 조건으로 볼 수 없음 |
| AI 요금 | 외부 에이전트 사용료는 공급자 관계 | Mew 환경·보관·백업 요금과 공급자 AI 사용료를 분리하는 상품을 권고 |

Zed는 별도로 Zed-hosted 모델을 제공하고 사용량에 과금한다. 이것은 외부 에이전트 연결과 다른 상품이다. 공개된 요금표만으로 Zed와 공급자 사이의 계약 내용을 추정하거나 Mew에도 같은 재판매 권리가 있다고 단정하지 않는다. [Zed-hosted 모델](https://zed.dev/docs/account/zed-hosted-models), [청구 문서](https://zed.dev/docs/account/billing).

## 2. Claude — 사용자 구독과 공급자의 상업 계약을 함께 읽기

**사용자가 SDK·ACP를 자기 구독으로 사용하는 것이 모두 금지됐다는 설명은 부정확하다.** Anthropic의 2026-06-15 변경 보류 공지는 SDK·`claude -p`·제3자 앱 사용이 기존 구독 한도에서 계속 처리된다고 설명한다. Zed도 06-16 업데이트에서 이를 반영했다. 두 페이지의 아래쪽에 보존된 옛 별도 크레딧 설명을 시행 중인 정책으로 읽지 않는다. [Anthropic 최신 공지 상단](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [Zed 정정 공지](https://zed.dev/blog/anthropic-subscription-changes).

동시에 Anthropic 법률 문서는 **원본 Claude Code를 제품·호스팅 환경에서 제공하는 조건**을 명시한다. 상업 약관을 따르고 바이너리와 내장 인증 선택지를 보존하며, 이용자가 자신의 자격증명으로 인증하고 직접 사용료를 부담하는 구조다. 제3자가 구독 토큰을 수집·중계하거나 사용량을 대신 판매하는 권한과는 다르다. [공식 호스팅·인증 조건](https://code.claude.com/docs/en/legal-and-compliance).

SDK 제품 안내에는 사전 승인 없는 자체 제품의 claude.ai 로그인·구독 한도 제공을 제한하고 API 인증을 안내하는 문구도 남아 있다. 따라서 개인의 SDK 구독 사용 안내를 **상업 플랫폼의 모든 SDK 로그인·청구 방식에 대한 허가**로 확장하지 않는다. Zed의 이용 사례나 실제 로그인 성공만으로 Mew의 계약 적합성이 확정되는 것도 아니다. [SDK 안내](https://code.claude.com/docs/en/agent-sdk/overview).

Mew에 대한 권고는 다음과 같다.

1. 공식 CLI terminal: 원본 CLI와 공급자 자신의 로그인 흐름을 유지하고, 사용자별 실행·자격증명을 격리한다. 호스팅 조건상 내장 API/구독 인증 선택지를 Mew가 임의로 차단하는 방식은 피한다.
2. Mew가 관리하는 SDK·ACP 자동화: 최초 유료 제공 시 사용자 자신의 API 또는 지원 공급자 인증을 기준으로 구성한다. 구독 기반 상업 호스팅도 제공하려면 위 두 문서의 적용 경계를 실제 구조로 확인한다. 개인 셀프호스팅의 구독 사용까지 금지하는 정책으로 확대하지 않는다.
3. 운영자 구독 한 계정을 여러 고객에게 나눠 주거나 "Claude 무제한 포함" 상품으로 판매하지 않는다. 자체 AI 사용량 상품은 그에 맞는 공급자 계약·청구 구조로 별도 설계한다.
4. SDK 기반 기능과 공식 CLI 안내의 명칭·로고를 구분한다. SDK의 브랜드 지침과 원본 CLI를 설명하는 표시는 적용 범위가 다르다.

현재 [agentRuntimes.ts](../../server/agentRuntimes.ts)의 Claude는 `surface: 'terminal'`이고 `spec: claudeSpawnSpec`도 있다. ACP는 기본적으로 `@agentclientprotocol/claude-agent-acp@0.65.0`과 SDK `0.3.220`을 설치한다. `MEW_AGENT_CONFIG_DIR`을 지정하지 않으면 호스트 계정의 인증 환경을 사용할 수 있으므로, 현재 소규모 신뢰 사용자 모델을 그대로 불특정 고객에게 제공하는 것은 이 비교에서 승인하지 않는다.

## 3. Codex와 다른 외부 에이전트

OpenAI의 공식 App Server 문서는 자기 제품에 인증·대화 이력·승인·이벤트를 통합하는 용도로 이를 소개하고, Codex가 관리하는 ChatGPT 로그인과 API 키 인증을 설명한다. 따라서 Codex를 외부 편집기에서 연결하는 것 자체가 금지된다는 해석은 맞지 않는다. 지원되는 인증과 각 계정·조직의 정책을 따르며, 도구 통합 지원을 계정 공유·사용량 재판매 허가와 동일시하지 않는다. [App Server](https://learn.chatgpt.com/docs/app-server), [인증](https://learn.chatgpt.com/docs/auth).

현재 Mew의 Codex ACP 어댑터는 Apache-2.0이며, 기본 실행은 어댑터가 가져온 CLI보다 호스트의 Codex를 지정한다. OpenAI가 공개한 CLI·SDK·App Server의 소스 위치는 [공식 OSS 목록](https://learn.chatgpt.com/docs/open-source)에서 확인할 수 있다. Zed의 Codex 연결도 에이전트 자체 인증·과금 관계를 이용한다.

Cursor·Kimi·Antigravity 등은 Zed나 Registry에 표시된다는 사실만으로 Mew의 유료 클라우드 제공 조건이 일괄 승인되지는 않는다. Mew가 실제 출시할 런타임마다 코드 배포 조건과 서비스 계정 조건을 연결하면 된다. 이번 요청은 Zed 통합 구조와 Claude/Codex의 비교이며 모든 공급자 계약의 전수 검토가 아니다.

### Antigravity 공식 ACP — 2026-09-15 추가 확인

Google이 제작자로 등록된 독점 라이선스의 `antigravity-acp` 1.1.1을 `dl.google.com`에서 배포한다. Zed는 이 실행 파일을 ACP Registry로 설치하고, Google 공식 Zed 문서는 개인 Free·Pro·Ultra 계정의 `oauth-personal`과 Enterprise/API 인증을 안내한다. 이 공식 연결 지원을 비공식 OAuth 토큰 추출·API 프록시 허가로 해석하지 않는다. [Google 공식 연동 문서](https://antigravity.google/docs/ide/extensions/zed/), [등록 설정](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json).

사용자의 구현 요청에 따라 [ADR 0143](../../../.mew/docs/decisions/0143-mew-antigravity-official-acp.md)으로 terminal 전용 결정을 변경했다. Mew는 바이너리를 소스에 포함하지 않고 공식 배포처에서 설치하며, 인증은 공식 ACP 서버가 소유한다. 현재 설치·설정·검증 범위는 [런타임 설정](../configuration/agent-runtimes.md#antigravity-공식-acp)이 기준본이다.

## 4. RAG 변환 모델이 무엇인지

[embeddings.ts](../../server/rag/embeddings.ts)는 문서와 검색어를 **384개 숫자의 벡터**로 바꾼다. 답변을 생성하는 채팅 모델이 아니라 관련 문서를 찾는 임베딩 모델이다. 현재 경로는 다음과 같다.

```text
Microsoft E5 원본: intfloat/multilingual-e5-small
  → Xenova가 Transformers.js용 ONNX·양자화 파일로 변환
  → @huggingface/transformers 3.8.1이 q8 파일을 로드
  → Mew 서버에서 문서·검색어 임베딩 실행
  → LanceDB의 검색용 벡터와 비교
```

현재 구현은 `Xenova/multilingual-e5-small`, `dtype: 'q8'`, 평균 pooling, normalize를 사용한다. 설치된 Transformers.js의 q8 파일 접미사는 `_quantized`이므로 기본 대상은 `onnx/model_quantized.onnx`다. 모델 캐시는 `DATA_DIR/rag/models`에 둔다. 서버에서 추론하므로 이 코드 경로 자체는 문서 본문을 Hugging Face 추론 API에 보내지 않는다. 모델 다운로드 네트워크와 문서 추론 위치를 구분한다.

## 5. RAG 권리 근거·정확한 버전

| 확인 대상 | 확인 결과 |
| --- | --- |
| 원본 모델 | 모델 카드에 `license: mit`. Microsoft UniLM의 E5 README가 이 모델을 연결하며 프로젝트 루트 MIT를 안내 |
| 원본 현재 revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| 변환 모델 | 모델 카드에 원본 모델·Transformers.js용 ONNX 변환임을 명시. `license` 필드와 별도 LICENSE 파일은 없음 |
| 변환본 현재 revision | `761b726dd34fb83930e26aab4e9ac3899aa1fa78` |
| 변환본 q8 파일 | `onnx/model_quantized.onnx`, 118,308,185 bytes. Hub LFS oid: `f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193` |
| 원본 ONNX | 공식 원본 저장소에도 `onnx/model.onnx`와 최적화·특정 CPU용 양자화 파일이 있음 |
| Mew의 버전 고정 | `pipeline()`에 revision을 전달하지 않아 기본 `main` 사용. 설치별 캐시가 어느 revision인지 이번에 동일성을 검증하지 않음 |

근거: [원본 모델 카드](https://huggingface.co/intfloat/multilingual-e5-small/blob/614241f622f53c4eeff9890bdc4f31cfecc418b3/README.md), [E5 README](https://github.com/microsoft/unilm/blob/master/e5/README.md), [UniLM MIT](https://github.com/microsoft/unilm/blob/master/LICENSE), [변환본 카드](https://huggingface.co/Xenova/multilingual-e5-small/blob/761b726dd34fb83930e26aab4e9ac3899aa1fa78/README.md), [변환본 파일 목록](https://huggingface.co/Xenova/multilingual-e5-small/tree/761b726dd34fb83930e26aab4e9ac3899aa1fa78/onnx).

모델 가중치를 다운로드해 해시를 재계산한 것은 아니다. 파일 크기·LFS oid는 Hub의 해당 revision 메타데이터를 읽은 결과다. 원본 MIT는 상업 이용·변환·재배포의 근거이며, 단순 포맷 변환을 이유로 상업 이용이 금지된다는 증거는 찾지 못했다. 다만 원본 고지 보존과 변환물의 독자 기여·자산 범위는 실제 배포 목록으로 남겨야 한다. 메타데이터 공백을 임의로 MIT 승인으로 바꾸거나 상업 이용 금지로 단정하지 않는다.

### 권고하는 보완

1. 출시 모델의 revision, 파일명, 해시, 원본 MIT·출처를 고정한다. 라이브러리 라이선스와 가중치 라이선스를 별도로 기록한다.
2. 현재 Xenova 변환본을 계속 사용한다면 원본 고지와 변환물의 허가 범위를 문서·upstream 자료로 보완한다. 소스를 다운로드하는 방식도 그 파일을 사용할 권리까지 대신하지는 않는다.
3. 변환본 고지의 불확실성을 줄이려면 **공식 원본 저장소의 ONNX를 검증하거나, MIT 원본을 직접 변환·양자화**하는 경로를 권한다. 직접 변환은 저작권 고지와 도구 라이선스까지 함께 보존한다.
4. 단순히 환경변수의 모델 이름만 바꾸지는 않는다. 원본에는 Mew q8 기본 파일명인 `model_quantized.onnx`가 없고, `model_qint8_avx512_vnni.onnx`는 특정 CPU를 전제로 한다. 파일 매핑, CPU·메모리, 출력 차원, pooling·normalize, 기존 검색 품질을 검증해야 한다. 모델·양자화 변경으로 임베딩 공간이 달라지면 기존 색인을 재생성한다.

Mew가 원본 MIT 모델로 유료 검색 기능을 제공할 수 있다는 판단과, 현재 변환 배포물의 증빙을 완성하는 작업은 구분한다. 이번에는 모델 교체·추론 실행·재색인을 수행하지 않았다.

## 완료 전 남은 구체적 산출물

| 영역 | 필요한 산출물 |
| --- | --- |
| 에이전트 | 출시 런타임·버전별 설치/실행 주체, 인증 소유자, 사용료 청구 주체 표. 고객별 실행 환경 분리 |
| RAG | 고정한 모델 revision·파일 해시와 원본·변환 고지. 교체한다면 호환성·검색 품질 검증 |
| Electron | 배포 OS별 공식 아카이브 해시·고지. 바이너리를 묶거나 재호스팅하면 대응 소스·빌드 정보·라이브러리 권리 준수 자료 |

직접 복사 코드가 없다는 사용자 확인을 반영했고, 이 문서는 "Zed가 하니까 무조건 허용"이나 "비오픈소스 SDK라서 통합 금지"라는 양쪽 단정을 모두 피한다. 판단 기준은 실제 배포물과 계정·계약 관계다.
