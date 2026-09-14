import net from 'node:net'

export function parentChannel(env = process.env) {
  if (process.platform !== 'win32' || !env.MEW_DESKTOP_PIPE) return { input: process.stdin, output: process.stdout }
  const name = env.MEW_DESKTOP_PIPE, token = env.MEW_DESKTOP_PIPE_TOKEN
  delete env.MEW_DESKTOP_PIPE; delete env.MEW_DESKTOP_PIPE_TOKEN
  if (!/^\\\\\.\\pipe\\mew-desktop-[a-f0-9]{48}$/.test(name) || !/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('잘못된 Windows 부모 통신 설정입니다.')
  const socket = net.createConnection(name)
  // Queue authentication before any early boot/error output, even while connecting.
  socket.write(`${token}\n`)
  return { input: socket, output: socket }
}
