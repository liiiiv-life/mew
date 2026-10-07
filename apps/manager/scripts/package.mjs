import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { zipSync, strToU8 } from 'fflate'
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(app, '../..')
const { version } = JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8'))
const name = `mew-manager-${version}-windows-x64`, out = path.join(app, 'artifacts', name)
const exe = await fs.readFile(path.join(app, 'src-tauri/target/x86_64-pc-windows-msvc/release/mew-manager.exe'))
if (exe.toString('ascii',0,2) !== 'MZ') throw new Error('Expected a Windows PE executable.')
const texts = [['mew', path.join(root, 'LICENSE')], ['IBM Plex', path.join(root, 'public/fonts/ibm-plex/LICENSE.txt')], ['Tauri API (MIT)',path.join(app,'node_modules/@tauri-apps/api/LICENSE-MIT')], ['Tauri API (Apache 2.0)',path.join(app,'node_modules/@tauri-apps/api/LICENSE-APACHE-2.0')], ...['react', 'react-dom', 'iconoir-react'].map(pkg => [pkg,path.join(app,'node_modules',pkg,'LICENSE')])]
let notices = 'mew Manager — third-party license notices\n\n'
for (const [label,file] of texts) notices += `===== ${label} =====\n${await fs.readFile(file,'utf8')}\n\n`
const cargo = execFileSync('cargo',['tree','--locked','--manifest-path',path.join(app,'src-tauri/Cargo.toml'),'--target','x86_64-pc-windows-msvc','--edges','normal','--prefix','none'],{encoding:'utf8'})
const packages = [...new Set(cargo.match(/^[\w-]+ v[\d][^\s]+/gm))].filter(pkg=>!pkg.startsWith('mew-manager '))
const registry = path.join(process.env.CARGO_HOME || path.join(os.homedir(),'.cargo'),'registry/src')
const registries = await fs.readdir(registry)
for (const entry of packages.sort()) {
 const [pkg,ver] = entry.split(' v'), folder = `${pkg}-${ver}`
 let files, dir
 for (const bucket of registries) { dir=path.join(registry,bucket,folder); try { files=await fs.readdir(dir); break } catch {} }
 if (!files) throw new Error(`Missing cargo source for notices: ${entry}`)
 const manifest=await fs.readFile(path.join(dir,'Cargo.toml'),'utf8')
 notices += `===== ${entry} =====\nhttps://crates.io/crates/${pkg}/${ver}\n`
 notices += (manifest.match(/^license\s*=\s*.+$/m)?.[0] || 'License: see crate source') + '\n'
 const licenseFiles=files.filter(file=>/^(licen[cs]e|copying|notice|copyright)([_.-]|$)/i.test(file))
 for (const file of licenseFiles) { if ((await fs.stat(path.join(dir,file))).isFile()) notices += `${file}\n${await fs.readFile(path.join(dir,file),'utf8')}\n` }
 notices += '\n'
}
const instructions = 'mew Manager '+version+' — Windows x64 development build\n\nExtract the folder and run the exe as a normal Windows user.\nWebView2 Runtime is required. Install it from Microsoft if missing.\nSet the first owner email in Settings, then choose Install.\nWhen requested, reboot Windows and reopen the exe to continue.\nWSL/Ubuntu/mew are installed separately; closing Manager keeps the server running.\nUnsigned build. Full fresh-WSL installation validation is still pending.\nDocumentation: https://github.com/liiiiv-life/mew/blob/main/docs/guides/windows-manager.md\n'
const files = { [`${name}.exe`]:exe, 'THIRD-PARTY-NOTICES.txt':strToU8(notices), 'START-HERE.txt':strToU8(instructions) }
files['SHA256SUMS.txt']=strToU8(Object.entries(files).map(([file,data])=>`${createHash('sha256').update(data).digest('hex')}  ${file}`).join('\n')+'\n')
await fs.mkdir(out,{recursive:true})
for(const [file,data] of Object.entries(files)) await fs.writeFile(path.join(out,file),data)
const archive = Object.fromEntries(Object.entries(files).map(([file,data])=>[`${name}/${file}`,data]))
await fs.writeFile(path.join(app,'artifacts',name+'.zip'),zipSync(archive,{level:9}))
console.log(`Packaged ${name}.zip (${(exe.length/1048576).toFixed(1)} MiB exe), ${packages.length} Rust dependency notices.`)
