import { uiText } from '@mew/ui/i18n-core'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { search, searchKeymap } from '@codemirror/search'

// Ctrl+F 찾기 패널 문구 — tiptap 쪽 찾기 바(EditorSearchBar)와 말을 맞춘다
const searchPhrases = () => EditorState.phrases.of({
  get Find() { return uiText("찾기") },
  get Replace() { return uiText("바꾸기") },
  get next() { return uiText("다음") },
  get previous() { return uiText("이전") },
  get all() { return uiText("모두 선택") },
  get 'match case'() { return uiText("대소문자 구분") },
  get regexp() { return uiText("정규식") },
  get 'by word'() { return uiText("단어 단위") },
  get replace() { return uiText("바꾸기") },
  get 'replace all'() { return uiText("모두 바꾸기") },
  get close() { return uiText("닫기") },
  get 'current match'() { return uiText("현재 매치") },
  get 'Go to line'() { return uiText("줄 이동") },
  get go() { return uiText("이동") },
  get 'on line'() { return uiText("줄") },
})

/**
 * CodePane의 문서 내 찾기·바꾸기 — CodeMirror 기본 검색 패널을 그대로 쓴다. md/svg만 다루는
 * tiptap 찾기 바와 달리 여기는 코드·csv·확장자 없는 파일까지 plain으로 열리는 모든 텍스트가 지난다.
 * 패널을 위에 붙이는 이유: 아래는 모바일 가상 키보드가 가린다.
 */
const language = new Compartment()
export const refreshCodeSearchLanguage = () => language.reconfigure(searchPhrases())
export const codeSearchExtensions: Extension[] = [search({ top: true }), language.of(searchPhrases()), keymap.of(searchKeymap)]
