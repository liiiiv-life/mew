import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteReceiveWindow } from './remote-receive-window.ts'
const flush = () => new Promise(resolve => setTimeout(resolve, 5))
test('receiver expands after consumption, batches credits and caps slow CPU and queued bodies', async () => {
  const grants: number[] = [], receiver = new RemoteReceiveWindow(256, 100, () => 0, count => grants.push(count))
  for (let i = 0; i < 8; i++) { receiver.take(); receiver.consumed(0.01, false) }
  await flush(); assert.deepEqual(grants, [], 'unread bodies retain only their initial eight chunks')
  receiver.activate(); await flush(); assert.deepEqual(grants, [160])
  receiver.close()
  const slow: number[] = [], cpu = new RemoteReceiveWindow(256, 100, () => 0, count => slow.push(count))
  for (let i = 0; i < 4; i++) { cpu.take(); cpu.consumed(2) }
  assert.deepEqual(slow, [], 'a credit batch yields before sending')
  await flush(); assert.deepEqual(slow, [4], 'CPU cost keeps eight chunks rather than opening 160')
  cpu.close()
  const queued = new RemoteReceiveWindow(256, 100, () => 160, () => assert.fail('unread queue cannot receive more credit'))
  for (let i = 0; i < 8; i++) queued.take()
  queued.activate(); await flush(); queued.close()
})
test('closing a receiver discards a pending grant and rejects unsolicited chunks', async () => {
  const receiver = new RemoteReceiveWindow(256, 1, () => 0, () => assert.fail('late grant'))
  for (let i = 0; i < 4; i++) { receiver.take(); receiver.consumed(0.01) }
  receiver.close(); await flush(); assert.throws(() => receiver.take(), /response-limit/)
})
