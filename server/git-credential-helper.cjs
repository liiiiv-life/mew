// Git credential protocol. Credentials are read only for one validated HTTPS repository.
const net = require('node:net')
if (process.argv[2] === 'get' && process.env.MEW_GIT_CREDENTIAL_SOCKET) {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', value => { input += value; if (input.length > 8192) process.exit(1) })
  process.stdin.on('end', () => {
    const fields = Object.fromEntries(input.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }))
    const socket = net.connect(process.env.MEW_GIT_CREDENTIAL_SOCKET)
    socket.setTimeout(5000, () => socket.destroy())
    socket.on('error', () => { process.exitCode = 1 })
    socket.on('connect', () => socket.write(JSON.stringify(fields) + '\n'))
    let data = ''
    socket.on('data', value => { data += value; if (data.length > 16384) socket.destroy() })
    socket.on('end', () => {
      try {
        const credentials = JSON.parse(data)
        if (credentials.username && credentials.password && !/[\r\n]/.test(credentials.password) && !credentials.password.includes('\0')) process.stdout.write(`username=${credentials.username}\npassword=${credentials.password}\n\n`)
      } catch { process.exitCode = 1 }
    })
  })
}
