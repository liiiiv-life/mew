---
description: "로그인 계정에 귀속하는 에이전트 커밋 작성자, 프로젝트 안내 전달과 기본 활성화 디버거 활용 설정, 에이전트 세션·탭 원장·삭제 시 감독 종료·큐·재접속, Git AI Commit 작업과 CLI·메모리·뮤캣 통신의 서버 계약을 정의한다."
---
# 에이전트 세션과 통신 계약

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../guides/getting-started-ko.md)

일반 에이전트의 자동 커밋은 새 감독·ACP 세션을 시작한 로그인 계정의 작성자 환경을 상속한다. 연결된 GitHub 정보 또는 Mew 프로필을 사용하며 재접속으로 계정이 바뀌지 않는다. 기존 감독은 새 탭에서 시작해야 적용된다. 인증·환경·검증 경계는 [계정별 Git 실행](git-connections.md#git-실행-경계)을 따른다.

## 프로젝트 컨텍스트 전달

기능 요청의 프로젝트별 큐·독립 탭·공통 CLI·완료 판정은 [기능 기반 개발](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EA%B8%B0%EB%8A%A5%20%EA%B8%B0%EB%B0%98%20%EA%B0%9C%EB%B0%9C%C2%B7Markdown%20%EB%AC%B8%EC%84%9C.md#실행과-복원)을 따른다. 접수 때 캡처한 프로젝트·Documents 연결을 감독 시작 시 전달한다.

[사용법과 설정 계약](../guides/project-setup.md) · [ADR 0155](../../../.mew/docs/decisions/0155-mew-project-agent-context.md).

- 공통 원문은 `DATA_DIR/agent-guidance.md`, 최초 생성은 기존 `agent-guidance.txt` → `server/prompts/agent-guidance.txt` 순서다. 기존 MD·TXT를 덮어쓰지 않으며 미리보기는 생성 없이 같은 우선순위로 읽는다. `GET /api/fs/agent-guidance`는 `serverFiles` 권한으로 `{ path, content, revision, settings }`를 반환한다. `PUT`은 `{ key, value, revision }`으로 MD의 해당 설정 구간만 원자적으로 교체한다. key는 `commit`·`language`·`detail`·`subagents`·`debugger`, 알 수 없는 값은 400, 원문 revision 불일치·설정 구간 손상은 409다. 설정의 별도 JSON 사본은 없으며 원문에서 값을 읽는다. `subagents`는 `inherit`·`automatic`·`explicit`·`never`를 받으며 `mew:agent-setting:subagents` 구간만 바꾼다. 구간이 없으면 `inherit`, 직접 편집한 문구는 `custom`으로 읽는다. 자동 위임은 독립적인 작업 분담·공유 파일 조율·결과 검토를 안내하고, 런타임 설정이나 권한은 변경하지 않는다. 편집은 기존 `/api/fs/file`과 외부 파일 탭을 사용한다. 해당 MD의 에디터 저장은 `expectedContent`가 전달되면 원문과 비교해 오래된 초안의 덮어쓰기를 409로 막는다. 설정창 읽기·저장은 `mew:external-file-updated`로 열린 깨끗한 탭을 갱신하고 미저장 탭은 보존한다. 공통 파일 저장은 원자적 교체로 독립 감독이 저장 도중 빈 내용을 읽지 않게 한다. 진입은 에이전트 패널 Skills·MCP 옆 기본 지침 버튼이며 저장·적용 범위는 [공통 안내 파일](../guides/project-setup.md#공통-안내-파일-편집)을 따른다.
- `debugger`는 `enabled`·`disabled`를 받으며 `mew:agent-setting:debugger` 구간만 교체한다. 구간이 없으면 설정 조회에서 `enabled`로 표시하고 컨텍스트 읽기에서 기본 영어 지침을 보충하되 저장 원문과 revision은 바꾸지 않는다. 빈 원문도 같은 기본값을 적용한다. 비활성화·직접 편집 구간은 보존하고 손상된 표시가 있으면 기본 안내를 중복 삽입하지 않는다. 선택값은 디버거 활용 지침이며 어댑터 설치·시작이나 권한 변경을 수행하지 않는다.
- `AgentSession.#run`은 사용자 프롬프트·첨부와 별도의 ACP 텍스트 블록으로 mew 안내를 보낸다. `agent-context.ts`가 세션에 고정된 프로젝트·Documents 경로와 실행 시점의 설정을 조합한다. 큐·예약·단발 runner도 이 경로를 공유한다.
- 분리 감독을 띄우기 전에 부모가 연결 정보를 캡처해 `MEW_AGENT_CONTEXT`로 전달한다. 하위 ACP 프로세스에는 그 환경변수를 제거한다. 반복 예약 명령은 `--context`로 연결을 전달한다.
- `DATA_DIR/agent-contexts/<sha256(runtime,cwd,sessionId)>.json`에 경로만 저장한다. 기록 복원은 저장된 연결을 사용하고 새 대화는 같은 프로젝트의 최신 Documents 설정을 해석한다. 세션 중에는 화면 전환으로 연결을 바꾸지 않는다.
- mew 전사에는 사용자 원문을 보존한다. ACP 히스토리의 사용자 텍스트에 돌아온 `<mew-context version="1">` 블록은 표시 전에 제거한다. 안내는 시스템 권한이나 문서 읽기 검증을 가장하지 않는다.
- `project-setup.ts`의 계획·적용 로직을 owner API(`/api/docs/agent-context`)와 `project-setup-cli.ts`가 공유한다. API는 현재 프로젝트 경로를 검증하고, 적용 시 미리보기 revision을 다시 비교한다. `wx` 생성으로 기존 문서와 경쟁 생성 파일을 보존한다.
- 자동 안내 실패 시 다른 프로젝트로 fallback하여 작업하지 않고 오류를 알린다. 설정 JSON·문서 연결을 고친 뒤 다시 요청한다.

## Git AI Commit 작업

- 계정별 Git 연결이 없으면 작업 시작 전에 로그인한다. 작업 입력에는 소유 계정과 연결 ID만 고정하고 실행 시작·각 커밋 전에 연결 해제/교체를 검사한다. 작성자·토큰 경계는 [Git 연결 계약](git-connections.md)을 따른다.

[ADR 0174](../../../.mew/docs/decisions/0174-mew-commit-skill-and-automatic-commits.md) · [사용법](../guides/projects.md#git-작업-패널).

- `git-ai-commit-routes.ts`는 Git·에이전트 권한과 현재 workspace를 검증한다. 현재 프로젝트 루트 저장소의 선택 파일·작업 UUID·에이전트셋 ID를 받는다. `POST /api/git/ai-commit`은 실제 자동 커밋 실행이며 이전 `/draft` 적용 API는 제공하지 않는다.
- `mew-skills.ts`가 `<DATA_DIR>/skills/commit/SKILL.md`를 최초 한 번만 원자적으로 생성한다. 기본 원본은 `server/prompts/commit-skill.txt`, 이후 사용자 파일이 기준본이다. 시작할 때 최신 파일과 에이전트셋의 런타임·모델·역할을 작업 입력에 고정한다. 동일 파일은 모든 런타임의 `/commit` 후보와 프로젝트 안내에도 연결한다. 안내 자체는 커밋 승인이 아니다.
- `git-ai-commit.ts`는 별도 임시 인덱스로 선택 파일의 전체 Git 트리를 캡처한다. 실제 index는 건드리지 않는다. 선택 파일의 기존 stage, 최종 작업트리 diff, 최근 15개 커밋 제목을 AI에 제공한다. 24,000자를 넘거나 160,000자/출력 버퍼 4MB에서 잘린 입력은 아래 전체 압축 경로로 전환한다. 기존 stage는 큰 변경 모드에서 최대 12,000자의 참고 발췌로 제공하며 실제 커밋 대상은 작업트리 스냅샷이다. 외부 diff·textconv는 실행하지 않는다. 바이너리·삭제·이름 변경도 전체 트리와 index 항목으로 변경 여부를 검사한다.
- `git-ai-commit-runner.ts`는 작업별 `mewcmd-git-<id>` tmux에서 독립 ACP 세션을 실행한다. `mew-commit-plan` 모드로 공통 스킬을 전달하고 `end_turn`·JSON `{commits:[{title,description,files}],skipped:[{file,reason}]}`를 검증한다. 모든 선택 파일은 정확히 한 번 배정돼야 한다. 도구 승인 요청은 거절하며 별도 OS sandbox를 추가하지 않는다.
- `git-commit-analysis.ts`는 고정 Git 트리의 3줄 문맥 diff를 최대 48,000자 조각으로 끝까지 읽는다. `git-commit-packets.ts`는 공통 before/after 문자·반복 줄·동일 변경 사전을 사용해 모든 조각을 무손실 표현한다. 각 조각을 즉시 복원해 원문과 일치하는지 검사한다. 모드·EOF·Unicode·주어진 문맥을 유지하며 발췌 개요를 사용하지 않는다. 96,000자 패킷 예산을 넘으면 다음 패킷으로 분리하고 크기 때문에 근거를 버리지 않는다. 임베딩·추가 모델·색인 서버는 필요 없다. 문자 예산은 로컬 휴리스틱이며 모델별 토큰 수를 보장하지 않는다.
- 전체 압축 근거가 한 패킷이면 바로 계획 호출 1회를 사용한다. 여러 패킷이면 독립 ACP 세션 두 개씩 병렬로 각 패킷 전체를 `mew-commit-evidence`로 한 번씩 분석한 뒤 최종 계획을 만든다. `{changes:[{sources,summary,uncertainties}]}`의 조각 누락·중복·범위 밖 ID를 검증한다. 길이는 권장 목표이며 정상 응답을 권장 길이 초과만으로 거절하지 않는다. 최종 근거가 예산을 넘으면 원본 재전송 없이 기존 근거만 압축하고 같은 커버리지를 검증한다. 실제 JSON 오류나 압축 실패는 작업 실패로 표시한다. 파일이 여러 패킷에 걸쳤다는 이유만으로 `skipped`를 만들지 않는다.
- 필요한 원본은 `{needsDetails:[조각번호들]}`로 회당 최대 2개를 다시 읽는다. 이미 읽은 원문의 중복 요청은 거절하지만 기존 최대 3회 호출 제한은 제거했다. 실제 안전 문제·해소되지 않는 의도만 사유와 함께 남긴다. 같은 런타임·모델·추론 강도의 새 ACP 세션을 사용하고 입력 개수·압축 문자 수·호출 시간을 로그에 표시한다. 실제 커밋은 전체 트리로 만들며 커밋 사이에는 diff 생성 없이 트리·index를 비교한다.
- 기본 에이전트 안내에는 변경 완료/커밋 전 목적 기록을 요청하고, `project-context-text.ts`가 `git-change-intent-cli.ts --cwd <프로젝트>` 명령과 stdin JSON `{purpose,files,verification?}`을 전달한다. 파일은 Git 루트 상대 경로이며 이번 작업의 전체 미커밋 변경만 포함한다. 다른 작업과 섞인 파일은 기록하지 않는다. 주석·대화 원문·시크릿을 추가하지 않고 실제 실행한 검증만 적는다. 기록 실패·Git 없는 폴더는 기록 없이 계속한다. 이 안내는 커밋 승인이나 정식 문서 갱신을 대신하지 않는다.
- `git-change-intent.ts`는 실제 Git dir의 `mew-change-intents/<timestamp>-<uuid>.json`에 프로젝트 공유 메타데이터를 저장한다(파일 600·폴더 700). 목적·선택 경로·이전/새 Git blob와 mode만 저장하며 source/diff를 복제하지 않는다. index·HEAD는 수정하지 않는다. 최근 100개를 유지하고 최근 50개·30일 이내 후보 중 전체 경로와 양쪽 객체가 맞는 최신 힌트만 최대 12,000자로 참고한다. Git 객체는 경로별 프로세스 대신 두 번의 일괄 조회로 비교한다. 관련 없는 HEAD 변경은 허용하고 같은 파일의 추가 편집·이전 상태 차이는 힌트를 무효화한다. 손상·심볼릭 링크 기록은 무시한다. 프로젝트 저장소 접근자가 공유하는 힌트이며 계정별 비공개 대화가 아니다. 기록이 없거나 일치해도 전체 diff 분석과 커밋 직전 검증은 생략하지 않는다.
- 모델명만 저장된 이전 Codex 셋도 `AgentSession.setModel`에서 현재 ACP가 광고한 같은 모델의 추론 강도 포함 ID로 연결한다([모델 호환 규칙](../configuration/agent-runtimes.md#모델권한-기본값과-런타임-선택)). 셋 원본은 수정하지 않는다. 실패 상태와 진행 로그에는 준비·모델 설정·계획 분석·커밋 생성 중 실패 단계를 남기며, ACP의 plain object 오류도 `message`·`code`·`data.details`를 보존해 `[object Object]`로 표시하지 않는다.
- 실행 전과 각 커밋 사이에 HEAD·브랜치·남은 선택 파일의 트리·stage를 재검증한다. `git-commit-files.ts`는 분석한 트리의 해당 그룹만 임시 index에 넣어 커밋하고 실제 index에는 해당 경로만 반영한다. 선택 밖 stage와 작업 내용은 보존하며 Git index lock을 사용한다. 파일 내부 hunk 분리는 하지 않는다. Git hook·서명 설정은 그대로 적용된다.
- 상태는 `<DATA_DIR>/git-ai-commits/<sha256(account,cwd)>/<id>/state.json`, 계정별 최신 작업은 `latest.json`이다. `starting`·`running`·`committing`·`completed`·`failed`·`cancelled`를 사용하고 `mode: commit` 없는 이전 초안은 실행하지 않는다. 같은 계정의 요청 UUID 재전송은 중복 실행하지 않는다. 저장소별 `mew-ai-commit.lock`으로 다른 계정·프로세스의 AI 실행도 배제한다.
- 분석 시간 제한은 10분이다. 취소·실패 시 진행 중인 커밋을 강제로 되돌리지 않는다. 만든 커밋 해시는 매번 저장해 부분 성공을 보존한다. 자식 프로세스·입력 스냅샷·원본 diff 조각이 담긴 작업별 `analysis/`·정상 종료한 작업의 저장소 lock을 정리한다. 조각 파일은 작업 내부 임시 입력이며 영구 문서로 보관하지 않는다. 서버·브라우저 재접속과 관계없이 tmux 작업은 유지한다. 호스트 강제 종료로 남은 Git/AI lock은 다른 Git·AI 프로세스가 없음을 확인한 뒤 제거해야 한다.
- UI는 실제 커밋 결과를 표시하고 변경 목록·로그를 다시 읽는다. 사용자의 수동 제목·설명은 덮어쓰지 않으며 완료 후 자동 push하지 않는다.
- `git-ai-commit.test.ts`는 임시 저장소·모의 ACP·격리 tmux로 분할 커밋·선택 밖 stage 보존·변경 감지·권한·취소·실패·재접속을 검사한다. `git-ai-commit-ui.test.ts`는 데스크톱·모바일 셋 선택·생성·로그·실제 결과 표시·수동 초안 보존·취소·복원을 검사한다. 큰 staged diff의 4MB 초과·전체 원문 복원·무손실 복원·패킷 예산·사전 참조·전량 근거 커버리지·단일 패킷 한 번 호출·일괄 원본 요청·새 세션·원본 재확인·전체 내용 커밋·잘못된 계획/취소/도구 승인/분석 중 편집도 임시 저장소와 모의 ACP로 검사한다. 유료 에이전트의 실제 요약·그룹 판단 품질은 자동 검증하지 않는다.

## 탭 원장과 복원

- 탭 목록·이름·런타임·cwd별 마지막 세션 ID는 **계정에 저장**하고 루트 프로젝트 절대 경로별로 분리한다. 브라우저의 `mew:agent-tabs:<root-path>`는 서버 응답 전 연결에 쓰지 않는 로컬 fallback뿐이다. 저장 PUT은 화면마다 한 번씩 직렬화하며, 전송 중 갱신이 여럿 생기면 마지막 스냅샷만 이어 보내 오래된 응답이 최신 thread 포인터를 되돌리지 못하게 한다. 서버 복원이 끝난 뒤에만 활성 탭의 WS를 붙이므로 localStorage의 낡은 세션으로 먼저 연결하지 않는다. 세션 ID는 탭을 닫을 때 함께 지워지고, 같은 탭에서 런타임이나 cwd를 갈아타면 각 조합의 대화 포인터를 따로 보존한다. 마지막으로 보던 탭도 같은 루트 경로별로 남는다(`mew:agent-active-tab:<root-path>`) — 창을 다시 열거나 브라우저를 껐다 켜면 그 탭이 선다. 열린 패널마다 활성 탭 하나를 연결한다. 복원된 비활성 탭은 처음 선택할 때 연결하며, 숨긴 패널 때문에 새 연결을 시작하지 않는다. 탭 이동·패널 숨김은 이미 열린 연결을 유지한다. 에이전트와 일반 셸은 별도 패널이지만 계정 원장은 컨트롤러 하나가 함께 저장한다. 독 스와이프로 현재 패널의 이전·다음 탭을 전환한다. 패널 열기·닫기는 독·상단 메뉴를, 탭 이동은 탭 바·단축키도 사용하며, 탭 닫기는 탭의 닫기 버튼이나 `Ctrl+W`를 사용한다. 탭 이름은 선택한 런타임 또는 에이전트셋 이름으로 시작하고, 탭을 두 번 누르면 직접 고친다 ([ADR 0093](../../../.mew/docs/decisions/0093-mew-account-synced-project-and-agent-tabs.md)·[ADR 0096](../../../.mew/docs/decisions/0096-mew-agent-tabs-created-after-selection.md)).
  - 새 탭은 선택 후에만 생기므로, 선택 전 히스토리 조회·세션 입력을 위한 빈 탭은 없다. 새 세션은 선택 직후부터 해당 탭에서 시작하며, 지난 세션을 고르는 기능은 탭에서 계속 제공한다
  - 같은 세션을 두 탭에서 열지 않는다(목록에서 잠근다) — 현재 mount된 탭뿐 아니라 같은 계정에 저장된 다른 루트 프로젝트의 숨은 탭까지 한 번의 탭 상태 응답에 포함해 판정한다. 한 전사를 두 프로세스가 붙들면 기록이 엉킨다
  - **대화가 자라도 바닥에 붙어 있을 때만 따라 내려간다**(바닥 판정 여유 48px). 위로 올려 읽는 중이면 자리를 지키고 \*\*\[새 메시지\]\*\*만 띄운다 — 누르면 바닥으로, 스스로 바닥까지 내려가도 사라진다. 내가 프롬프트를 보냈을 때와 세션을 새로 불러왔을 때(`reset`)는 다시 바닥에 붙인다
  - **탭을 닫는 것만 세션을 끝낸다**(`close_session`). 창을 닫는 것과 다르다. 안 보고 있는 탭도 WS는 붙어 있고(돌던 대화가 멎으면 안 된다), 한 번이라도 연 탭만 붙인다(복원된 탭을 한꺼번에 띄우지 않는다)
  - `PUT /user-ui/agent-tabs`는 저장 전후 탭 ID를 비교해 삭제된 탭의 독립 감독에도 `close_session`을 보낸다. 브라우저 WS가 끊겼거나 복원한 비활성 탭에 sender가 없어도 종료 요청을 전달한다. 현재 runtime/cwd와 저장된 sessionIds의 이전 runtime/cwd 연결을 중복 없이 정리하며, 없는 감독을 새로 띄우지 않는다. 남은 탭·다른 계정의 원장은 건드리지 않는다. 저장 검증 실패 시 종료하지 않으며, 종료 연결 실패는 서버 로그에 남긴다. 감독 종료는 비동기로 진행한다.
  - 열린 탭이 없는데 Codex가 `already has an active writer`로 기록 복원을 거절하면, 탭 원장뿐 아니라 살아 있는 감독의 현재 sessionId도 확인한다. 원장에 없는 감독이고 현재 턴·큐가 비었음을 확인한 경우에만 그 감독에 `close_session`을 보내 점유를 해제한다. 브라우저 연결 단절만으로 감독을 종료하거나 Codex lock 파일을 삭제하지 않는다.
  - **턴 버블 오른쪽에 걸린 시간이 선다** — "15초"·"36분 32초"·"2시간 5분 4초" 꼴. 서버가 `turn_start`에 `startedAt`, `turn_end`에 `durationMs`를 새기므로 되받은 히스토리에서도 그대로 보인다. 돌고 있는 턴은 startedAt부터 지금까지를 1초마다 다시 세고, 시간 정보가 없는 옛 히스토리는 감춘다. 감독이 유휴 종료된 뒤에도 완료 시점에 남긴 전체 이벤트 전사를 다시 써서, 질문·답변·작업 내역과 소요 시간을 보존한다.
  - ACP가 히스토리를 다시 흘릴 때 마지막 `turn_end`를 보내지 않아도, 현재 세션 `meta.busy`가 false면 마지막 턴은 \*\*완료(초록)\*\*로 그린다. meta를 받기 전이나 아직 작업 중이면 \*\*진행 중(파랑)\*\*을 유지한다.

## 메시지·재접속·큐

- **외부 CLI에서 이어 쓴 대화:** `session/load`가 반환한 최신 ACP 전사를 기준으로 복원한다. Mew 저장 전사가 있다는 이유로 전체 ACP 응답을 버리지 않는다. 질문·답변이 같은 완료된 접두 턴만 기존 Mew 이벤트(소요 시간·설정·작업 기록)를 보존하고, 달라진 지점부터는 최신 ACP 이벤트를 사용한다. 사용자 메시지의 모델·노력·권한은 답변 일치 여부와 별도로, 질문 내용과 순서가 같은 접두 턴에서 누락된 값만 복원한다. 따라서 중간 답변 생략이나 `turn_end` 없는 재복원 때문에 같은 설정의 상태버블이 다시 나타나지 않는다. 질문이 달라진 지점 이후나 외부에서 추가한 질문에는 과거 설정을 추정해 붙이지 않는다. ACP가 대화 이벤트를 전혀 재생하지 않는 경우에만 저장 전사로 폴백한다. 전체 복원 뒤 전사를 한 번 저장한다.
- 살아 있는 감독에 재접속하면 감독의 현재 전사를 구간 동기화하므로 외부 CLI 변경을 실시간 감시하지 않는다. Codex **히스토리 → 현재 대화 새로고침**은 같은 세션 ID를 기존 `load_session` 경로로 다시 읽는다. 진행 중인 턴·승인·큐와 겹칠 수 없고, 어댑터 교체는 ADR 0122를 따른다. 다른 탭이 같은 세션을 소유한 경우 새로고침을 허용하지 않는다.
- 어댑터 교체는 종료 요청 뒤 `disposeAndWait()`로 실제 종료를 기다린다. 히스토리 전환뿐 아니라 자동 복원 실패 후 새 세션 생성과 선택한 기록 실패 후 이전 대화 복구에도 적용한다. `session/load`가 writer를 얻고 전사 재생 중 실패할 수 있으므로 실패한 어댑터도 종료 경계를 거쳐야 한다. 감독 로그에는 선택한 기록의 최초 불러오기 오류와 이전 대화 복구 오류를 각각 남긴다.
- 자동 복원과 Codex 히스토리 전환·현재 대화 새로고침은 `initialize`가 `loadSession` 지원을 알리면 빈 `session/new`와 그 기본값 적용을 생략하고 바로 기존 세션을 불러온다. 기본값은 복원된 세션에 적용한다. load 미지원 런타임은 기존 새 세션·인증 경로를 사용한다. 자동 복원 실패는 원래 포인터를 보존하며 새 연결로 폴백하고, Codex 선택 기록·이전 대화 복구가 모두 실패하면 실패한 writer 종료 후에만 새 세션을 만든다. 살아 있는 감독에 단순 재접속할 때는 ACP 초기화나 load 없이 현재 전사의 구간 동기화를 사용한다(구 클라이언트는 replay).
- `<DATA_DIR>/agent/<runtime>-<hash>.log`의 `[mew:agent-timing:<runtime>]`는 `initialize`·`session/new`·`session/load`·`defaults`의 경과 ms와 호출 성공/실패를 기록한다. 타이밍 항목에는 프롬프트·세션 ID·인증 응답을 담지 않는다. `initialize`에는 어댑터가 응답하기까지의 준비 시간, `session/load`에는 ACP 전사 재생 시간이 포함되며 브라우저 렌더링 시간은 포함되지 않는다. `agent-startup.test.ts`는 모의 ACP의 불필요한 new/기본값 호출 제거와 load 미지원·인증을, `agentHost.test.ts`는 writer 반납·복원 실패·인증 만료 폴백을 검증한다.
- `agentHost.test.ts`는 WS가 없는 탭을 원장에서 삭제할 때 현재·이전 cwd 감독 종료, 남은 탭 보존, 다른 계정 저장·잘못된 입력의 비종료와 없는 감독 미생성을 격리 프로세스로 검증한다.

아래는 주요 메시지다. 전체 타입은 [agentWs.ts](../../server/agentWs.ts)의 `ClientMessage`·`ServerMessage`와 [agentAcp.ts](../../server/agentAcp.ts)의 `AgentEvent`를 따른다.

| 방향 | 메시지 |
| --- | --- |
| 클라이언트 → 서버 | `{type:'history', range:{generation,before}}` · `{type:'prompt', text, settings?: {model, thinking, permission}}` · `{type:'cancel'}` · `{type:'permission', id, optionId}` (`optionId`는 문자열 또는 `null`) |
| 서버 → 클라이언트 | `history`(구간·커서·controls) · `history_event`(이벤트·순번) · `{type:'ready', cwd}` · `{type:'replay', events, restored?, restoreFailure?}` · `{type:'update', update, settings?}`(ACP `session/update` 원본 + 사용자 발화 설정) · `{type:'permission', id, toolCall, options}` · `{type:'permission_done', id}` · `{type:'turn_start', startedAt}` · `{type:'turn_end', stopReason, durationMs}` · `{type:'error', message, accessIssue?}` |

- **새 연결은 구간 동기화를 사용한다.** 최근 20개 질문을 먼저 보내고, 같은 generation의 재접속에는 마지막 수신 순번 이후만 보낸다. 위로 스크롤하면 이전 구간을 조회하며 질문·답변 중간을 자르지 않는다. 기기 캐시는 계정별 IndexedDB이고 서버 표시 전사는 SQLite에 증분 저장한다. 구 감독/클라이언트에는 전체 `replay`를 유지한다. 프로토콜·용량·이전·실패 복구·검증은 [대화 저장 계약](conversation-storage.md)을 따른다. 소켓 단절은 대화를 지우지 않는다.

- 로컬 전사 캐시는 탭당 1MiB·전체 4MiB가 상한이다. 긴 대화는 상한 안에 들어가는 최근 이벤트 꼬리만 원형 그대로 저장하고, 서버의 전체 `replay`가 오면 앞부분을 복원한다. 서버 탭 원장 조회 중에는 캐시 텍스트를 먼저 노출하지 않고 빈 말풍선 로딩을 표시하며, 실제 세션 연결은 원장 확인 뒤에만 시작한다. 캐시는 세션 준비 후 대화 버블 복원에 사용한다. 저장 전 오래된 캐시를 정리해 공간을 확보하고 quota 실패 시 전사 캐시만 비워 한 번 재시도한다. 계정 탭 원장에 없는 탭의 `mew:agent-events:*`·`mew:agent-controls:*` 캐시는 탭 동기화 때 지운다.

- 같은 세션의 캐시 병합은 각 이벤트를 한 번 직렬화하고 KMP로 포함 여부와 suffix/prefix 겹침을 찾는다. 반복 청크가 긴 전사에서도 비교 횟수가 이벤트 수에 비례한다. 전체 snapshot이 캐시를 포함하면 서버 전사를 사용하고, 이전 감독의 부분 replay는 기존 앞부분을 보존하며 겹치는 꼬리만 제거한다. 세션 변경·빈 서버 전사·ACP 복원 표식의 교체 규칙은 유지한다. `agentEventCache.test.ts`는 반복 패턴의 모든 짧은 조합과 긴 불일치 전사의 보존을 검증한다.

- **히스토리를 열 때마다** 계정의 모든 루트 프로젝트 탭이 주장한 ACP 세션을 다시 읽는다. 현재 탭 또는 다른 탭이 이미 연 세션은 목록에서 잠가 두므로, 이미 붙은 writer를 다시 `session/load`해 ACP의 `Internal error`가 나는 경로가 없다.

- 히스토리의 `새 대화`는 유휴 여부만 확인하고, 유휴 상태에서는 대화·히스토리 로딩·미처리 프레임을 즉시 비운다. 서버 종료·재접속·새 세션 준비와 목록 조회 완료를 기다리지 않으며, 준비 중에도 빈 대화를 로딩 화면으로 덮지 않는다. 연결 전 전송은 차단하고 입력 초안은 유지한다. 진행 중 작업·큐가 있는 세션의 종료 규칙은 유지한다.
- **창은 들어오는 이벤트를 한 프레임에 모아 한 번만 그린다**(`requestAnimationFrame`). 스트리밍 청크는 초당 수십 개다. `reset`도 그 줄에서 순서대로 처리돼 "비우기"와 "새 대화"가 같은 프레임에 들어간다.

- `meta`**·**`sessions`**·**`reset`**은 이벤트 버퍼에 쌓지 않는다.** `meta`는 상태 스냅샷이라 붙을 때·바뀔 때 통째로 보내고(`sessionId`·`startedAt`·`turns`·`busy`·`queued`·`usage`·`canLoad`·`canList`), `sessions`는 **물어본 창에만, 물어봤을 때만** 답한다(claude 런타임은 세션이 뜨기를 기다리지 않고 디스크에서 바로 읽는다). 세션 목록의 cwd 비교는 대소문자를 구분하지 않아, 이전 기록의 경로 표기가 현재 실제 경로와 달라도 같은 폴더 히스토리로 찾는다. `reset`을 받은 창은 지금까지 그린 대화를 버린다.

- 서버는 소켓에 **30초마다 핑**을 보낸다 — 조용한 대화(에이전트가 긴 작업 중일 때)가 중간 장비의 유휴 타임아웃에 끊기지 않게. 그래도 끊기면 창이 1초 뒤 다시 붙고 `replay`로 복구한다. 끊어진 동안과 초기 준비·히스토리 로딩에는 대화 영역의 빈 말풍선 shimmer를 표시하고 준비·로딩 종료 시 제거한다([표시 계약](../features/%ED%84%B0%EB%AF%B8%EB%84%90%C2%B7%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%C2%B7%EC%9E%90%EB%8F%99%ED%99%94/%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8%20%EB%8C%80%ED%99%94%C2%B7%ED%81%90%C2%B7%EB%B3%B5%EC%9B%90.md#연결-대기와-재연결)). 연결 끊김 뮤캣 알림은 보내지 않는다.

- **진행 중에 온** `prompt`**는 던지지 않고 줄을 세운다.** 턴이 끝나면 서버가 순서대로 이어 돌리고, `cancel`은 진행 작업과 승인 요청만 취소하고 대기열은 보존한다. 진행 작업의 종료 처리가 끝나면 맨 위 항목부터 FIFO로 계속 실행한다([ADR 0186](../../../.mew/docs/decisions/0186-mew-cancel-active-continues-queue.md)). 큐 편집 잠금·메모리·인증·사용량 오류 보류는 유지한다. 대기 항목은 창에서 자리를 옮기고(`move_queued`) 내용도 고칠 수 있다(`edit_queued`) — 고치는 사이 앞 턴이 끝나 큐가 당겨질 수 있으므로 `expect`(창이 보고 있던 원본)가 지금 그 자리의 값과 다르면 서버가 무시한다.

- 큐 첨부는 `shared/agent-attachment.ts`의 프로젝트·업로드 경로·MIME 메타데이터를 `prompt.attachments`로 전달한다. 감독의 `meta.queuedAttachments`는 `queued`와 같은 순서의 목록이며 이미지 바이트는 포함하지 않는다. `edit_queued.attachments`는 저장할 전체 첨부 목록이고 새 사진에만 바이트를 싣는다. 감독은 같은 프로젝트·경로의 기존 사진 바이트를 유지하고 제거한 사진은 ACP 이미지 블록에서도 뺀다. WS는 수정 본문과 첨부 참조를 합쳐 런타임 프롬프트를 다시 만들며, 일반 파일 참조도 보존한다. 첨부만 있는 메시지의 빈 표시 본문은 허용하되 본문·첨부가 모두 비면 저장하지 않는다. 첨부 필드가 없는 기존 호출은 기존 이미지 목록을 유지한다. 편집 잠금·취소·연결 해제 규칙은 기존 큐 계약을 따른다. `agent-queue-attachments.test.ts`는 Codex·Claude의 WS→감독→ACP 전달을, `agent-clear.test.ts`는 첨부 유지·교체·전체 제거·취소와 첨부만 있는 큐 실행을 검증한다.

- 불러오기(`/resume`)는 **ACP 메서드**(`session/list`·`session/load`)다. 진행 중인 턴·승인·대기열과는 겹치지 않는다. 다른 런타임은 같은 자식 프로세스에서 세션만 갈아끼우지만, **Codex는 히스토리 전환 전에 어댑터를 재시작**해 이전 thread writer를 반납한다([ADR 0122](../../../.mew/docs/decisions/0122-mew-codex-history-load-restarts-writer.md)). 선택한 Codex 기록 불러오기가 실패하면 새 어댑터에서 바로 전 thread를 다시 불러와 현재 대화를 복구한다. 자동 복원 실패 시 `replay.restoreFailure`로 실패한 ID를 내려 원래 탭 포인터와 브라우저 전사를 보존한다. 사용자가 다른 히스토리를 고르거나 새 메시지를 보낼 때만 fallback 새 세션을 채택한다. 목록을 물어볼지는 `initialize`의 capability(`meta.canList`)로 정한다. 정확한 `/clear`는 CLI에 프롬프트로 넘기지 않는다. 작업 중이면 서버 큐의 **세션 경계**로 들어가 앞선 작업을 마친 뒤 ACP 새 세션을 열고, 그 뒤 큐에 넣은 메시지는 새 대화에서 실행한다. 이전 대화는 히스토리에만 남는다.

- 프롬프트는 등록 시점의 모델·노력도·권한 표시 이름과 실제 ID(`modelId`, `thinkingId`, `thinkingConfigId`, `modeId`)를 `settings`에 스냅샷으로 보관한다. ID를 보내지 않는 기존 클라이언트는 감독의 현재 설정으로 채운다. `meta.queuedSettings`는 `queued`와 같은 인덱스의 설정을 반환하며 `/clear`·CLI 항목은 `null`이다. 큐 재정렬·첨부 수정·재접속에서도 해당 항목의 스냅샷을 유지한다.
- `edit_queued.settings`는 WS 검증과 감독을 거쳐 본문·첨부와 함께 교체하며 필드가 없으면 기존 설정을 보존한다. 편집 취소는 설정을 변경하지 않는다. 프론트엔드는 큐 드롭다운 변경을 로컬 편집 상태로 관리해 세션의 새 메시지 설정을 건드리지 않고 저장·취소 뒤 기존 선택으로 복귀한다.
- 큐의 설정이 현재 설정과 다르면 ACP 프롬프트 직전에 저장된 모델·노력도·권한을 적용한다. 이 임시 적용의 설정 알림은 새 메시지용 선택에 반영하지 않으며, 턴이 끝나면 최신 새 메시지용 설정을 런타임에 복원한 뒤 다음 큐를 실행한다. 설정 적용 실패는 오류로 보고하고 해당 설정으로 프롬프트를 보내지 않는다. 전사 상태버블에도 해당 큐 설정을 남긴다. 모의 Codex·Claude의 WS→감독→ACP 경로는 `agent-queue-attachments.test.ts`로 검사한다.

- Prime Agent는 공식 `prime-agent --mode rpc`를 Mew 내부 어댑터가 ACP로 변환한다. 따라서 Prime ACP의 구현 유무와 무관하게 세션 목록/불러오기, 모델, thinking mode를 Mew 창에서 제공한다.
- Codex `/clear`는 큐 경계에서 어댑터와 자식 프로세스 그룹의 종료를 기다린 뒤 새 ACP 연결을 초기화하고 `session/new`를 호출한다([ADR 0140](../../../.mew/docs/decisions/0140-mew-codex-clear-releases-writer.md)). `AgentSession`·감독·탭·대기 큐와 편집 소유권은 유지한다. 실패하면 전사와 포인터를 보존하고 큐를 멈추며 `/clear` 재시도가 성공한 뒤에만 뒤 메시지를 실행한다. 종료 중 dispose되면 새 프로세스를 만들지 않는다. 다른 런타임은 기존 연결을 재사용한다. `agent-clear.test.ts`는 연속 경계·전환 실패/재시도·초기화 프로세스 종료·탭 종료를, `agentHost.test.ts`는 히스토리 로드 전부터 이전 writer가 종료된 상태를 검증한다.

- **토큰 사용량만 ACP 밖에서 온다** — 어댑터가 사용량을 보내지 않아 `agentUsage.ts`가 `<CLAUDE_CONFIG_DIR>/projects/<인코딩된 cwd>/<sessionId>.jsonl`을 읽는다. 읽기 전용·선택적이고, 파일이 없으면 사용량 칸만 빈다([ADR 0036](../../../.mew/docs/decisions/0036-mew-agent-session-controls-and-usage.md)).

- `GET /api/agent-cwd?path=&base=`는 주소창 입력을 서버 파일시스템 기준 절대 디렉터리로 검증한다 (owner/manager). 빈 `path`는 현재 워크스페이스, 상대경로는 `base` 기준이다.

- `GET /api/agent-cwd/suggestions?input=&base=&entered=`는 입력 중인 마지막 경로 조각의 접두어와 맞는 하위 디렉터리, 또는 이미 들어간 디렉터리의 하위를 돌려준다(owner/manager).

## 대화의 CLI 명령 기록

[ADR 0153](../../../.mew/docs/decisions/0153-mew-agent-cli-shared-queue.md)에 따라 CLI 모드는 HTTP로 접수하여 독립 에이전트 감독의 공통 FIFO 큐에 넣는다. AI 프롬프트·CLI·일반 모드 `/clear`가 같은 탭에서 순서대로 실행되며 CLI 원문·출력은 ACP에 전달하지 않는다. 입력 문자열을 공백·개행까지 보존하여 탭 cwd의 `$SHELL -lc`(미설정 시 `/bin/sh -lc`)에 넘긴다. CLI 모드에서는 `/clear`도 셸 입력이며 AI 세션 조작으로 해석하지 않는다. 서버가 실행기 경로와 무작위 `mewcmd-cli-*` 이름을 만들고 `TmuxManager.startCommand`로 실행 차례에만 tmux를 만든다.

- `server/agent-command-queue.ts` + `agentHost.ts` — 감독 IPC `queue_command`로 접수하고 `AgentSession.enqueueTask`가 실행·취소 수명을 소유한다. 실행 직전 agent·terminal 권한을 재검사하며 출력 저장 완료 후 다음 작업을 시작한다. `/clear` 뒤에는 실행 시점의 sessionId·사용자 턴 수를 기록한다. 브라우저/HTTP 연결 종료는 큐를 취소하지 않지만 탭 종료는 진행 중 CLI와 대기 작업을 취소한다. 사용자 중단은 진행 중 CLI만 취소하고 종료·출력 저장 완료 뒤 다음 대기 작업을 실행한다. 감독의 비정상 종료 후 남은 queued 기록은 다음 조회에서 중단으로 표시하며 자동 재실행하지 않는다. 배포 전부터 살아 있던 구버전 감독은 탭을 닫고 다시 열어 교체한다.
- `server/agent-commands.ts` — 계정별 저장소, 입력 검증, 중복 요청 방지, tmux 실행·중단 요청·사라진 세션 복구. ID가 같은 동일 요청은 명령을 두 번 실행하지 않는다.
- `server/agent-command-runner.ts` — tmux 안의 독립 실행기. `node-pty`로 실제 TTY를 제공하고 입력·resize를 중계한다. 서버나 브라우저가 닫혀도 실행·출력 저장·완료 정리가 계속된다. 셸 wrapper는 마지막 출력의 임의 마커를 실행기가 수신할 때까지 PTY를 유지하여 빠른 종료의 출력 손실을 막는다. 사용자의 명령은 wrapper 문자열에 삽입하지 않고 인자로 전달한다.
- 출력 청크는 표준 연결 gzip member로 즉시 저장한다. 메모리에는 최근 512 Ki 문자만 남긴다. 완료 시 전체 `output.gz`와 제어 시퀀스를 제거한 `preview.txt`, 종료 코드·상태를 저장하고 tmux를 종료한다. 중단은 `stop` 파일을 실행기가 감지해 프로세스 그룹에 TERM, 필요하면 KILL을 보내며 이미 수신한 출력도 보존한다. OS 종료·외부 강제 세션 삭제로 정상 저장을 마치지 못한 기록은 다음 조회에서 중단으로 표시한다.
- 위치: `<DATA_DIR>/agent-commands/<계정 SHA-256>/<명령 UUID>/`. 디렉터리 0700, 파일 0600. `record.json`은 원자적으로 교체한다. 원문·출력은 브라우저 전사 캐시에 복제하지 않는다. 기록은 자동 삭제하지 않는다.
- `GET/POST /api/agent/commands`, `POST /:id/stop`, `POST /stop-tab/:tab`, `GET /:id/output`, `GET /:id/archive`는 모두 agent·terminal 기능 권한과 계정 소유권을 적용한다. 목록은 runtime·cwd·sessionId로 제한하고 출력은 팝업을 열 때만 조회한다. 일반 tmux WS의 서버 제어 권한 경계는 그대로다.
- 클라이언트는 1.5초 간격으로 상태를 확인하고 `afterUserCount`로 해당 사용자 턴 뒤에 CLI 버블을 배치한다. ACP가 스트리밍 청크를 다르게 복원해도 발화 순서를 기준으로 같은 위치에 놓는다. queued 기록은 본문 대신 공통 대기열에 표시하며 취소·재정렬을 지원한다. 실행 전에 취소하면 `cancelledBeforeStart`로 표시해 명령 버블·중단 상태를 본문에 만들지 않는다. 기록 ID는 중복 요청의 재실행 방지를 위해 남기고, 폴링·재접속에서도 취소 표식을 전달해 기존 캐시를 갱신한다. 구버전의 실행 전 취소 기록(queuedAt 존재·시작/종료 시각 동일·출력/오류 없음)도 조회 시 같은 표식으로 정규화한다. 실제 실행 후 중단·실패와 감독 비정상 종료 기록은 계속 표시한다. 실행 시 기록한 사용자 턴 뒤에 명령 버블을 표시한다. `meta.queuedKinds`로 항목을 구분하고 `meta.activeTask`가 cli이면 AI 답변의 진행 표시를 켜지 않는다. 모델 변경 상태줄·AI 전사에는 CLI를 포함하지 않는다.

검증: `agentHost.test.ts`는 HTTP 중계 연결과 브라우저 연결이 끊긴 뒤에도 독립 감독이 대기 CLI를 실제 격리 tmux에서 실행하고 기록하는지 확인한다. `agent-clear.test.ts`는 AI→CLI→AI FIFO, 대기 중 tmux 미생성, 재정렬·취소, `/clear` 후 대화 연결과 실행 직전 권한 회수를 검증한다. `agent-commands.test.ts`는 계정/대화 격리·권한 회수·중복 실행 방지와 격리 tmux 서버에서 빠른 종료·stderr·비정상 종료·대화형 입력·중단·대용량 전체 기록·자동 세션 정리를 확인한다. `agent-command-timeline.test.ts`는 전사 재청크 후 명령 배치를 검증한다.

`agent-command-ui.test.ts`는 서버를 띄우지 않는 브라우저 fixture로 PC·모바일의 토글 기본값/위치, Ctrl+Tab 전환, 원문 전송, 대기열 표시와 실행 전 터미널 미노출, AI 프롬프트 미전송, live→저장 출력 전환, 포커스 복원, 재열람 시 재실행 방지, 새로고침 복원을 확인한다. 일반 HTTP에서도 `crypto.getRandomValues` 기반 UUID 폴백으로 실행할 수 있다. 실제 셸 실행은 별도 tmux 통합 테스트의 범위다.

## 메모리 보호

`agent-memory.ts`는 Linux 가용 메모리와 설치된 사용자 `mew-agents.slice` 예산을 읽고 ACP·CLI 자식을 별도 scope로 실행한다. 감독과 서버는 scope 밖이다. `AgentSession`은 시작·FIFO 인출 전과 2초 주기로 검사하여 진행 작업만 취소하고 `meta.memoryPaused=true`와 오류를 전송한다. 보류된 큐는 자동 인출·유휴 종료하지 않는다. 취소 완료와 회복 여유를 확인하면 중단된 AI 작업의 이어가기 메시지를 원래 설정으로 먼저 실행하고 FIFO 큐를 재개한다. CLI는 재실행하지 않는다. 사용자 중단은 이어가기를 제거하며 큐 편집·인증·사용량 보호는 유지한다. 감독의 `prompt.automatic=true`(예약·기능 실행)는 보류를 해제하지 않는다. OS 강제 종료는 종료 오류와 전사를 저장하고 세션을 닫는다.

기본 예산·회복 기준·설치·로그·범위는 [메모리 보호 운영](../operations/agent-memory.md), 결정은 [ADR 0164](../../../.mew/docs/decisions/0164-mew-agent-memory-protection.md)를 따른다. `agent-memory.test.ts`는 합성 압력에서 AI/CLI 취소와 큐 보류를 검증하고 선택적 64MiB scope OOM 검사로 OS 경계를 검증한다.

## CLI 도구와 프로세스 환경

- Claude는 [ADR 0142](../../../.mew/docs/decisions/0142-mew-claude-acp-and-cli-authentication.md)에 따라 대화형 ACP로 복원했다. 공식 CLI의 로그인 종료 후 감독이 ACP를 다시 초기화한다. 인증 실패·중단은 성공으로 취급하지 않으며 재시도할 수 있다. 실행·로그인·상태 조회·로그아웃은 같은 CLI 엔진과 설정 환경을 사용한다. `claude-acp-auth.test.ts`는 실제 계정을 호출하지 않는 CLI/ACP fixture로 이 경계를 검증한다.

- 클라이언트 capability는 **인증에 필요한** `auth.terminal`**·**`elicitation.url`**만 광고하고** `fs`**는 광고하지 않는다** — `fs`를 켜면 어댑터가 CLI의 `Read`·`Write`·`Edit`를 끄고 `mcp__acp__*`로 갈아끼워서, 터미널에서 만든 대화를 창에서 불러올 때 전사 속 `Edit` 참조가 API 400으로 거부된다. 도구 이름을 CLI와 맞춰 두는 것이 계약이다 ([ADR 0044](../../../.mew/docs/decisions/0044-mew-agent-cli-tool-parity.md)) — 경로 스코프는 없다.
- 워크스페이스를 갈아끼우면 **떠 있던 세션을 전부 접는다**(`disposeAllSessions`) — 자식 프로세스의 cwd는 뜰 때 정해져 옛 폴더에 매여 있다.
- 자식 환경에서 `CLAUDECODE`**를 지운다.** 남아 있으면 Claude Code가 중첩 세션으로 보고 실행을 거부해 세션 생성이 통째로 실패한다(mew 서버를 Claude Code 터미널에서 띄우면 상속된다).
- 저장한 런타임 설정은 ESM import로 읽는다. 이전 `require()` 실패를 catch로 숨기던 경로를 제거하여 CLI 실행 파일·환경 설정이 실제 spawn에 반영된다. Claude의 히스토리·사용량 경로도 적용된 `CLAUDE_CONFIG_DIR`을 따른다.

## Antigravity ACP 인증

Antigravity는 Google 공식 ACP 서버를 직접 spawn한다. `initialize.authMethods`를 유지하고 `gemini-api-key`는 환경변수 인증 버튼으로 분류한다. Google OAuth는 `authenticate` 중 stderr로 출력되는 `accounts.google.com/o/oauth2/…` HTTPS URL만 공통 `auth_url` 이벤트로 보낸다. 분할 청크를 줄 단위로 조립하고 32 KiB를 넘는 줄은 버리며, 원문 stderr는 로그·전사에 저장하지 않는다.

URL 이벤트는 재접속한 인증 화면에만 재전송된다. 성공·실패·취소 시 `auth_url_done`으로 브라우저를 닫고 URL을 버린다. ACP에 authenticate 취소 메서드가 없으므로 취소·330초 시간 초과는 해당 연결의 프로세스를 종료하고 initialize부터 다시 진행한다. 이전 연결의 늦은 응답은 새 세션을 만들지 않는다. 공급자 CLI 자격증명은 읽거나 복사하지 않는다. 설치·환경변수·지원 범위는 [런타임 설정](../configuration/agent-runtimes.md#antigravity-공식-acp), 결정은 [ADR 0143](../../../.mew/docs/decisions/0143-mew-antigravity-official-acp.md)을 따른다.


## 뮤캣 도우미 세션과 MCP

뮤캣은 계정·브라우저 탭·런타임별 별도 감독을 사용한다. `AgentSession.start`의 `mcpServers` 옵션을 독립 감독으로 전달하고 모든 session/new·session/load에 재사용한다. 일반 세션의 기본값은 빈 목록이다. 세션별 내장 MCP의 권한·현재 화면 맥락·작업 ID 왕복과 저장 경계는 [도우미 계약](../features/%ED%99%94%EB%A9%B4%C2%B7%EA%B3%84%EC%A0%95%C2%B7%EC%9A%B4%EC%98%81/%EB%AE%A4%EC%BA%A3%20%EB%8F%84%EC%9A%B0%EB%AF%B8%C2%B7%EB%8C%80%ED%99%94%C2%B7Mew%20%EC%A1%B0%EC%9E%91.md)을 따른다.
