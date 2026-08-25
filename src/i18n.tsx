import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LOCALES, preferredLocale, type Locale } from './i18n-locales'

export { LOCALES, LOCALE_NAMES, preferredLocale, type Locale } from './i18n-locales'

const LOCALE_KEY = 'mew:locale'

const messages = {
  ko: {
    'settings.title': '설정',
    'settings.account': '계정',
    'settings.appearance': '화면',
    'settings.shortcuts': '단축키',
    'settings.ignoreList': '숨김 목록',
    'settings.close': '닫기',
    'settings.language': '언어',
    'settings.languageDescription': 'mew 화면에 표시할 언어를 선택합니다.',
    'settings.theme': '테마',
    'settings.themeDescription': '밝은 화면과 어두운 화면 중에서 고르세요.',
    'settings.light': '라이트',
    'settings.dark': '다크',
    'settings.fonts': '글꼴',
    'settings.fontsDescription': '이 기기에 설치되었거나 mew가 불러온 글꼴 이름을 입력하세요.',
    'settings.font.ui': '전역 UI 텍스트',
    'settings.font.markdown': 'Markdown 핫뷰',
    'settings.font.mono': 'Mono (코드 등)',
    'common.save': '저장',
    'common.cancel': '취소',
    'common.refresh': '새로고침',
    'common.menu': '메뉴',
    'common.login': '로그인',
    'common.add': '추가',
    'common.delete': '삭제',
    'common.reset': '초기화',
    'settings.myAccount': '내 계정',
    'settings.changePassword': '비밀번호 변경',
    'settings.currentPassword': '현재 비밀번호',
    'settings.newPassword': '새 비밀번호',
    'settings.confirmPassword': '새 비밀번호 확인',
    'settings.change': '변경',
    'settings.changing': '변경 중…',
    'settings.logout': '로그아웃',
    'settings.reassign': '재지정',
    'settings.resetAll': '전체 초기화',
    'settings.pressKey': '키를 누르세요…',
    'home.widgets': '위젯',
    'home.noWidgets': '표시할 위젯이 없습니다. 위젯 메뉴에서 켜세요.',
    'home.todos': '할 일',
    'home.calendar': '달력',
    'home.moveUp': '위로',
    'home.moveDown': '아래로',
    'header.chat': '채팅',
    'header.database': '데이터베이스',
    'header.accountManagement': '계정 관리',
    'header.scheduledTasks': '예약 작업', 'header.terminal': '터미널', 'header.systemResources': '시스템 자원',
    'header.agent': '에이전트', 'header.agentSets': '에이전트셋', 'header.browser': '브라우저',
    'fab.handle': '핸들 메뉴', 'fab.fullscreen': '전체화면 전환', 'fab.nextProject': '오른쪽 프로젝트 탭',
    'fab.nextWindowTab': '현재 창의 오른쪽 탭',
  },
  en: {
    'settings.title': 'Settings',
    'settings.account': 'Account',
    'settings.appearance': 'Appearance',
    'settings.shortcuts': 'Shortcuts',
    'settings.ignoreList': 'Ignore list',
    'settings.close': 'Close',
    'settings.language': 'Language',
    'settings.languageDescription': 'Choose the language used in the mew interface.',
    'settings.theme': 'Theme',
    'settings.themeDescription': 'Choose between the light and dark appearance.',
    'settings.light': 'Light',
    'settings.dark': 'Dark',
    'settings.fonts': 'Fonts',
    'settings.fontsDescription': 'Enter a font installed on this device or loaded by mew.',
    'settings.font.ui': 'Global UI text',
    'settings.font.markdown': 'Markdown hot view',
    'settings.font.mono': 'Mono (code, etc.)',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.refresh': 'Refresh',
    'common.menu': 'Menu',
    'common.login': 'Log in',
    'common.add': 'Add',
    'common.delete': 'Delete',
    'common.reset': 'Reset',
    'settings.myAccount': 'My account',
    'settings.changePassword': 'Change password',
    'settings.currentPassword': 'Current password',
    'settings.newPassword': 'New password',
    'settings.confirmPassword': 'Confirm new password',
    'settings.change': 'Change',
    'settings.changing': 'Changing…',
    'settings.logout': 'Log out',
    'settings.reassign': 'Reassign',
    'settings.resetAll': 'Reset all',
    'settings.pressKey': 'Press a key…',
    'home.widgets': 'Widgets',
    'home.noWidgets': 'No widgets are displayed. Enable one from the Widgets menu.',
    'home.todos': 'To-dos',
    'home.calendar': 'Calendar',
    'home.moveUp': 'Move up',
    'home.moveDown': 'Move down',
    'header.chat': 'Chat',
    'header.database': 'Database',
    'header.accountManagement': 'Manage accounts',
    'header.scheduledTasks': 'Scheduled tasks', 'header.terminal': 'Terminal', 'header.systemResources': 'System resources',
    'header.agent': 'Agent', 'header.agentSets': 'Agent sets', 'header.browser': 'Browser',
    'fab.handle': 'Handle menu', 'fab.fullscreen': 'Toggle fullscreen', 'fab.nextProject': 'Next project tab',
    'fab.nextWindowTab': 'Next tab in current panel',
  },
  'zh-CN': {
    'settings.title': '设置',
    'settings.account': '账户',
    'settings.appearance': '外观',
    'settings.shortcuts': '快捷键',
    'settings.ignoreList': '忽略列表',
    'settings.close': '关闭',
    'settings.language': '语言',
    'settings.languageDescription': '选择 mew 界面使用的语言。',
    'settings.theme': '主题',
    'settings.themeDescription': '选择浅色或深色外观。',
    'settings.light': '浅色',
    'settings.dark': '深色',
    'settings.fonts': '字体',
    'settings.fontsDescription': '输入此设备已安装或由 mew 加载的字体名称。',
    'settings.font.ui': '全局界面文本',
    'settings.font.markdown': 'Markdown 热视图',
    'settings.font.mono': '等宽字体（代码等）',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.refresh': '刷新',
    'common.menu': '菜单',
    'common.login': '登录',
    'common.add': '添加',
    'common.delete': '删除',
    'common.reset': '重置',
    'settings.myAccount': '我的账户',
    'settings.changePassword': '修改密码',
    'settings.currentPassword': '当前密码',
    'settings.newPassword': '新密码',
    'settings.confirmPassword': '确认新密码',
    'settings.change': '修改',
    'settings.changing': '正在修改…',
    'settings.logout': '退出登录',
    'settings.reassign': '重新指定',
    'settings.resetAll': '全部重置',
    'settings.pressKey': '请按任意键…',
    'home.widgets': '小组件',
    'home.noWidgets': '没有显示的小组件。请在小组件菜单中启用。',
    'home.todos': '待办事项',
    'home.calendar': '日历',
    'home.moveUp': '上移',
    'home.moveDown': '下移',
    'header.chat': '聊天',
    'header.database': '数据库',
    'header.accountManagement': '管理账户',
    'header.scheduledTasks': '定时任务', 'header.terminal': '终端', 'header.systemResources': '系统资源',
    'header.agent': '代理', 'header.agentSets': '代理集', 'header.browser': '浏览器',
    'fab.handle': '方向菜单', 'fab.fullscreen': '切换全屏', 'fab.nextProject': '右侧项目标签',
    'fab.nextWindowTab': '当前面板的右侧标签',
  },
  ja: {
    'settings.title': '設定',
    'settings.account': 'アカウント',
    'settings.appearance': '表示',
    'settings.shortcuts': 'ショートカット',
    'settings.ignoreList': '除外リスト',
    'settings.close': '閉じる',
    'settings.language': '言語',
    'settings.languageDescription': 'mew の画面に表示する言語を選択します。',
    'settings.theme': 'テーマ',
    'settings.themeDescription': 'ライトまたはダークの表示を選択します。',
    'settings.light': 'ライト',
    'settings.dark': 'ダーク',
    'settings.fonts': 'フォント',
    'settings.fontsDescription': 'この端末にインストール済み、または mew が読み込んだフォント名を入力します。',
    'settings.font.ui': '全体の UI テキスト',
    'settings.font.markdown': 'Markdown ホットビュー',
    'settings.font.mono': '等幅（コードなど）',
    'common.save': '保存',
    'common.cancel': 'キャンセル',
    'common.refresh': '更新',
    'common.menu': 'メニュー',
    'common.login': 'ログイン',
    'common.add': '追加',
    'common.delete': '削除',
    'common.reset': 'リセット',
    'settings.myAccount': 'マイアカウント',
    'settings.changePassword': 'パスワードを変更',
    'settings.currentPassword': '現在のパスワード',
    'settings.newPassword': '新しいパスワード',
    'settings.confirmPassword': '新しいパスワードを確認',
    'settings.change': '変更',
    'settings.changing': '変更中…',
    'settings.logout': 'ログアウト',
    'settings.reassign': '再割り当て',
    'settings.resetAll': 'すべてリセット',
    'settings.pressKey': 'キーを押してください…',
    'home.widgets': 'ウィジェット',
    'home.noWidgets': '表示するウィジェットがありません。ウィジェットメニューで有効にしてください。',
    'home.todos': 'ToDo',
    'home.calendar': 'カレンダー',
    'home.moveUp': '上へ',
    'home.moveDown': '下へ',
    'header.chat': 'チャット',
    'header.database': 'データベース',
    'header.accountManagement': 'アカウント管理',
    'header.scheduledTasks': '予約タスク', 'header.terminal': 'ターミナル', 'header.systemResources': 'システムリソース',
    'header.agent': 'エージェント', 'header.agentSets': 'エージェントセット', 'header.browser': 'ブラウザー',
    'fab.handle': '方向メニュー', 'fab.fullscreen': '全画面表示を切替', 'fab.nextProject': '右のプロジェクトタブ',
    'fab.nextWindowTab': '現在のパネルの右タブ',
  },
} as const

