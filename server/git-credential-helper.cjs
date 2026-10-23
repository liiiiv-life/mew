// Git credential protocol. Credentials are read only for one validated HTTPS repository.
const net = require('node:net')
const ipc = require('./platform/common/ipc-auth.cjs')
if (process.argv[2] === 'get' && process.env.MEW_GIT_CREDENTIAL_SOCKET) {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', value => { input += value; if (input.length > 8192) process.exit(1) })
  process.stdin.on('end', async () => {
    const fields = Object.fromEntries(input.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }))
    let socket
    try {
      if (process.platform === 'win32') socket = await ipc.connect(process.env.MEW_GIT_CREDENTIAL_SOCKET, process.env.MEW_GIT_CREDENTIAL_DIRECTORY)
      else socket = net.connect(process.env.MEW_GIT_CREDENTIAL_SOCKET)
    } catch { process.exitCode = 1; return }
    socket.setTimeout(5000, () => socket.destroy())
    socket.on('error', () => { process.exitCode = 1 })
    if (process.platform === 'win32') socket.write(JSON.stringify(fields) + '\n')
    else socket.on('connect', () => socket.write(JSON.stringify(fields) + '\n'))
    let data = ''
    socket.on('data', value => { data += value; if (data.length > 16384) socket.destroy() })
    socket.resume()
    socket.on('end', () => {
      try {
        const credentials = JSON.parse(data)
        if (credentials.username && credentials.password && !/[\r\n]/.test(credentials.password) && !credentials.password.includes('\0')) process.stdout.write(`username=${credentials.username}\npassword=${credentials.password}\n\n`)
      } catch { process.exitCode = 1 }
    })
  })
}
