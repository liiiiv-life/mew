// Chromium checks desktop capture separately from camera/microphone access.
const allowed = new Set(['media', 'display-capture', 'local-network-access', 'local-network', 'loopback-network'])

/** Permissions belong exclusively to the fixed, sandboxed local host renderer. */
export function configureHostPermissions(window, active = () => true) {
  const permits = (contents, permission, details) => active() && contents === window.webContents && allowed.has(permission) && details?.isMainFrame !== false
  const session = window.webContents.session
  session.setPermissionRequestHandler((contents, permission, callback, details) => callback(permits(contents, permission, details)))
  session.setPermissionCheckHandler((contents, permission, _origin, details) => permits(contents, permission, details))
}
