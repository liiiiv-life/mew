import { Window } from 'happy-dom'

/** The headless editor parses document HTML; it never executes document code or loads resources. */
export function createCollabDom(): Window {
  return new Window({
    url: 'http://localhost',
    settings: {
      disableJavaScriptEvaluation: true,
      enableJavaScriptEvaluation: false,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      enableCSSFileLoading: false,
      enableImageFileLoading: false,
      disableIframePageLoading: true,
      enableIframePageLoading: false,
      enableFileSystemHttpRequests: false,
      fetch: {
        interceptor: {
          beforeAsyncRequest: async () => { throw new Error('Headless document network access is disabled') },
          beforeSyncRequest: () => { throw new Error('Headless document network access is disabled') },
        },
      },
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
        disableFallbackToSetURL: true,
      },
    },
  })
}
