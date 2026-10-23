import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const run = promisify(execFile)

test('driver monitor lease isolates file owners, expires without renewal and cleans up on file close', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-display-lease-'))
  try {
    await fs.copyFile(path.resolve(import.meta.dirname, '../native/remote-desktop/virtual-display-lease.h'), path.join(root, 'virtual-display-lease.h'))
    await fs.writeFile(path.join(root, 'lease.cpp'), `#include "virtual-display-lease.h"
#include <cassert>
int main(){
 DisplayLease lease;
 assert(!lease.acquire(0,0));assert(lease.acquire(11,0));
 assert(!lease.acquire(22,1));assert(!lease.renew(22,1));assert(!lease.release(22));
 assert(!lease.expired(9999));assert(lease.expired(10000));
 assert(!lease.renew(11,10000));assert(lease.release(11));
 assert(lease.acquire(22,10001));assert(lease.renew(22,19999));assert(!lease.expired(20001));
 assert(lease.release(22));assert(!lease.expired(30000));assert(!lease.release(22));
 assert(lease.acquire(33,30000));assert(!lease.acquire(33,30001));
 assert(lease.release(33));assert(lease.acquire(44,30002));
}
`)
    await run('c++', ['-std=c++17', '-O2', path.join(root, 'lease.cpp'), '-o', path.join(root, 'lease')])
    await run(path.join(root, 'lease'))
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('an unsigned driver package fails verification without staging or registering a device', {
  skip: !process.env.MEW_DESKTOP_TEST_WINDOWS_DRIVER_PACKAGE || !process.env.MEW_DESKTOP_TEST_POWERSHELL,
}, async () => {
  const script = path.resolve(import.meta.dirname, '../native/remote-desktop/install-virtual-display.ps1')
  const translated = (await run('wslpath', ['-w', script])).stdout.trim()
  await assert.rejects(run(process.env.MEW_DESKTOP_TEST_POWERSHELL!, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', translated, '-Package', process.env.MEW_DESKTOP_TEST_WINDOWS_DRIVER_PACKAGE!,
    '-SignerThumbprint', '0000000000000000000000000000000000000000', '-CheckOnly',
  ]), /valid trusted release signature/)
})
