import { registerHooks } from 'node:module'

/** Security fixtures never start a PTY, even if a regression reaches a shell path. */
export function disableTestPty() {
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'node-pty'
        ? { url: 'data:text/javascript,export function spawn(){throw new Error("PTY execution is forbidden in this security fixture")}', shortCircuit: true }
        : nextResolve(specifier, context)
    },
  })
}
