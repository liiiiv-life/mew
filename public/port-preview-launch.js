let bridge, frame, initialized = false
const owner = document.querySelector('meta[name="mew-preview-parent"]').content
const close = () => { bridge?.postMessage({ type: 'closed' }); bridge?.close(); frame?.remove() }
window.addEventListener('message', event => {
  if (event.source === parent && event.origin === owner && event.data?.type === 'mew-preview-init' && event.ports[0] && !initialized) {
    initialized = true; bridge = event.ports[0]
    void (async () => {
      await navigator.serviceWorker.register('/__mew_preview_worker.js', { scope: '/' })
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
      frame = document.createElement('iframe'); frame.title = 'localhost:' + event.data.port
      frame.referrerPolicy = 'no-referrer'; frame.src = event.data.path
      document.body.replaceChildren(frame)
    })().catch(() => { document.body.textContent = '미리보기를 준비하지 못했습니다.'; close() })
  } else if (event.origin === location.origin && event.source === frame?.contentWindow && event.data?.type === 'mew-preview-socket' && event.ports[0] && bridge) bridge.postMessage(event.data.request, [event.ports[0]])
})
navigator.serviceWorker.addEventListener('message', event => {
  if (event.source !== navigator.serviceWorker.controller || event.data?.type !== 'mew-preview-network' || !event.ports[0] || !bridge) return
  const request = event.data.request
  bridge.postMessage(request, [event.ports[0], ...(request.body instanceof ArrayBuffer ? [request.body] : [])])
})
window.addEventListener('pagehide', close, { once: true })
parent.postMessage({ type: 'mew-preview-ready' }, owner)
