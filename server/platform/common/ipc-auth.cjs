const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto')

const keyFile = directory => path.join(directory, '.ipc-key')
function secret(directory, create = false) {
  const file = keyFile(directory)
  if (create) {
    try { fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Invalid private IPC key')
  const value = fs.readFileSync(file, 'utf8')
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid private IPC key')
  return value
}
const proof = (key, role, endpoint, nonce) => createHmac('sha256', key).update(JSON.stringify([role, endpoint, nonce])).digest('hex')
function equal(actual, expected) {
  return typeof actual === 'string' && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}
function readFrame(socket) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0)
    const clean = () => { clearTimeout(timer); socket.off('data', data); socket.off('error', failed); socket.off('close', closed) }
    const failed = error => { clean(); reject(error) }
    const closed = () => failed(new Error('Private IPC closed during authentication'))
    const timer = setTimeout(() => failed(new Error('Private IPC authentication timeout')), 5000)
    const data = chunk => {
      pending = Buffer.concat([pending, Buffer.from(chunk)])
      const end = pending.indexOf(10)
      if (end > 4096 || end < 0 && pending.length > 4096) { failed(new Error('Private IPC authentication frame too large')); return }
      if (end < 0) return
      clean(); socket.pause()
      try {
        const frame = JSON.parse(pending.subarray(0, end).toString('utf8'))
        const tail = pending.subarray(end + 1)
        if (tail.length) socket.unshift(tail)
        resolve(frame)
      } catch (error) { reject(error) }
    }
    socket.on('data', data); socket.once('error', failed); socket.once('close', closed); socket.resume()
  })
}
async function accept(socket, endpoint, key, ready) {
  const nonce = randomBytes(32).toString('hex')
  try {
    const response = readFrame(socket)
    socket.write(JSON.stringify({ protocol: 'mew-private-ipc-1', nonce, proof: proof(key, 'server', endpoint, nonce) }) + '\n')
    const frame = await response
    if (frame.nonce !== nonce || !equal(frame.proof, proof(key, 'client', endpoint, nonce))) throw new Error('Private IPC authentication failed')
    ready(socket)
    socket.resume()
  } catch { socket.destroy() }
}
async function connect(endpoint, directory) {
  const key = secret(directory)
  const socket = net.createConnection(endpoint)
  try {
    const frame = await readFrame(socket)
    if (frame.protocol !== 'mew-private-ipc-1' || typeof frame.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(frame.nonce) || !equal(frame.proof, proof(key, 'server', endpoint, frame.nonce))) throw new Error('Private IPC server authentication failed')
    socket.write(JSON.stringify({ nonce: frame.nonce, proof: proof(key, 'client', endpoint, frame.nonce) }) + '\n')
    return socket
  } catch (error) { socket.destroy(); throw error }
}
module.exports = { keyFile, secret, proof, equal, accept, connect }
