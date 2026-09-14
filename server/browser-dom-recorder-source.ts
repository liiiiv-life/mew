/** Extend the pinned rrweb recorder's private accessor, not the website's DOM API. */
export function domRecorderSource(bundle: string, recorder: string): string {
  const accessor = 'return getUntaintedAccessor("Element", n, "shadowRoot");'
  // An upstream bundle change must be reviewed instead of silently dropping roots.
  if (bundle.split(accessor).length !== 2) throw new Error('Unsupported rrweb shadow-root accessor')
  const patched = bundle.replace(accessor, 'return getUntaintedAccessor("Element", n, "shadowRoot") || mewClosedShadowRoots.get(n) || null;')
  return `if (["http:", "https:", "about:"].includes(location.protocol) && globalThis.__mewDomRecordedDocument !== globalThis.document) {
    (() => {
      const mewClosedShadowRoots = new WeakMap();
      const attachShadow = Element.prototype.attachShadow;
      // Install before page scripts, even though recording starts after DOMContentLoaded.
      // Keep mode:"closed" and the public shadowRoot getter unchanged.
      Element.prototype.attachShadow = function(options) {
        const root = Reflect.apply(attachShadow, this, [options]);
        if (root.mode === 'closed') mewClosedShadowRoots.set(this, root);
        return root;
      };
      ${patched}
      ;
      ${recorder}
    })();
  }`
}
