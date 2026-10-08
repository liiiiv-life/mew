import type { Locale } from '../i18n-locales'

const en = {
  fullscreenGuide: 'Use full screen so mew shortcuts work reliably.', fullscreenEnter: 'Enter full screen', fullscreenFailed: 'Could not enter full screen. Try again.',
  updates: 'Updates are available', updateOpen: 'View updates',
  title: 'Notifications', recent: 'Recent notifications', empty: 'No recent notifications.', visual: 'Mewcat messages', desktop: 'Desktop notifications when away', sound: 'Notification sound', resources: 'Monitor server resources',
  hint: 'Receive agent completion, error and approval alerts. Resource alerts watch the machine running mew.',
  scope: 'Agent alerts cover connected chat tabs in this project. Keep the mew browser tab open. Terminal-only agents are not monitored.',
  enable: 'Allow desktop notifications', denied: 'Notifications are blocked. Allow them in your browser’s site settings.', unsupported: 'Desktop notifications need HTTPS or localhost and a supported browser.', granted: 'Desktop notifications are allowed.', default: 'Allow notifications to receive alerts outside mew.',
  test: 'Send test notification', testHint: 'For a desktop test, switch to another window within 3 seconds.', testing: 'Test in 3 seconds…', testBody: 'Mewcat is ready to notify you.', audioBlocked: 'Sound could not start. Check browser audio settings and try again.', permissionError: 'Could not request permission. Check browser site settings.',
  stopped: 'The agent stopped before completing its work', complete: 'All queued agent work is complete', error: 'The agent encountered an error', permission: 'The agent needs your approval', cpu: 'Server CPU usage is high', memory: 'Server memory is running low', gpu: 'Server GPU memory is almost full', temperature: 'Server temperature is high',
  open: 'Open conversation', system: 'View system resources', dismiss: 'Dismiss notification', clear: 'Dismiss all', count: 'Unread notifications', more: 'Show notifications', less: 'Hide list', source: 'Open the conversation for details.',
}
type Copy = { [K in keyof typeof en]: string }
export const mewcatNotificationCopy: Record<Locale, Copy> = {
  en,
  ko: {
    fullscreenGuide: '전체화면으로 사용하면 mew 단축키가 안정적으로 작동해요.', fullscreenEnter: '전체화면으로 전환', fullscreenFailed: '전체화면으로 전환하지 못했어요. 다시 눌러 주세요.',
    updates: '새 업데이트가 있어요', updateOpen: '업데이트 보기',
    title: '알림', recent: '최근 알림', empty: '최근 알림이 없어요.', visual: '뮤캣 말풍선 알림', desktop: '창이 비활성화되면 데스크톱 알림', sound: '알림 소리', resources: '서버 자원 과부하 감시',
    hint: '에이전트 작업 완료·오류·승인 요청을 알려줍니다. 자원 알림은 mew 서버가 실행되는 기계를 감시합니다.',
    scope: '현재 프로젝트에서 연결한 채팅형 에이전트 탭을 감시합니다. mew 브라우저 탭을 열어 두세요. 터미널 전용 에이전트는 감시하지 않습니다.',
    enable: '데스크톱 알림 허용', denied: '알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 허용해 주세요.', unsupported: '데스크톱 알림은 HTTPS 또는 localhost와 지원 브라우저가 필요합니다.', granted: '데스크톱 알림이 허용되어 있습니다.', default: 'mew 밖에서도 알림을 받으려면 권한을 허용해 주세요.',
    test: '테스트 알림 보내기', testHint: '데스크톱 알림을 시험하려면 3초 안에 다른 창으로 전환하세요.', testing: '3초 뒤 알림을 보냅니다…', testBody: '뮤캣이 알림을 전달할 준비가 됐어요.', audioBlocked: '소리를 재생하지 못했습니다. 브라우저 소리 설정을 확인하고 다시 시도해 주세요.', permissionError: '권한을 요청하지 못했습니다. 브라우저 사이트 설정을 확인해 주세요.',
    stopped: '에이전트가 작업을 끝내기 전에 멈췄어요', complete: '대기 중인 에이전트 작업을 모두 마쳤어요', error: '에이전트에서 오류가 발생했어요', permission: '에이전트가 승인을 기다려요', cpu: '서버 CPU 사용량이 높아요', memory: '서버 메모리가 부족해요', gpu: '서버 GPU 메모리가 거의 찼어요', temperature: '서버 온도가 높아요',
    open: '대화 열기', system: '시스템 자원 보기', dismiss: '알림 닫기', clear: '모두 확인', count: '읽지 않은 알림', more: '알림 목록 보기', less: '목록 접기', source: '대화에서 자세한 내용을 확인해 주세요.',
  },
  ja: {
    fullscreenGuide: '全画面表示にすると mew のショートカットが安定して動作します。', fullscreenEnter: '全画面表示に切り替え', fullscreenFailed: '全画面表示に切り替えられませんでした。もう一度お試しください。',
    updates: '更新があります', updateOpen: '更新を表示',
    title: '通知', recent: '最近の通知', empty: '最近の通知はありません。', visual: 'Mewcat の吹き出し', desktop: '非アクティブ時にデスクトップ通知', sound: '通知音', resources: 'サーバーリソースを監視', hint: 'エージェントの完了・エラー・承認待ちを通知します。リソース通知は mew サーバーの状態を監視します。', scope: 'このプロジェクトで接続したチャットタブが対象です。mew のブラウザータブを開いておいてください。ターミナル専用エージェントは対象外です。',
    enable: 'デスクトップ通知を許可', denied: '通知がブロックされています。ブラウザーのサイト設定で許可してください。', unsupported: 'デスクトップ通知には HTTPS または localhost と対応ブラウザーが必要です。', granted: 'デスクトップ通知が許可されています。', default: 'mew の外で通知を受け取るには権限を許可してください。', test: 'テスト通知を送信', testHint: 'デスクトップ通知のテストは3秒以内に別のウィンドウへ切り替えてください。', testing: '3秒後に通知します…', testBody: 'Mewcat の通知の準備ができました。', audioBlocked: '音を再生できません。ブラウザーの音声設定を確認してください。', permissionError: '権限を要求できません。サイト設定を確認してください。',
    stopped: 'エージェントが完了前に停止しました', complete: '待機中のエージェント作業がすべて完了しました', error: 'エージェントでエラーが発生しました', permission: 'エージェントが承認を待っています', cpu: 'サーバー CPU の使用率が高いです', memory: 'サーバーのメモリーが不足しています', gpu: 'サーバー GPU メモリーがほぼ満杯です', temperature: 'サーバーの温度が高いです', open: '会話を開く', system: 'リソースを表示', dismiss: '通知を閉じる', clear: 'すべて確認', count: '未読通知', more: '通知一覧', less: '一覧を閉じる', source: '詳細は会話で確認してください。',
  },
  'zh-CN': {
    fullscreenGuide: '使用全屏，让 mew 快捷键稳定运行。', fullscreenEnter: '切换至全屏', fullscreenFailed: '无法切换至全屏，请重试。',
    updates: '有可用更新', updateOpen: '查看更新',
    title: '通知', recent: '最近通知', empty: '暂无最近通知。', visual: 'Mewcat 气泡通知', desktop: '窗口未激活时发送桌面通知', sound: '通知声音', resources: '监控服务器资源', hint: '通知智能体任务完成、错误和审批请求。资源通知监控运行 mew 的服务器。', scope: '监控当前项目中已连接的聊天标签页。请保持 mew 浏览器标签页打开。不监控纯终端智能体。',
    enable: '允许桌面通知', denied: '通知已被屏蔽。请在浏览器的网站设置中允许。', unsupported: '桌面通知需要 HTTPS 或 localhost 以及支持的浏览器。', granted: '桌面通知已获允许。', default: '请允许通知权限以在 mew 窗口外接收提醒。', test: '发送测试通知', testHint: '测试桌面通知时，请在3秒内切换到其他窗口。', testing: '3秒后发送通知…', testBody: 'Mewcat 已准备好发送通知。', audioBlocked: '无法播放声音。请检查浏览器声音设置后重试。', permissionError: '无法请求权限。请检查网站设置。',
    stopped: '智能体在完成任务前停止了', complete: '排队的智能体任务已全部完成', error: '智能体发生错误', permission: '智能体正在等待审批', cpu: '服务器 CPU 使用率过高', memory: '服务器内存不足', gpu: '服务器 GPU 内存接近满载', temperature: '服务器温度过高', open: '打开对话', system: '查看系统资源', dismiss: '关闭通知', clear: '全部已读', count: '未读通知', more: '显示通知列表', less: '收起列表', source: '请打开对话查看详情。',
  },
}

/** Register every Mewcat message with the app's typed translation catalog. */
export function mewcatNotificationMessages(locale: Locale) {
  return Object.fromEntries(Object.entries(mewcatNotificationCopy[locale]).map(([key, value]) => [`mewcat.${key}`, value])) as {
    [K in keyof Copy as `mewcat.${K}`]: string
  }
}
