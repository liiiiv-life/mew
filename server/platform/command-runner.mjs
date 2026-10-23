import { spawnHostProcess } from './process.ts'
const spec = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'))
const env = { ...process.env, ...spec.env }
for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
const child = spawnHostProcess(spec.cmd, spec.args, { env, stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
