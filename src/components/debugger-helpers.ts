import type { Locale } from '../i18n-locales'

export const debugInput = 'min-w-0 rounded border border-edge-strong bg-surface-deep px-2 py-1.5 text-xs text-ink placeholder:text-ink-muted caret-accent focus:border-accent focus:outline-none disabled:opacity-50'
export const debugButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-secondary enabled:hover:bg-surface-raised enabled:hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-35'
export const debugPrimaryButton = 'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded bg-accent px-2 text-xs font-medium text-ink-on-accent enabled:hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40'
export const debugError = 'break-words rounded border border-danger/30 bg-danger-surface px-2 py-1.5 text-xs text-danger-ink'
export const debugTextButton = 'inline-flex min-h-7 items-center gap-1 rounded px-1 text-xs text-accent enabled:hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40'
const en = {
  sessionOptions: 'Session & execution', advancedBreakpoints: 'Advanced breakpoints', startShort: 'Start', continueShort: 'Continue', statement: 'Statement', noWatches: 'No pinned watches', noOutput: 'No output', verified: 'Verified breakpoint',
  locations: 'Breakable locations', heapSnapshot: 'Heap snapshot', session: 'Session', addSession: 'Start additional session', compounds: 'Compound launch', eof: 'Close input', type: 'Type', lazy: 'Evaluate on request', agentBridge: 'Allow project agents to use the debugger', browserAnalysis: 'Browser analysis', capture: 'Capture', coverage: 'Coverage', cpuProfile: 'CPU profile', heapProfile: 'Allocation samples', browserTab: 'Browser tab', domSelector: 'DOM selector', eventName: 'Event name', xhrUrl: 'XHR URL contains', browserBreakpoints: 'Browser breakpoints', detach: 'Disconnect analysis',
  condition: 'Condition', hitCondition: 'Hit count', logMessage: 'Log message', column: 'Column', options: 'Breakpoint options', trigger: 'Activate after breakpoint', none: 'None',
  functions: 'Function breakpoints', exceptions: 'Exception breakpoints', data: 'Data breakpoints', instructions: 'Instruction breakpoints', name: 'Name',
  restart: 'Restart', restartFrame: 'Restart frame', stepBack: 'Step back', reverse: 'Reverse continue', runTo: 'Run to location', goto: 'Move execution here',
  granularity: 'Step unit', thread: 'Thread', connection: 'Target', targets: 'Step into target', singleThread: 'Only selected thread',
  console: 'Debug console', execute: 'Evaluate', completions: 'Complete expression', more: 'Load more', expensive: 'Load expensive scope',
  edit: 'Set variable', value: 'Value', memory: 'Memory', reference: 'Memory reference', offset: 'Offset', count: 'Bytes', read: 'Read memory', write: 'Write memory', hex: 'Hexadecimal',
  unreadable: 'Unreadable bytes', bytesWritten: 'Bytes written', export: 'Export', disassemble: 'Disassembly', modules: 'Modules', sources: 'Loaded sources', source: 'Source', details: 'Exception details',
  history: 'Stop history', live: 'Live state', compare: 'Compare stops', table: 'Table', chart: 'Chart', access: 'Access', readAccess: 'Read', writeAccess: 'Write', both: 'Read / write',
  noHistory: 'No captured values', readOnly: 'Historical snapshot', loading: 'Loading', unsupported: 'Not supported by this adapter', all: 'All', named: 'Properties', indexed: 'Elements',
  profiles: 'Launch profile', defaultProfile: 'Default configuration', import: 'Import launch.json', skipFiles: 'Skip files (one pattern per line)', smartStep: 'Skip generated code', asyncStacks: 'Async call stacks',
  functionName: 'Function name', instructionReference: 'Instruction address', clear: 'Clear', outputInput: 'Program input', send: 'Send input', cancel: 'Cancel operation',
  artifacts: 'Analysis files', openArtifact: 'Open analysis file', tests: 'Debug test', testFile: 'Test file', testName: 'Test name', runner: 'Test runner', testTimeout: 'Test timeout disabled while debugging',
} as const
export type DebugExtraCopy = { [K in keyof typeof en]: string }
const ko: DebugExtraCopy = {
  sessionOptions: '세션·실행 옵션', advancedBreakpoints: '고급 중단점', startShort: '시작', continueShort: '계속', statement: '문장', noWatches: '고정한 변수 없음', noOutput: '출력 없음', verified: '확인된 중단점',
  locations: '중단 가능한 위치', heapSnapshot: '힙 스냅샷', session: '세션', addSession: '추가 세션 시작', compounds: '복합 실행', eof: '입력 종료', type: '종류', lazy: '요청 시 평가', agentBridge: '프로젝트 에이전트의 디버거 사용 허용', browserAnalysis: '브라우저 분석', capture: '수집', coverage: '실행 커버리지', cpuProfile: 'CPU 프로파일', heapProfile: '할당 샘플', browserTab: '브라우저 탭', domSelector: 'DOM 선택자', eventName: '이벤트 이름', xhrUrl: 'XHR URL 포함 문자열', browserBreakpoints: '브라우저 중단점', detach: '분석 연결 해제',
  condition: '조건', hitCondition: '중단 횟수', logMessage: '로그 메시지', column: '열', options: '중단점 옵션', trigger: '이 중단점 이후 활성화', none: '없음',
  functions: '함수 중단점', exceptions: '예외 중단점', data: '데이터 중단점', instructions: '명령어 중단점', name: '이름',
  restart: '재시작', restartFrame: '프레임 재시작', stepBack: '이전 단계', reverse: '역방향 계속', runTo: '지정 위치까지 실행', goto: '실행 위치 이동',
  granularity: '단계 단위', thread: '스레드', connection: '대상', targets: '호출 대상 선택', singleThread: '선택한 스레드만 실행',
  console: '디버그 콘솔', execute: '표현식 실행', completions: '표현식 자동완성', more: '더 보기', expensive: '추가 범위 조회',
  edit: '변수 값 수정', value: '값', memory: '메모리', reference: '메모리 참조', offset: '오프셋', count: '바이트 수', read: '메모리 읽기', write: '메모리 쓰기', hex: '16진수',
  unreadable: '읽을 수 없는 바이트', bytesWritten: '쓴 바이트', export: '내보내기', disassemble: '디스어셈블', modules: '모듈', sources: '로드된 소스', source: '소스', details: '예외 상세',
  history: '중단 기록', live: '현재 상태', compare: '중단 값 비교', table: '표', chart: '차트', access: '접근 방식', readAccess: '읽기', writeAccess: '쓰기', both: '읽기 / 쓰기',
  noHistory: '기록된 값 없음', readOnly: '과거 중단 기록', loading: '조회 중', unsupported: '이 어댑터에서 지원하지 않음', all: '전체', named: '속성', indexed: '배열 요소',
  profiles: '실행 프로필', defaultProfile: '기본 설정', import: 'launch.json 가져오기', skipFiles: '건너뛸 파일 (줄마다 경로 패턴)', smartStep: '생성 코드 건너뛰기', asyncStacks: '비동기 호출 스택',
  functionName: '함수 이름', instructionReference: '명령어 주소', clear: '비우기', outputInput: '프로그램 입력', send: '입력 보내기', cancel: '작업 취소',
  artifacts: '분석 파일', openArtifact: '분석 파일 열기', tests: '테스트 디버깅', testFile: '테스트 파일', testName: '테스트 이름', runner: '테스트 실행기', testTimeout: '디버깅 중 테스트 시간 제한 해제',
}
const ja: DebugExtraCopy = {
  sessionOptions: 'セッション・実行', advancedBreakpoints: '高度な中断点', startShort: '開始', continueShort: '続行', statement: '文', noWatches: '固定した変数なし', noOutput: '出力なし', verified: '確認済みの中断点',
  locations: '中断可能な位置', heapSnapshot: 'ヒープスナップショット', session: 'セッション', addSession: '追加セッションを開始', compounds: '複合実行', eof: '入力を閉じる', type: '種類',
  lazy: '要求時に評価', agentBridge: 'プロジェクトエージェントのデバッガー使用を許可', browserAnalysis: 'ブラウザー分析', capture: '収集', coverage: '実行カバレッジ', cpuProfile: 'CPUプロファイル', heapProfile: '割り当てサンプル', browserTab: 'ブラウザータブ', domSelector: 'DOMセレクター', eventName: 'イベント名', xhrUrl: 'XHR URLに含む文字列', browserBreakpoints: 'ブラウザー中断点', detach: '分析接続を解除',
  condition: '条件', hitCondition: 'ヒット回数', logMessage: 'ログメッセージ', column: '列', options: '中断点オプション', trigger: '中断点の後に有効化', none: 'なし',
  functions: '関数中断点', exceptions: '例外中断点', data: 'データ中断点', instructions: '命令中断点', name: '名前',
  restart: '再起動', restartFrame: 'フレームを再起動', stepBack: '前のステップ', reverse: '逆方向に続行', runTo: '指定位置まで実行', goto: '実行位置を移動', granularity: 'ステップ単位', thread: 'スレッド', connection: '対象', targets: '呼び出し先を選択', singleThread: '選択スレッドのみ',
  console: 'デバッグコンソール', execute: '式を評価', completions: '式の補完', more: 'さらに表示', expensive: '追加スコープを取得', edit: '変数を変更', value: '値', memory: 'メモリ', reference: 'メモリ参照', offset: 'オフセット', count: 'バイト数', read: 'メモリを読む', write: 'メモリを書く', hex: '16進数',
  unreadable: '読めないバイト', bytesWritten: '書き込んだバイト', export: 'エクスポート', disassemble: '逆アセンブル', modules: 'モジュール', sources: '読み込んだソース', source: 'ソース', details: '例外の詳細', history: '停止履歴', live: '現在の状態', compare: '停止時の値を比較', table: '表', chart: 'グラフ', access: 'アクセス', readAccess: '読み取り', writeAccess: '書き込み', both: '読み取り・書き込み',
  noHistory: '記録された値なし', readOnly: '過去の停止記録', loading: '取得中', unsupported: 'このアダプターでは未対応', all: 'すべて', named: 'プロパティ', indexed: '要素', profiles: '実行プロファイル', defaultProfile: '既定の設定', import: 'launch.jsonを取り込む', skipFiles: 'スキップするファイル（1行に1パターン）', smartStep: '生成コードをスキップ', asyncStacks: '非同期呼び出しスタック', functionName: '関数名', instructionReference: '命令アドレス', clear: '消去', outputInput: 'プログラム入力', send: '入力を送信', cancel: '操作をキャンセル', artifacts: '分析ファイル', openArtifact: '分析ファイルを開く', tests: 'テストをデバッグ', testFile: 'テストファイル', testName: 'テスト名', runner: 'テストランナー', testTimeout: 'デバッグ中のテスト時間制限を解除',
}
const zh: DebugExtraCopy = {
  sessionOptions: '会话与执行', advancedBreakpoints: '高级断点', startShort: '开始', continueShort: '继续', statement: '语句', noWatches: '没有固定变量', noOutput: '暂无输出', verified: '已验证断点',
  locations: '可中断的位置', heapSnapshot: '堆快照', session: '会话', addSession: '启动其他会话', compounds: '组合启动', eof: '关闭输入', type: '类型',
  lazy: '按需求值', agentBridge: '允许项目代理使用调试器', browserAnalysis: '浏览器分析', capture: '采集', coverage: '执行覆盖率', cpuProfile: 'CPU分析', heapProfile: '分配采样', browserTab: '浏览器标签页', domSelector: 'DOM选择器', eventName: '事件名称', xhrUrl: 'XHR URL包含', browserBreakpoints: '浏览器断点', detach: '断开分析连接',
  condition: '条件', hitCondition: '命中次数', logMessage: '日志消息', column: '列', options: '断点选项', trigger: '在此断点后启用', none: '无', functions: '函数断点', exceptions: '异常断点', data: '数据断点', instructions: '指令断点', name: '名称',
  restart: '重启', restartFrame: '重启栈帧', stepBack: '后退一步', reverse: '反向继续', runTo: '运行到指定位置', goto: '移动执行位置', granularity: '步进单位', thread: '线程', connection: '目标', targets: '选择调用目标', singleThread: '仅选中的线程', console: '调试控制台', execute: '表达式求值', completions: '补全表达式', more: '加载更多', expensive: '加载其他作用域',
  edit: '修改变量', value: '值', memory: '内存', reference: '内存引用', offset: '偏移量', count: '字节数', read: '读取内存', write: '写入内存', hex: '十六进制', unreadable: '不可读字节', bytesWritten: '已写入字节', export: '导出', disassemble: '反汇编', modules: '模块', sources: '已加载源码', source: '源码', details: '异常详情', history: '暂停历史', live: '当前状态', compare: '比较暂停值', table: '表格', chart: '图表', access: '访问方式', readAccess: '读取', writeAccess: '写入', both: '读写',
  noHistory: '没有已记录的值', readOnly: '历史暂停快照', loading: '加载中', unsupported: '此适配器不支持', all: '全部', named: '属性', indexed: '元素', profiles: '运行配置', defaultProfile: '默认配置', import: '导入launch.json', skipFiles: '跳过的文件（每行一个模式）', smartStep: '跳过生成的代码', asyncStacks: '异步调用栈', functionName: '函数名称', instructionReference: '指令地址', clear: '清空', outputInput: '程序输入', send: '发送输入', cancel: '取消操作', artifacts: '分析文件', openArtifact: '打开分析文件', tests: '调试测试', testFile: '测试文件', testName: '测试名称', runner: '测试运行器', testTimeout: '调试时取消测试超时限制',
}
export function debuggerExtra(locale: Locale): DebugExtraCopy { return locale === 'ko' ? ko : locale === 'ja' ? ja : locale === 'zh-CN' ? zh : en }
export type DebugCommand = <T = Record<string, unknown>>(name: string, args?: Record<string, unknown>) => Promise<T>
export function downloadDebugFile(name: string, data: BlobPart, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type })), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
