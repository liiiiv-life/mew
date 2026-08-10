import { EditorState, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { search, searchKeymap } from '@codemirror/search'

// Ctrl+F 찾기 패널 문구 — tiptap 쪽 찾기 바(EditorSearchBar)와 말을 맞춘다
const searchPhrases = EditorState.phrases.of({
  Find: '찾기',
  Replace: '바꾸기',
  next: '다음',
  previous: '이전',
  all: '모두 선택',
  'match case': '대소문자 구분',
  regexp: '정규식',
  'by word': '단어 단위',
  replace: '바꾸기',
  'replace all': '모두 바꾸기',
  close: '닫기',
  'current match': '현재 매치',
  'Go to line': '줄 이동',
  go: '이동',
  'on line': '줄',
})

/**
 * CodePane의 문서 내 찾기·바꾸기 — CodeMirror 기본 검색 패널을 그대로 쓴다. md/svg만 다루는
 * tiptap 찾기 바와 달리 여기는 코드·csv·확장자 없는 파일까지 plain으로 열리는 모든 텍스트가 지난다.
 * 패널을 위에 붙이는 이유: 아래는 모바일 가상 키보드가 가린다.
 */
export const codeSearchExtensions: Extension[] = [search({ top: true }), searchPhrases, keymap.of(searchKeymap)]
