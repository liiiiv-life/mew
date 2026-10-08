---
title: "원격 데스크톱 외부 직결·자동 네트워크 준비"
created: 2026-10-02
updated: 2026-10-02
description: "외부 네트워크의 원격 데스크톱 직접 연결, STUN 제한 재시도·NAT 준비·Windows 방화벽과 Mac/Linux 네트워크 권한·실측 경계를 정의한다."
상위파일: "MOC.md"
---

[공통 계약](remote-desktop.md) · [ADR 0189](../../../.mew/docs/decisions/0189-mew-desktop-external-direct-connectivity.md)

## 연결 경로

외부 폰과 로그인 호스트 사이의 DTLS-SRTP·DataChannel 직접 연결을 사용한다. Mew HTTPS/WebSocket은 인증·승인·협상만 수행하며 TURN·서버 영상 중계를 추가하지 않는다. 설치 파일의 준비 완료와 외부 폰 연결 성공은 구분한다. 같은 PC의 Chrome 성공을 외부 네트워크 검증으로 보고하지 않는다.

기본 STUN은 Google `stun:stun.l.google.com:19302`와 Cloudflare `stun:stun.cloudflare.com:3478`이다. 브라우저는 전체 목록을 사용한다. libdatachannel/libjuice는 한 agent에서 STUN 하나를 선택하므로 네이티브 호스트는 하나씩 설정하고, 입력 채널이 하나도 열리지 않은 실패·12초 탐색 지연에서 다음 서버로 제한적으로 재시도한다. 최대 3개 서로 다른 서버, 기본 설정은 2회다. 빈 ICE 목록은 STUN을 조회하지 않는다. [libdatachannel 구현](https://github.com/paullouisageneau/libdatachannel/blob/v0.24.5/src/impl/icetransport.cpp) · [Cloudflare 공개 STUN](https://developers.cloudflare.com/realtime/turn/faq/).

각 협상에 `negotiation` 0–2를 붙인다. 부모의 인증된 WebSocket·현재 session ID는 유지하되 전송 agent만 다시 만든다. 이전 peer·입력 채널을 닫고 임시 매핑을 정리한 뒤 새 offer를 보낸다. 브라우저·서버·호스트 모두 이전 answer/candidate를 무시한다. 각 네이티브 attempt가 motion/control 채널 wrapper를 강한 참조로 유지하고 종료 시 명시적으로 닫는다. 수신 전용 채널이 JS GC에서 조기에 소멸하며 SCTP가 닫히던 공통 수명 오류를 방지한다. 브라우저는 첫 입력 연결 전 peer 실패에서 WebSocket을 유지하고 다음 offer 또는 20초 제한 시간을 기다린다. 비동기 영상 통계도 해당 peer·협상 세대에만 적용한다. 이미 입력 채널이 열린 세션은 이 방식으로 재시도하지 않는다. 캡처 프레임·GPU 장치·인코더를 다시 시작하지 않고 새 track이 열리면 키프레임을 요청한다.

## 활성 연결의 자동 NAT 준비

`native-connectivity.mjs`는 실제 ICE host UDP 후보의 포트를 관찰한다. 직접 연결이 2초 안에 성립하면 공유기를 변경하지 않는다. 그 이후 OS가 선택한 경로와 같은 인터페이스의 private IPv4 후보만 사용해 PCP → NAT-PMP → UPnP IGD 순서로 시도한다. Windows는 로그인 호스트에서 시스템 `iphlpapi.dll`의 `GetBestRoute2`로 커널이 선택한 IPv4 게이트웨이·source를 직접 조회한다. PowerShell/CIM의 초기 프로세스 지연·2.5초 시간 초과를 제거하며 WSL의 가상 기본 게이트웨이를 대신 사용하지 않는다. Linux는 표준 `/usr/sbin`·`/sbin`·`/usr/bin`·`/bin`의 `iproute2`를 절대 경로로 찾아 `ip -j -4 route get 1.1.1.1`의 선택 인터페이스·preferred source를 사용한다. Mac은 `/sbin/route -n get -inet 1.1.1.1`의 IPv4 게이트웨이·인터페이스를 사용한다. 이 고정 주소는 로컬 커널의 경로 조회에만 사용하며 패킷을 보내지 않는다. 기본 경로 목록 순서나 첫 NIC를 사용하지 않으며 VPN·정책 경로 대신 임의의 물리 LAN 공유기로 우회하지 않는다. GUI·HTTP 입력으로 게이트웨이·매핑 대상·프로토콜을 지정할 수 없다. [Windows 경로 API](https://learn.microsoft.com/en-us/windows/win32/api/netioapi/nf-netioapi-getbestroute2) · [Linux 경로 조회](https://github.com/iproute2/iproute2/blob/main/man/man8/ip-route.8.in) · [Apple route 계약](https://github.com/apple-oss-distributions/network_cmds/blob/main/route.tproj/route.8).

PCP/NAT-PMP는 OS 기본 게이트웨이에 연결한 UDP 5351 소켓으로만 교환한다. 응답의 opcode·내부 포트와 PCP nonce를 검사한다. PCP는 제3자 주소 옵션을 쓰지 않는다. 성공한 공개 외부 IPv4·포트를 원래 ICE socket의 srflx 후보로 전달한다. 매핑과 peer의 UDP 소켓은 서로 다르며, 매핑 대상은 제어용 소켓이 아니라 관찰한 미디어 ICE 포트다. [PCP](https://www.rfc-editor.org/rfc/rfc6887.html) · [NAT-PMP](https://www.rfc-editor.org/rfc/rfc6886.html).

UPnP SSDP는 선택한 인터페이스에서 TTL 1로 발견 요청을 보낸다. 응답은 해당 기본 게이트웨이의 IPv4만 받아들이고, 설명·control URL은 같은 IP의 HTTP만 사용한다. redirect·자격증명 URL·외부 hostname·DTD/entity를 거부하며 응답은 64KiB 이하·각 요청은 제한 시간 내에서 처리한다. 고정 WANIP/WANPPP 서비스의 외부 주소·특정 UDP 매핑 조회/생성/삭제만 수행한다. 기존 매핑의 부재를 확인해야 생성하며, 갱신·삭제는 내부 주소·포트·무작위 소유 토큰이 일치해야 한다. 다른 앱의 매핑을 교체하거나 삭제하지 않는다. [IGD 서비스 계약](https://upnp.org/specs/gw/UPnP-gw-WANIPConnection-v2-Service.pdf).

lease는 120초를 요청하고 1–300초 응답만 허용한다. UPnP도 실제 조회한 lease를 검사한다. 영구·너무 긴 매핑은 거부하고 정리하며 영구 모드로 재시도하지 않는다. 활성 매핑은 lease 절반 지점에 갱신하고, 종료·승인 회수·협상 교체에서 갱신을 취소하고 삭제한다. 정리 실패·강제 종료에서는 수락한 lease가 최대 5분 내 만료한다. 캡처 정지와 네트워크 정리가 확인된 stop ACK 뒤에만 재사용하고, 3.5초 안에 ACK가 없는 호스트는 폐기한다. cleanup 실패가 화면·입력 승인 수명을 연장하지 않는다.

대기 호스트는 STUN agent·NAT 발견·매핑·갱신 타이머를 만들지 않는다. `MEW_DESKTOP_AUTO_NAT=0`으로 공유기 자동화를 끌 수 있다. 이 설정은 STUN과 별개다. 경로 조회 실패는 `route-unavailable`, 후보와 일치하는 private IPv4 공유기 경로 부재는 `no-router`로 진단한다. IPv6 직결·STUN을 막거나 설치 성공으로 숨기지 않는다.

부모 종료·SIGTERM에서도 입력과 연결 승인을 먼저 회수하고 native capture·NAT 정리를 최대 3.5초 기다린다. 완료하면 race 타이머를 제거해 빠른 종료를 지연하지 않는다. worker 종료 뒤 OS 어댑터·부모 채널·RTC를 해제한다. POSIX 부모는 SIGTERM 뒤 4초 후에만 강제 종료한다. Windows 로그인 supervisor의 부모 종료 보장은 별도로 유지한다.

## Windows 방화벽 준비

`prepare-windows-network.ps1`은 설치한 `runtime/node.exe`의 UDP 수신만 준비한다. 실행 파일의 정규 경로 해시로 관리 규칙 이름을 정하고 모든 Windows 네트워크 프로필에서 해당 프로그램만 허용한다. TCP·다른 앱·전역 방화벽 설정·공유기 영구 규칙은 변경하지 않는다. 관리자 권한이 없으면 고정 설치 스크립트와 대상 경로로 OS UAC를 요청한다. 승인은 사용자가 Windows에서 한다.

기존 명시적 앱 차단·같은 이름의 충돌 규칙은 보존하고 중단한다. UAC 거부·조직 정책·조회 실패는 별도 경고로 표시하며 `MEW_NETWORK_READY`를 내보내지 않는다. helper 파일 설치 마커는 파일·binding·GPU 모듈 상태만 나타낸다. 네트워크 준비에 실패해도 설치 파일을 지우거나 OS 승인창을 자동 반복하지 않는다. 사용자는 같은 `desktop-setup`으로 네트워크 준비를 다시 요청할 수 있다. 개발 에이전트는 이 설치 절차를 실제 방화벽에 실행하지 않는다.

읽기 전용 진단은 명시적 차단과 허용 규칙 부재를 구분해 실패 안내에 전달한다. 앱 허용 규칙만으로 조직 정책·다른 필터까지 해제됐다고 보장하지 않는다. [Microsoft 방화벽 규칙](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule).

## Mac/Linux 네트워크 권한

STUN 재시도·임시 NAT 매핑·암호화 영상/입력과 종료 수명은 Mac/Linux도 같은 네이티브 코드로 수행한다. Windows UDP 규칙의 준비 성공을 POSIX 네트워크 승인으로 표시하지 않는다.

Mac의 자체 앱 Info.plist에 `NSLocalNetworkUsageDescription`을 넣는다. macOS 15 이상은 로컬 UDP·공유기 접근에 Local Network 권한이 필요할 수 있으며, 화면 기록·손쉬운 사용·방화벽 수신 허용과는 별개다. OS가 판단한 책임 앱과 실행 환경에 따라 승인 대상이 달라지며 Terminal/SSH 자식 등에는 예외가 있다. 사용자의 거부·TCC DB·전역 네트워크 설정은 변경하지 않는다. [Apple 로컬 네트워크 계약](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

`network-support.mjs`는 Mac의 고정 `socketfilterfw` 실행 파일로 global/block-all/app 상태만 읽어 실패 복구 안내에 전달한다. Linux는 읽을 수 있는 고정 UFW 설정과 `firewall-cmd --state`로 활성 방화벽의 UDP 수신 정책을 안내한다. `sudo`·관리자 helper·전역 포트 허용·기존 규칙 변경은 수행하지 않는다. UFW/firewalld 활성 상태만으로 실제 패킷 차단을 단정하지 않는다. 권한 부족·도구 부재·조회 실패는 알 수 없음으로 취급하며 호스트 시작을 막지 않는다. 진단은 영상 준비와 병렬로 진행하고 조회 출력·개인 경로·규칙 목록을 파일에 저장하지 않는다. Linux 방화벽 수신 정책이 연결을 차단하면 운영자가 해당 정책을 승인해야 한다.

## 오류와 검증 범위

`network-status`는 후보 수(host/srflx/공개 IPv4/IPv6)·발견 완료 여부·자동 매핑 상태만 전달한다. 주소·SDP·ICE 자격증명·화면 내용을 파일에 기록하지 않는다. 브라우저는 주소 발견 실패, 경로 연결 실패, 경로/입력 준비 후 영상 디코드 실패를 구분한다. 매핑 성공만으로 외부 인터넷 연결 성공을 표시하지 않는다. 두 입력 채널과 영상 디코드가 모두 준비돼야 연결 알림·완료를 표시한다.

검사:

- `remote-desktop-connectivity.test.ts`: 실제 격리 UDP의 PCP/NAT-PMP 응답·nonce/포트 검사·갱신/삭제, 격리 HTTP의 UPnP 소유권·영구 lease 거부·외부 URL 차단, 늦은 매핑의 취소, STUN agent 교체와 오래된 협상 격리. Windows 네이티브 경로 ABI·오류/취소와 Mac/Linux의 선택 IPv4 인터페이스·다중 NIC·서비스 PATH·preferred source·VPN/IPv6-only/경로 부재와 읽기 전용 방화벽 진단도 모사한다.
- `remote-desktop-nat-webrtc.test.ts`: Windows 또는 opt-in Mac/Linux의 실제 libdatachannel·Chromium과 OS 경로 조회를 사용하고 내부 host 후보와 SDP의 주소 후보를 제거한다. 테스트 전용 UDP NAT만 통해 전달한 srflx 후보로 암호화 연결·합성 입력을 두 번 성공시키고 각 매핑을 삭제한다. 활성 연결에서 native Node GC를 두 번 강제로 실행한 뒤 새 합성 입력도 전달해 채널 wrapper 수명을 검사한다. 여러 브라우저 인터페이스의 각 출발 소켓을 보존한다. 실제 공유기·방화벽·화면·키보드는 변경하지 않는다. POSIX opt-in은 격리 helper의 `MEW_DESKTOP_TEST_NATIVE_HELPER`를 지정하며 실제 private IPv4 경로가 필요하다. Mac에서 이 fixture를 실행할 수 있다는 것이 실제 Mac 실행 검증을 뜻하지 않는다.
- `remote-desktop-network-install.test.ts`: Windows PowerShell에서 규칙·UAC 함수를 모사하여 차단/충돌 보존·정상 규칙 재사용·고정 프로그램/UDP 범위·승인 취소를 검사한다. 실제 관리자 승인이나 방화벽 변경은 수행하지 않는다.
- `remote-desktop.test.ts`·`remote-desktop-readiness.test.ts`: 인증된 협상 교체·이전 answer/candidate 차단, 브라우저의 실패 후 재시도 대기, 이전 peer의 늦은 영상 통계 격리와 새 화면의 연결 알림을 검사한다.
- 기존 상주·직접 전송·알림·설치·브라우저 검사를 유지한다.
- `remote-desktop-shutdown.test.ts`: 기존 500ms보다 긴 NAT/캡처 정리를 기다린 뒤 RTC를 해제하는 순서, 응답 없는 정리의 제한 시간, OS 어댑터 오류에도 부모 채널을 닫는 처리를 검사한다.

2026-10-02 Windows/Linux의 실제 네이티브 WebRTC·격리 UDP NAT·OS 경로 조회로 두 세션의 연결/재접속·매핑 삭제와 강제 GC 이후 새 합성 입력 전달을 통과했다. 격리 helper에서 채널 소유 참조만 제거하면 GC 이후 입력 연결 소실을 재현하여 회귀 검사의 감지 범위를 확인했다. Linux는 WSL의 Linux 프로세스이며 물리 Linux GPU·외부 인터넷의 검증으로 대체하지 않는다.

LTE·5G 폰과 집 공유기에서의 실제 첫 화면·재접속·절전/잠금/승인 회수는 사용자 적용 뒤 확인해야 한다. 이 격리 NAT 검사를 실제 통신사 망의 검증으로 표시하지 않는다. 지원 없는 공유기·CGNAT·UDP 전체 차단에서는 자동 직결도 실패할 수 있다. 수동 포트 매핑은 기본 사용 절차가 아니다. 별도 relay 추가는 이 작업의 범위에 포함하지 않는다.
