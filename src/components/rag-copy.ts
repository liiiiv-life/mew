const en = {
  title: 'RAG', close: 'Close RAG', refresh: 'Refresh', settings: 'Shared settings', shared: 'Applies to every project on this Mew server.',
  enabled: 'Use local RAG', guidance: 'Guide agents to use RAG', guidanceHint: 'Provides a local search command on the next ACP request. Requires automatic project guidance. Agents decide when to run it; terminal input is unchanged.',
  environment: 'Disabled by the server environment (MEW_RAG_ENABLED=0).', readOnly: 'System permission is required to change settings or rebuild the index.',
  database: 'Vector database', project: 'Search scope', current: 'Current project', docs: 'Documents', model: 'Embedding model', files: 'Files', chunks: 'Chunks', dimensions: 'Dimensions',
  ready: 'Indexed', empty: 'Not indexed yet', disabled: 'Disabled', rebuild: 'Rebuild index', startIndex: 'Start indexing', indexed: 'Docs indexed.', working: 'Working…', loading: 'Loading…',
  firstUse: 'First search or rebuild downloads the local model if needed and indexes text files. Documents stay on this server.',
  search: 'Search', query: 'Search project knowledge', history: 'Include History / raw', results: 'Search results', noResults: 'No matching documents.',
  documents: 'Indexed files', noDocuments: 'No indexed files. Use Start indexing to index Docs.', filter: 'Filter file paths', noFiles: 'No matching files.',
  cache: 'Markdown and code are the source of truth. This database is a derived cache.', retry: 'Retry', saved: 'Shared settings saved.', rebuilt: 'Index rebuilt.',
}
export const ragCopy = {
  en,
  ko: {
    title: 'RAG', close: 'RAG 닫기', refresh: '새로고침', settings: '공통 설정', shared: '이 Mew 서버의 모든 프로젝트에 적용됩니다.',
    enabled: '로컬 RAG 사용', guidance: '에이전트에 RAG 사용 안내', guidanceHint: '프로젝트 자동 안내가 켜져 있으면 다음 ACP 요청부터 로컬 검색 명령을 전달합니다. 실제 검색은 에이전트가 판단해 실행하며 터미널 직접 입력에는 적용되지 않습니다.',
    environment: '서버 환경 설정(MEW_RAG_ENABLED=0)으로 비활성화되어 있습니다.', readOnly: '설정 변경과 재색인에는 시스템 관리 권한이 필요합니다.',
    database: '벡터 DB', project: '검색 범위', current: '현재 프로젝트', docs: 'Documents', model: '임베딩 모델', files: '파일', chunks: '청크', dimensions: '차원',
    ready: '색인 있음', empty: '아직 색인 없음', disabled: '사용 안 함', rebuild: '재색인', startIndex: '색인 시작', indexed: 'Docs를 색인했습니다.', working: '처리 중…', loading: '불러오는 중…',
    firstUse: '첫 검색·재색인 때 로컬 모델을 준비하고 텍스트 파일을 색인합니다. 문서는 서버 밖으로 전송하지 않습니다.',
    search: '검색', query: '프로젝트 지식 검색', history: 'History / raw 포함', results: '검색 결과', noResults: '일치하는 문서가 없습니다.',
    documents: '색인된 파일', noDocuments: '색인된 파일이 없습니다. 색인 시작을 눌러 Docs를 색인해 주세요.', filter: '파일 경로 필터', noFiles: '일치하는 파일이 없습니다.',
    cache: 'Markdown·코드가 기준본이며 벡터 DB는 다시 만들 수 있는 캐시입니다.', retry: '다시 시도', saved: '공통 설정을 저장했습니다.', rebuilt: '재색인했습니다.',
  },
  ja: { ...en, close: 'RAGを閉じる', refresh: '更新', settings: '共通設定', shared: 'このMewサーバーの全プロジェクトに適用されます。', enabled: 'ローカルRAGを使う', guidance: 'エージェントにRAGを案内', database: 'ベクトルDB', project: '検索範囲', current: '現在のプロジェクト', model: '埋め込みモデル', files: 'ファイル', chunks: 'チャンク', dimensions: '次元', ready: '索引あり', empty: '索引なし', disabled: '無効', rebuild: '再索引', startIndex: '索引を作成', indexed: 'Docsの索引を作成しました。', working: '処理中…', loading: '読み込み中…', search: '検索', query: 'プロジェクト知識を検索', history: 'History / rawを含める', results: '検索結果', noResults: '一致する文書はありません。', documents: '索引済みファイル', filter: 'ファイルパスを絞り込む', retry: '再試行' },
  'zh-CN': { ...en, close: '关闭 RAG', refresh: '刷新', settings: '通用设置', shared: '应用于此 Mew 服务器的所有项目。', enabled: '使用本地 RAG', guidance: '引导代理使用 RAG', database: '向量数据库', project: '搜索范围', current: '当前项目', model: '嵌入模型', files: '文件', chunks: '分块', dimensions: '维度', ready: '已索引', empty: '尚未索引', disabled: '已停用', rebuild: '重新索引', startIndex: '开始索引', indexed: '已为 Docs 建立索引。', working: '处理中…', loading: '加载中…', search: '搜索', query: '搜索项目知识', history: '包含 History / raw', results: '搜索结果', noResults: '没有匹配的文档。', documents: '已索引文件', filter: '筛选文件路径', retry: '重试' },
}
