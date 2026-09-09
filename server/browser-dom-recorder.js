// Runs only in the real server browser. No page source or credential is logged.
(() => {
  window.__mewDomRecordedDocument = document;
  const documentId = `${Date.now()}-${Math.random()}`;
  const start = () => {
    window.__mewDomStop?.();
    window.__mewDomStop = window.rrwebRecord.record({
      emit: (event) => {
        // Child frames are recorded separately by Mew, including same-origin frames.
        // Never send rrweb's embedded child-Document attachment to the parent viewer.
        if (event.type === 3 && event.data.source === 0 && event.data.isAttachIframe) return;
        window.__mewDomEmit(event, documentId).catch(() => {});
      },
      inlineStylesheet: true,
      collectFonts: true,
      recordCanvas: false,
      recordCrossOriginIframes: false,
      maskInputOptions: { password: true },
      sampling: { mousemove: false, mouseInteraction: false, scroll: 50 },
    });
  };
  window.__mewDomSnapshot = () => window.rrwebRecord.record.takeFullSnapshot();
  // Resolve IDs on the server; the client never supplies selectors or JavaScript.
  window.__mewDomNode = (id) => window.rrwebRecord.record.mirror.getNode(id);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