export type TranslationKey = keyof (typeof messages)['ko']

const shortcutTranslations: Record<Locale, Record<string, string>> = {
  ko: {},
  en: {
    '전역': 'Global', '협업': 'Collaboration', '파일 트리': 'File tree', '터미널·에이전트': 'Terminal & agent', '에디터': 'Editor',
    save: 'Save (commit)', quickOpen: 'Quick open file', projectSearch: 'Search project', toggleTerminal: 'Open/close terminal',
    toggleTerminalAlt: 'Open/close terminal (alternative)', toggleSidebar: 'Open/close sidebar', closeTab: 'Close tab', newTab: 'New file',
    prevTab: 'Previous tab', nextTab: 'Next tab', fullscreen: 'Toggle full screen', toggleChat: 'Open/close chat',
    toggleBrowser: 'Open/close browser', addComment: 'Comment on selection', treeRename: 'Rename', treeDelete: 'Delete',
    treeNewFile: 'New file', treeNewFolder: 'New folder', treeNewFileAlt: 'New file (alternative)', treeNewFolderAlt: 'New folder (alternative)',
    insertPathOrSelection: 'Insert path or selected text', sendAgentMessage: 'Send agent message', undo: 'Undo', redo: 'Redo',
    insertLink: 'Insert/edit link', editorFind: 'Find and replace in document',
  },
  'zh-CN': {
    '전역': '全局', '협업': '协作', '파일 트리': '文件树', '터미널·에이전트': '终端和代理', '에디터': '编辑器',
    save: '保存（提交）', quickOpen: '快速打开文件', projectSearch: '搜索项目', toggleTerminal: '打开/关闭终端',
    toggleTerminalAlt: '打开/关闭终端（备用）', toggleSidebar: '打开/关闭侧边栏', closeTab: '关闭标签页', newTab: '新建文件',
    prevTab: '上一个标签页', nextTab: '下一个标签页', fullscreen: '切换全屏', toggleChat: '打开/关闭聊天',
    toggleBrowser: '打开/关闭浏览器', addComment: '为选中内容添加评论', treeRename: '重命名', treeDelete: '删除',
    treeNewFile: '新建文件', treeNewFolder: '新建文件夹', treeNewFileAlt: '新建文件（备用）', treeNewFolderAlt: '新建文件夹（备用）',
    insertPathOrSelection: '插入路径或选中文本', sendAgentMessage: '发送代理消息', undo: '撤销', redo: '重做',
    insertLink: '插入/编辑链接', editorFind: '在文档中查找和替换',
  },
  ja: {
    '전역': '全体', '협업': '共同作業', '파일 트리': 'ファイルツリー', '터미널·에이전트': 'ターミナルとエージェント', '에디터': 'エディター',
    save: '保存（コミット）', quickOpen: 'ファイルをクイックオープン', projectSearch: 'プロジェクトを検索', toggleTerminal: 'ターミナルを開く/閉じる',
    toggleTerminalAlt: 'ターミナルを開く/閉じる（代替）', toggleSidebar: 'サイドバーを開く/閉じる', closeTab: 'タブを閉じる', newTab: '新規ファイル',
    prevTab: '前のタブ', nextTab: '次のタブ', fullscreen: '全画面表示を切替', toggleChat: 'チャットを開く/閉じる',
    toggleBrowser: 'ブラウザーを開く/閉じる', addComment: '選択範囲にコメント', treeRename: '名前を変更', treeDelete: '削除',
    treeNewFile: '新規ファイル', treeNewFolder: '新規フォルダー', treeNewFileAlt: '新規ファイル（代替）', treeNewFolderAlt: '新規フォルダー（代替）',
    insertPathOrSelection: 'パスまたは選択テキストを挿入', sendAgentMessage: 'エージェントメッセージを送信', undo: '元に戻す', redo: 'やり直す',
    insertLink: 'リンクを挿入/編集', editorFind: '文書内を検索・置換',
  },
}

export function localizeShortcut(locale: Locale, idOrCategory: string, fallback: string): string {
  return shortcutTranslations[locale][idOrCategory] ?? fallback
}

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value)
}

function initialLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_KEY)
  return isLocale(saved) ? saved : preferredLocale(navigator.languages)
}

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey) => string
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale)

  useEffect(() => {
    localStorage.setItem(LOCALE_KEY, locale)
    document.documentElement.lang = locale
  }, [locale])

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => messages[locale][key],
      formatDate: (date, options) => new Intl.DateTimeFormat(locale, options).format(new Date(date)),
    }),
    [locale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used within I18nProvider')
  return context
}
