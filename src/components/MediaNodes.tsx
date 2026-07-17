import { Node, mergeAttributes } from '@tiptap/core'

// 오디오/비디오는 마크다운 표준 문법이 없어 raw HTML로 저장한다 (tiptap-markdown의 html:true 옵션이 파싱을 처리)
export const AudioNode = Node.create({
  name: 'audio',
  group: 'block',

  addAttributes() {
    return {
      src: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'audio[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(HTMLAttributes, { controls: 'true' })]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`<audio src="${node.attrs.src}" controls></audio>`)
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})

export const VideoNode = Node.create({
  name: 'video',
  group: 'block',

  addAttributes() {
    return {
      src: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'video[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'true' })]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`<video src="${node.attrs.src}" controls></video>`)
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})

const YOUTUBE_EMBED_BASE = 'https://www.youtube.com/embed/'
const YOUTUBE_IFRAME_ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'

export const Youtube = Node.create({
  name: 'youtube',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      videoId: {
        default: null,
        parseHTML: (element) => {
          const src = element.getAttribute('src') ?? ''
          return /embed\/([\w-]{11})/.exec(src)?.[1] ?? null
        },
        // src는 renderHTML에서 videoId로부터 계산해서 넣으므로 여기선 별도 속성을 만들지 않는다
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'iframe[src*="youtube.com/embed"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'iframe',
      mergeAttributes(HTMLAttributes, {
        src: `${YOUTUBE_EMBED_BASE}${node.attrs.videoId}`,
        class: 'youtube-embed',
        frameborder: '0',
        allow: YOUTUBE_IFRAME_ALLOW,
        allowfullscreen: 'true',
      }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(
            `<iframe src="${YOUTUBE_EMBED_BASE}${node.attrs.videoId}" class="youtube-embed" frameborder="0" allow="${YOUTUBE_IFRAME_ALLOW}" allowfullscreen></iframe>`,
          )
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})

// youtube.com/watch, youtu.be, shorts, embed URL 전체를 매치 — 붙여넣은 텍스트가 이 형태 "전체"일 때만 임베드로 변환
export const YOUTUBE_URL_RE =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[?&][^\s]*)?$/i
