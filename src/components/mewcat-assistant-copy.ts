import type { Locale } from '../i18n-locales'
const copy = {
  ko: {
    title: '뮤펫 도우미', hint: '메모 앱을 만들고 싶어', input: '뮤펫 도우미에게 질문', connect: '에이전트 연결', guide: '에이전트 패널에서 사용할 AI를 선택하고 로그인하세요.', agent: '도우미 에이전트', change: '도우미 에이전트 변경', send: '전송', stop: '중지', preparing: '에이전트 연결 중…', thinking: '답변 중…', failed: '도우미 연결 또는 작업에 실패했습니다. 다시 연결해 주세요.', retry: '다시 연결', login: '에이전트 로그인이 필요합니다.', clear: '대화 기록 지우기', allow: '이번 작업 허용', deny: '거절', permission: '작업 승인 필요', details: '오류 상세', open_project: '프로젝트를 여는 중…', open_panel: '화면을 여는 중…', open_file: '파일을 여는 중…', refresh_documents: '문서를 갱신하는 중…', start_project_session: '프로젝트 대화를 준비하는 중…', draftReady: '프로젝트 대화에 요청을 준비했어요. 확인하고 전송하세요.',
  },
  en: {
    title: 'Mewpet assistant', hint: 'I want to build a notes app', input: 'Ask the Mewpet assistant', connect: 'Connect an agent', guide: 'Choose an AI in the agent panel and sign in.', agent: 'Assistant agent', change: 'Change assistant agent', send: 'Send', stop: 'Stop', preparing: 'Connecting to the agent…', thinking: 'Responding…', failed: 'The assistant connection or action failed. Please reconnect.', retry: 'Reconnect', login: 'Sign in to your agent to continue.', clear: 'Clear conversation', allow: 'Allow this action', deny: 'Decline', permission: 'Action approval required', details: 'Error details', open_project: 'Opening the project…', open_panel: 'Opening the screen…', open_file: 'Opening the file…', refresh_documents: 'Refreshing documents…', start_project_session: 'Preparing the project conversation…', draftReady: 'Your request is ready in the project conversation. Review and send it.',
  },
  ja: {
    title: 'Mewアシスタント', hint: 'メモアプリを作りたい', input: 'Mewアシスタントに質問', connect: 'エージェントを接続', guide: 'エージェントパネルでAIを選び、ログインしてください。', agent: 'アシスタントのエージェント', change: 'アシスタントのエージェントを変更', send: '送信', stop: '停止', preparing: 'エージェントに接続中…', thinking: '回答中…', failed: '接続または操作に失敗しました。再接続してください。', retry: '再接続', login: 'エージェントへのログインが必要です。', clear: '会話履歴を消去', allow: 'この操作を許可', deny: '拒否', permission: '操作の承認が必要です', details: 'エラーの詳細', open_project: 'プロジェクトを開いています…', open_panel: '画面を開いています…', open_file: 'ファイルを開いています…', refresh_documents: '文書を更新しています…', start_project_session: 'プロジェクトの会話を準備しています…', draftReady: 'プロジェクトの会話に依頼を用意しました。確認して送信してください。',
  },
  'zh-CN': {
    title: 'Mew助手', hint: '我想做一个笔记应用', input: '向Mew助手提问', connect: '连接智能体', guide: '在智能体面板中选择AI并登录。', agent: '助手智能体', change: '更换助手智能体', send: '发送', stop: '停止', preparing: '正在连接智能体…', thinking: '正在回答…', failed: '助手连接或操作失败，请重新连接。', retry: '重新连接', login: '请先登录智能体。', clear: '清空对话记录', allow: '允许此次操作', deny: '拒绝', permission: '需要批准操作', details: '错误详情', open_project: '正在打开项目…', open_panel: '正在打开页面…', open_file: '正在打开文件…', refresh_documents: '正在更新文档…', start_project_session: '正在准备项目对话…', draftReady: '请求已准备在项目对话中，请确认后发送。',
  },
} satisfies Record<Locale, Record<string, string>>
export function mewcatAssistantMessages(locale: Locale) {
  const c = copy[locale]
  return Object.fromEntries(Object.entries(c).map(([key, value]) => [`mewcat.assistant.${key}`, value])) as Record<`mewcat.assistant.${keyof typeof copy.ko}`, string>
}
