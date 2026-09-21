# 서버 브라우저와 Android

[문서 지도](../MOC.md) · [이 분야](MOC.md) · [설치·실행](../../README.md)

## 브라우저 창

브라우저는 에디터·에이전트·터미널 옆에 붙는 패널이다. 상단 손잡이로 패널을 옮기거나 탭 하나를 끌어 별도 패널로 분리한다. 다른 브라우저 패널의 탭바 빈 공간에도 탭을 합칠 수 있다. 마지막 탭을 옮긴 패널은 자동으로 닫힌다. 브라우저는 좌우 배치만 허용하며 항상 작업 영역 높이를 유지한다. 패널을 닫으면 그 칸만 사라지고 나머지가 빈자리를 채운다. 탭은 남은 브라우저 패널로 모으며, 마지막 패널의 탭도 다시 열 때 방문 상태를 이어 쓴다. 닫은 분할은 복원하지 않는다. 독립 `/browser` 화면은 그대로 제공한다.

실제 웹페이지도 탭바·주소창과 현재 표시 중인 안내를 제외한 세로 공간을 끝까지 채운다. 패널·화면 크기가 바뀌면 표시 영역과 서버 페이지 높이가 함께 맞춰지며, 모바일에서 주소창이 두 줄로 바뀌어도 남은 높이를 사용한다.
로딩은 우측 상단 인디케이터로만 표시하며 주소창 아래의 로딩·상태 안내줄은 사용하지 않는다. 주소 오류·중요 안내·업로드 실패는 브라우저 하단 토스트로 표시해 페이지 높이를 바꾸지 않는다. 일반 안내는 6초 뒤 사라지며 닫을 수도 있다. 재연결이 필요한 오류 토스트는 복구 버튼을 유지하며 새 탐색·연결 복구 시 사라진다. 같은 상태가 반복 수신돼도 닫힌 토스트를 다시 띄우지 않는다. 이 표시 방식은 독립 브라우저와 로그인 브라우저에도 적용한다. 파일 선택·다운로드·사이트 확인창처럼 조작이 필요한 UI는 유지한다.
패널 경계선을 끌 때 포인터가 웹페이지 위로 넘어가도 크기 조절이 이어지며, 마우스를 놓으면 끝난다. 내부 iframe 위에서 드래그가 끊기던 문제는 공통 [패널 크기 조절 계약](../development/ui-contracts.md#작업-패널-배치)에서 처리한다.

열린 탭이 없으면 중앙 주소 입력칸과 그 아래 바로가기가 있는 시작 화면을 표시한다. `localhost:3100` 자동 열기는 제거했으며, 기본 바로가기는 **liiiiv-life dev** → `http://localhost:3000/`이다. 주소를 입력하거나 바로가기를 누를 때만 서버 탭을 연다. 기존 서버 탭이 있으면 그대로 복원한다.

탭이 하나여도 `×` 또는 `Ctrl+W`로 닫을 수 있다. 마지막 탭을 닫으면 패널은 유지되고 시작 화면으로 돌아온다. `+`는 같은 시작 화면의 빈 탭을 만들며, 주소를 열기 전에는 서버 브라우저를 시작하지 않는다. 빈 탭은 화면을 새로고침하면 사라진다.

Chromium 실행 시 별도의 시작용 `about:blank` 탭을 만들지 않는다. 탭 생성 중 닫기를 눌러도 생성이 끝난 실제 탭과 프로필 참조까지 정리한 뒤 닫기를 완료하며, 중복 닫기는 같은 정리 작업을 기다린다. 연결 중이던 것을 포함해 Mew의 페이지 제어용 CDP 연결을 먼저 해제하고 실제 탭을 닫아 종료가 멈추지 않도록 한다. 마지막 사용 탭 종료 시 프로필 프로세스도 종료한다. 로그인 사이트가 먼저 빈 팝업을 열고 나중에 내용을 쓰는 경우가 있으므로 URL이 `about:blank`라는 이유만으로 정상 팝업을 일괄 삭제하지 않는다. 패널 숨기기와 연결 끊김의 기존 복원 유예는 유지한다.

**바로가기 추가**에서 이름·주소를 저장하고, 각 바로가기 옆 `×`로 삭제한다. 기본 항목도 삭제할 수 있다. 바로가기는 이 기기의 브라우저에 저장되며 다른 기기·계정으로 동기화하지 않는다. 저장 실패 시 안내하고 기존 목록을 유지한다. 시작 화면의 문구는 한국어·영어·일본어·중국어를 지원한다.

Alt+B·헤더 메뉴·플로팅 핸들의 **브라우저**와 독립 `/browser` 화면은 실제 서버 Chromium을 조작한다.
폰에서 `localhost:3100`을 넣으면 Mew 서버의 localhost를 열고, 공개 HTTP(S) 사이트와 서버에서 접근 가능한 사설망도 연다.
사이트의 JavaScript·TLS·네트워크·쿠키·storage·WebSocket·Service Worker는 서버에서 동작한다.
`@rrweb/record`·`@rrweb/replay`로 DOM 변경과 사용자 입력만 연결하며 화면 캡처·영상 전송은 사용하지 않는다.
결정과 지원 경계는 [ADR 0127](../../../.mew/docs/decisions/0127-mew-browser-server-dom-runtime.md)에 둔다.

- 준비: Mew를 실행하는 OS 사용자로 `npx playwright-core install chromium`을 실행한다.
  해당 OS·아키텍처용 Playwright 브라우저를 우선 사용하고, 없으면 시스템 Chrome/Chromium을 탐색한다.
  macOS는 Google Chrome, Chromium 순서로 각각 `~/Applications` → `/Applications`의 앱 내부 실행 파일을 찾는다.
  Apple Silicon·Intel 모두 같은 실행 경로를 사용하며, Linux 브라우저 바이너리·캐시는 Mac으로 복사하지 않는다.
  다른 설치 위치는 `MEW_BROWSER_EXECUTABLE`에 실행 가능한 파일의 절대 경로로 지정한다.
  예: `export MEW_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.
  `.app` 디렉터리 자체는 실행 파일이 아니다. 명시한 경로가 잘못되면 오류를 표시하고 다른 브라우저로 바꾸지 않는다.
  Chromium OS sandbox는 끄지 않는다.
- 실행 모드: Linux/WSL에서 Mew 프로세스에 `DISPLAY` 또는 `WAYLAND_DISPLAY`가 있으면 창 모드로 실행한다.
  Windows/macOS도 기본 창 모드이며, 디스플레이 환경이 없는 Linux는 헤드리스로 실행한다.
  `MEW_BROWSER_HEADLESS=0`은 창 모드, `1`은 헤드리스를 강제한다. 창 실행 실패 시 헤드리스로 자동 재시도하지 않는다.
  Linux/WSL의 창 모드 일반 브라우저는 기본적으로 계정 프로필별 **전용 Xvfb 가상 화면**에 표시한다. 새 창·탭·사이트 팝업이 실제 서버 데스크톱을 덮거나 포커스를 가져가지 않는다. `sudo apt install xvfb`로 준비하며, 현재 서버에 이미 설치돼 있으면 추가 설치가 필요 없다.
  `MEW_BROWSER_DISPLAY=virtual`이 기본값이고, `desktop`을 명시하면 기존 실제 데스크톱을 사용한다. 가상 화면 시작 실패 시 실제 데스크톱이나 헤드리스로 자동 전환하지 않는다. 디스플레이 없는 Linux에서도 창 모드가 필요하면 `MEW_BROWSER_HEADLESS=0`을 지정한다.
  가상 화면은 임시 인증 쿠키와 TCP 수신 없는 Linux 로컬 소켓을 사용한다. WSLg의 읽기 전용 소켓 폴더는 변경하지 않으며 Chromium은 X11로 연결한다. 프로필 종료·시작 실패 때 가상 화면과 임시 인증 파일을 정리한다. 표시 방식은 모두 기존 DOM 중계다 ([ADR 0163](../../../.mew/docs/decisions/0163-mew-browser-virtual-display.md)).
  macOS 창 모드는 로그인한 사용자의 데스크톱 세션에서 Mew를 실행하는 환경을 기준으로 한다.
  Mac에는 WSL의 `DISPLAY=:0` 설정이 필요하지 않다. GUI 없는 SSH·시스템 서비스 실행은 창 모드 검증 대상이 아니다.
  브라우저는 `.app/Contents/MacOS/…`를 직접 spawn하며 `open -a`로 기존 개인 Chrome에 연결하지 않는다.
  macOS/Windows와 `MEW_BROWSER_DISPLAY=desktop`에서는 서버 데스크톱에 브라우저·로그인 창이 보이고 포커스가 이동할 수 있다. 과거 호스트 제한 인증 검증 helper에는 가상 화면을 적용하지 않는다.
  모드 변경은 새 Chromium 프로필 프로세스에 적용된다. 창 모드로 바꿔도 공급자의 로그인 허용을 보장하지 않는다.
- 계정별 전용 프로필은 `MEW_DATA_DIR/browser/profiles/<account-hash>`에 둔다. 일반 탭은 쿠키·localStorage·IndexedDB를
  공유하고 마지막 탭 종료 때 프로필을 닫아 디스크에 유지한다. 개인 Chrome 프로필이나 기기의 Mew 쿠키를 가져오지 않는다.
  프로필 프로세스는 `browser-dom-process.ts`가 Chromium 실행 파일을 직접 실행한 뒤 CDP로 연결한다.
  Playwright 기본 실행 옵션 묶음은 적용하지 않으며 DOM 기록·입력 전달에는 기존 Playwright API를 사용한다.
  CDP는 동적 loopback 포트에서만 열고 자식 프로세스가 알린 endpoint로 연결한다. 해당 포트를 터널에 노출하지 않는다.
  마지막 프로필 사용자가 떠나면 브라우저를 종료하고, 시작 실패 시에도 생성한 자식 프로세스를 정리한다.
  결정은 [ADR 0129](../../../.mew/docs/decisions/0129-mew-browser-native-launch-cdp.md)를 따른다.
- 열린 탭 목록은 서버의 계정별 메모리 상태다. 패널 재열기·기기 새로고침은 같은 탭에 재연결한다. 서버 재시작 또는
  연결이 끊긴 뒤 10분이 지나면 탭과 방문 기록은 정리되며, 사이트의 영속 로그인 상태는 프로필에 남는다. 계정당 최대 20개 탭이다.
- 주소 입력·뒤로/앞으로·새로고침·중지는 실제 Page를 조작한다. 사이트 팝업은 원래 opener 관계를 유지한 Mew 탭으로 열린다.
  모바일 뒤로가기 키도 전면 브라우저의 선택된 탭에 이전 방문 기록이 있으면 그 페이지로 이동한다.
  이전 기록이 없는 탭·빈 시작 화면에서는 브라우저 패널을 닫는다. 독립 `/browser` 화면도 같은 순서를 따른다.
  위에 열린 모달·메뉴는 먼저 닫으며, Esc와 닫기 버튼은 기존 닫기 동작을 유지한다.
  페이지 이동 명령은 이전 문서의 제목·방문 기록 조회 완료를 기다리지 않고 시작한다. 늦게 끝난 상태 조회는 새 상태를 덮어쓰지 않는다.
  하위 프레임은 각각 비실행 DOM 재생 화면을 가지며, 입력은 frame ID·문서 세대·노드 ID로 서버 요소에 적용한다.
  부모 스트림의 iframe Document 부착 이벤트는 재생하지 않는다. 숨김·표시 스타일과 증분 attributes 배열을 보존하고,
  뒤늦게 생긴 iframe·srcdoc 문서에도 기록기를 문서당 한 번 설치한다. 부모 mutation 재생 후 대기 중인 하위 화면을 연결한다.
  기록 시작은 iframe 생성·document.write가 끝난 다음 실행해 rrweb의 임시 iframe에서 재귀 생성이 일어나지 않게 한다.
  사이트가 연 빈 팝업은 원래 Page를 유지하며, opener의 문서 작성·후속 OAuth 이동을 덮어쓰지 않는다.
  Chromium 자체 오류 문서에는 기록기를 주입하지 않고, 실패한 주소를 주소창에 유지한다.
  첫 주소의 응답을 기다리는 중에도 주소 변경·중지가 가능하다. 연결 거부·시간 초과는 서버 기준 대상 호스트와 함께 표시한다.
- 닫힌 Shadow DOM 안에 있는 위젯도 DOM·스타일·중첩 iframe과 클릭을 중계한다. 원본 페이지의 `mode: closed`와
  `element.shadowRoot === null` 동작은 유지한다. 확인 위젯이 Chromium에만 보이고 Mew에서 빈칸으로 나오던 누락을 보완한 것으로,
  Cloudflare 등의 실제 인증 성공을 보장하지는 않는다. 변경 반영 후 열려 있던 사이트를 새로고침해야 생성 시점부터 기록된다.
  `server/browser-dom-recorder-source.ts`는 고정된 `@rrweb/record` 2.1.4 번들의 **내부 shadowRoot 조회만** 확장한다.
  문서 초기화 시 `attachShadow`가 돌려준 닫힌 루트를 WeakMap에 보관하며, 공개 getter·root mode·사이트 스크립트 실행 위치는 바꾸지 않는다.
  rrweb 업데이트 시 해당 accessor가 정확히 하나인지 확인하는 검사가 실패하면 새 번들을 검토하고 브라우저 회귀 테스트를 실행한다.
- 클릭·hover·폼 입력·Enter·스크롤, alert/confirm/prompt 응답과 파일 선택을 연결한다. 업로드는 파일당 8 MiB·최대 4개,
  다운로드는 탭당 최대 20개이며 서버 Chromium의 임시 파일을 같은 계정에 제공한다. 탭 종료 후에는 받을 수 없다.
- 입력은 탭별로 순서대로 처리한다. 아직 실행하지 않은 같은 frame·문서 세대·입력칸의 연속 값은 최신 값으로 합치며,
  Enter·클릭·다른 입력칸을 건너뛰어 합치지 않는다. 연속 scroll·resize·hover도 최신 상태로 합친다.
  선택 상자·키 입력을 포함한 요소 조작은 2.5초 안에 실패를 알리고 다음 조작으로 넘어간다.
  hover는 자동 스크롤 없이 현재 보이는 요소에만 최대 150ms 동안 시도한다. 새 입력이 오면 진행 중인 hover를 취소하고,
  재생 화면에서 스크롤이 시작되면 아직 보내지 않은 hover도 버린다. 화면 밖·숨김·제거된 요소의 hover 실패는 조작 실패 안내를 띄우지 않는다.
  오래된 hover가 원래 요소를 찾아 페이지·내부 스크롤 영역을 되돌리거나 다음 입력을 지연시키던 동작은 재도입하지 않는다.
  대화상자 응답·중지·주소 변경·닫기는 입력 대기열을 기다리지 않는다. 재연결·연결 종료·주소 변경·중지·탭 종료 시
  대기 입력을 비우고 실행 중인 요소 조작을 취소해 이전 연결의 조작이 뒤늦게 적용되는 것을 막는다.
  합칠 수 없는 대기 조작이 100개를 넘으면 오류를 표시하고 연결을 닫는다. 다시 연결한 뒤 입력 내용을 확인한다.
  입력 내용은 로그나 영속 대기열에 저장하지 않는다.
- 스크롤은 재생 화면에서 즉시 움직이고, 서버에서 돌아온 위치를 별도 애니메이션 없이 반영한다. 재생 때문에 발생한 scroll 이벤트는 서버로 다시 보내지 않는다. 각 프레임·요소의 로컬 입력에 연결별 토큰과 증가 번호를 붙이고, 기록기가 해당 번호를 되돌려 주어 늦은 이전 위치가 최신 조작을 덮어쓰지 않게 한다. 페이지 자체의 스크롤은 마지막 로컬 입력이 서버에 반영된 뒤 계속 중계한다. 문서와 내부 스크롤 영역은 각각 전송 대기열을 가지며, 전체 스냅샷 복원 시 기존 위치를 사용자 입력으로 재전송하지 않는다. 서버는 사용자의 위치를 즉시 적용하고, 재생 화면에서는 `scroll-behavior`를 `auto`로 고정한다. 이 수정은 Mew 클라이언트·서버를 함께 반영한 뒤 내부 웹페이지를 새로고침해야 적용된다.
- DOM 재생 iframe에는 `allow-scripts`를 주지 않는다. 이미지·폰트·CSS는 Chromium이 받은 자원만 계정 인증 경로로 제공한다.
  자원 캐시는 탭당 32 MiB·256개, 자원당 5 MiB로 제한한다. 임의 URL fetch·JavaScript/CDP 실행 API는 노출하지 않는다.
- Canvas/WebGL·영상/음성·DRM·장치/OS 인증창은 DOM만으로 동일하게 재현하지 못한다. 미지원 표면을 표시하며 영상으로 대체하지 않는다.
  브라우저 자동화를 거부하는 사이트의 로그인 성공도 보장하지 않는다. 실제 OpenAI 계정 로그인 완료는 아직 검증하지 않았다.

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET/POST /api/browser-dom/tabs` | manager·owner | 계정의 실제 서버 탭 조회·생성/재연결 |
| `DELETE /api/browser-dom/tabs/:tabId` | 같은 계정 | 서버 탭 종료 |
| `WS /api/browser-dom/ws?session=<id>` | 같은 계정·정확한 Mew origin | 페이지 상태·DOM·탭/대화상자 이벤트와 제한된 입력 중계 |
| `GET /api/browser-dom/:id/asset/:hash` | 같은 계정 | 이미 받은 이미지·폰트·CSS |
| `POST /api/browser-dom/:id/upload/:chooser` | 같은 계정 | 활성 파일 선택창에 multipart `files` 전달 |
| `GET /api/browser-dom/:id/download/:download` | 같은 계정 | 서버 탭의 다운로드 파일 |
| `GET /browser` | 페이지 셸은 공개, 연결은 manager·owner | 같은 브라우저 UI를 독립 팝업으로 표시 |

브라우저형 OAuth(Codex·Kimi `.com`/`.ai`·Cursor)는 모두 같은 서버 프로필과 DOM 브라우저를 사용한다.
등록표의 `browser` 방법은 공통으로 `serverBrowser: true`가 되며 별도 외부 탭을 예약하지 않는다.
`POST /api/agent-runtimes/:id/auth/:method/browser`는 실행 중인 CLI 출력의 최초 URL을 등록된 HTTPS 호스트로 검증한 뒤
`url`·`streamUrl`을 반환한다. 기기 코드 URL에는 `redirect_uri`가 없어도 된다. 이후 SSO·자원·callback은 일반 서버
브라우저의 HTTP(S) 접근 범위를 따른다([ADR 0128](../../../.mew/docs/decisions/0128-mew-browser-oauth-uses-internal-browser.md)).
인증 탭과 팝업은 일반 Browser 탭 목록에서 제외하며 작업당 20분·계정당 3개 작업으로 제한한다. CLI 작업 완료/실패/중단 시
같은 작업의 팝업까지 닫고, 사이트의 영속 상태는 계정 프로필에 남긴다. 인증 화면은 기기 승인 코드와 팝업 탭을 함께 표시한다.
ACP의 URL 인증 요청도 공통 내부 브라우저로 열고 DOM 화면이 준비된 뒤에만 `auth_url_response: accept`를 보낸다.
ACP 인증 완료 또는 에이전트 화면 종료 때 해당 서버 탭들을 정리한다. terminal·API key 인증은 기존 계약을 유지한다.

기존 `/<port>`·Android gateway만 `server/browserProxy.ts`의 loopback HTML 프록시를 계속 쓴다.
`GET /api/browser-url?url=`·`/__mew_browser/...`·`/__mew_browser_ws/...`는 이 호환 경로에 남으며 일반 Browser 패널은 사용하지 않는다.
호환 프록시는 localhost·127.0.0.0/8·::1만 허용하고 링크·새 창 target·`window.open`은 같은 프레임으로 제한한다.

검증: `node --test server/browser-dom-executable.test.ts server/browser-dom-input.test.ts server/browser-dom-scroll.test.ts server/browser-dom.test.ts`. 실행 파일 탐색과 실제 Chromium의 공백 경로 실행·프로필 재열기를 검사한다.
`node --test server/browser-notice-ui.test.ts`는 데스크톱·모바일 폭에서 로딩 안내줄 제거·하단 토스트 위치·페이지 높이 유지·재연결·안내 닫기와 자동 숨김을 검사한다.
500회 연속 입력 뒤 최종 값·제출 순서, 다른 입력칸·프레임·문서 세대 경계, 대기열 포화 시 대화상자·중지,
재연결·주소 변경의 이전 입력 취소, 선택 옵션 대기 실패 뒤 다음 입력 복구도 검사한다.
제목 조회가 멈춰 있어도 뒤로/앞으로 명령이 먼저 실행되는지와 늦은 조회 결과의 폐기,
모바일 폭에서 연속 뒤로가기·선택된 탭의 방문 기록·빈 탭 닫기도 검사한다.
화면 밖·내부 스크롤 영역·숨김 요소의 hover가 위치를 바꾸지 않는지, 보이는 요소의 hover가 동작하는지,
새 입력의 hover 취소와 hover 실패 시 불필요한 안내가 없는지도 검사한다.
실제 Chromium으로 폼·서버 쿠키·callback·재연결·모바일 폭·프레임 클릭·
WebSocket·Service Worker·팝업/opener·방문 기록·SPA·대화상자·파일 전송·영속 프로필·계정 격리·인증 호스트 차단을 검사한다.
닫힌 Shadow DOM의 초기·동적 생성, 스타일·비밀번호 마스킹·중첩 iframe·서버 클릭·전체 스냅샷 복원도 로컬 fixture로 검사한다.
스크롤 회귀 테스트는 실제 Chromium에서 지연·역순으로 도착하는 위치, 서버 주도 이동, 문서·내부 영역 동시 이동, 비영점 위치의 스냅샷 복원과 재전송 없음을 검증한다.
실제 Cloudflare 확인 위젯을 통과시키는 자동화 테스트는 아니다.
Chromium이 없으면 실제 브라우저 테스트만 skip한다.
창 모드 검증은 `MEW_BROWSER_HEADLESS=0 node --test server/browser-dom.test.ts`,
디스플레이 없는 CI에서는 `MEW_BROWSER_HEADLESS=1`을 테스트 실행 환경에 지정한다.
Linux 전용 가상 화면의 분리·임시 인증 파일 정리·실제 창 모드 입력과 팝업 검증은 `node --test server/browser-dom-display.test.ts`로 실행한다. Xvfb와 Chromium이 있어야 실제 실행 항목을 검사한다. 가상 화면에서 실제 Google 로그인의 성공 여부는 사용자 확인이 필요하다.

## Android 창

헤더 메뉴의 Android 버튼으로 오른쪽 끝에 여는 보조창(`components/AndroidPanel.tsx`). Android Emulator나 system image는 mew 배포물에 넣지 않는다([ADR 0058](../../../.mew/docs/decisions/0058-mew-android-panel-optional-gateway.md)). 패널이 하는 일은 두 가지뿐이다.

- Linux·WSL에서는 `/dev/kvm`, macOS에서는 Emulator의 Hypervisor.Framework 가속 상태를 확인하고, Android SDK 도구(`sdkmanager`·`adb`·`emulator`·`avdmanager`), API 36 system image, AVD 존재 여부를 보여준다. Apple Silicon은 `arm64-v8a`, Intel/AMD는 `x86_64` image를 고르고, image가 없으면 설치 명령만 제시한 뒤 새로고침 후에 AVD 생성 명령을 제시한다.
- 안내 명령의 복사 아이콘 옆 \*\*▶\*\*는 서버가 정한 명령 ID를 전용 숨김 tmux 세션(`mewcmd-*`)에서 실행한다. 옆 터미널 아이콘은 `SessionTerminalPopup`으로 진행 화면과 대화형 입력을 열고, 명령이 끝나면 프로젝트 one-shot 명령어 버튼과 같은 경로로 자기 세션을 자동 종료한다. 브라우저가 보낸 임의 명령 문자열은 실행하지 않는다.
- 이미 떠 있는 Android WebRTC/gateway 주소를 입력하면 기존 loopback 호환 프록시로 iframe에 연다.

권한은 브라우저 창·터미널과 같다 — **manager·owner만** 연다. 상태 점검 API는 emulator를 실행하지 않고, 프로세스 시작·설치·system image 다운로드도 하지 않는다. 따라서 Android 창을 열지 않으면 mew 기본 실행 경로에 붙는 무게는 패널 코드와 API 라우트뿐이다.

| 라우트 | 역할 | 하는 일 |
| --- | --- | --- |
| `GET /api/android/status` | **manager·owner** | Linux·WSL KVM 또는 macOS 가속, Android SDK, 호스트 아키텍처용 AVD 상태 점검. emulator 실행 없음 |
| `POST /api/android/commands/:id/run` | **manager·owner** | 서버 등록표의 Android 안내 명령을 one-shot tmux 세션에서 실행 |
