import type { DemoWorkspaceStore } from './workspace-store.ts'

type Token = { text: string; operator?: boolean }
type Result = { output: string; clear?: boolean; exit?: boolean }
type Prepared = { contents: Map<string, string>; diff?: string }
type Execution = { controller: AbortController }
const COMMANDS = ['help', 'pwd', 'cd', 'ls', 'cat', 'echo', 'printf', 'touch', 'mkdir', 'rm', 'rmdir', 'cp', 'mv', 'head', 'tail', 'wc', 'git', 'npm', 'pnpm', 'yarn', 'bun', 'node', 'whoami', 'uname', 'date', 'history', 'clear', 'exit']

function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  let word = '', quote = '', started = false
  const flush = () => { if (started) tokens.push({ text: word }); word = ''; started = false }
  for (let index = 0; index < line.length; index++) {
    const character = line[index]
    if (character === '\\' && quote !== "'") {
      const next = line[index + 1]
      if (next === undefined) throw new Error('명령 끝의 역슬래시를 확인해 주세요.')
      if (!quote || ['"', '\\', '$', '`'].includes(next)) { word += next; index++ }
      else word += character
      started = true
    } else if (quote) {
      if (character === quote) quote = ''
      else word += character
    } else if (character === '"' || character === "'") { quote = character; started = true }
    else if (/\s/.test(character)) flush()
    else if (['>', ';', '&', '|'].includes(character)) {
      flush()
      const double = line[index + 1] === character && character !== ';'
      const operator = double ? character + line[++index] : character
      if (operator === '&' || operator === '|') throw new Error('이 데모에서는 파이프와 백그라운드 실행을 지원하지 않습니다.')
      tokens.push({ text: operator, operator: true })
    } else { word += character; started = true }
  }
  if (quote) throw new Error('따옴표를 닫아 주세요.')
  flush()
  return tokens
}

/** A session-local shell backed exclusively by the visitor's virtual files. */
export class DemoTerminal {
  cwd: string
  private previousCwd: string
  private buffer: string[] = []
  private cursor = 0
  private history: string[] = []
  private historyIndex = 0
  private draft = ''
  private escape = ''
  private lastWasCR = false
  private scrollback = ''
  private execution?: Execution
  private queuedLines: string[] = []
  private closed = false
  private readonly unsubscribe: () => void
  private readonly store: DemoWorkspaceStore
  private readonly write: (output: string) => void
  private readonly exit: () => void

  constructor(store: DemoWorkspaceStore, write: (output: string) => void, exit: () => void, cwd = store.workspaceInfo().path) {
    this.store = store; this.write = write; this.exit = exit
    this.cwd = this.resolve(cwd); store.tree('.workspace', this.cwd); this.previousCwd = this.cwd
    this.unsubscribe = store.subscribe(event => { if (event.type === 'close') this.close(); else if (event.type === 'reset') this.cancelExecution() })
  }

  private emit(output: string): void {
    this.scrollback = (this.scrollback + output).slice(-100_000)
    this.write(output)
  }

  replay(): string { return this.scrollback }
  log(output: string): void { this.emit('\r\n' + output); this.prompt() }
  start(banner = ''): void { this.emit('Mew demo terminal\r\n\r\n' + banner); this.prompt() }
  private cancelExecution(): void {
    this.execution?.controller.abort(); this.execution = undefined; this.queuedLines = []
  }
  close(): void { if (this.closed) return; this.closed = true; this.cancelExecution(); this.unsubscribe() }
  reset(): void {
    this.cancelExecution()
    this.cwd = this.store.workspaceInfo().path; this.previousCwd = this.cwd
    this.buffer = []; this.cursor = 0; this.history = []; this.historyIndex = 0; this.draft = ''; this.escape = ''; this.lastWasCR = false; this.scrollback = ''
    this.emit('\x1b[2J\x1b[H'); this.start()
  }

  private promptText(): string {
    const relative = this.cwd.slice(this.store.workspacePath.length)
    return `\x1b[36mvisitor\x1b[0m:\x1b[34m~${relative}\x1b[0m $ `
  }
  private prompt(): void { this.emit(this.promptText()) }
  private redraw(): void {
    this.emit(`\r\x1b[2K${this.promptText()}${this.buffer.join('')}${this.cursor < this.buffer.length ? `\x1b[${this.buffer.length - this.cursor}D` : ''}`)
  }

  private resolve(path = '.'): string {
    const absolute = path === '~' ? this.store.workspacePath : path.startsWith('~/') ? `${this.store.workspacePath}/${path.slice(2)}` : path.startsWith('/') ? path : `${this.cwd}/${path}`
    const parts: string[] = []
    for (const part of absolute.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    const result = '/' + parts.join('/')
    if (result !== this.store.workspacePath && !result.startsWith(`${this.store.workspacePath}/`)) throw new Error('데모 작업 공간 밖의 경로에는 접근할 수 없습니다.')
    return result
  }

  private isDirectory(path: string): boolean {
    try { this.store.tree('.workspace', path); return true } catch { return false }
  }
  private requireArgs(args: string[], command: string): void { if (!args.length) throw new Error(`${command}: 경로를 입력하세요.`) }
  private read(path: string, prepared?: Prepared): string { return prepared?.contents.get(this.resolve(path)) ?? this.store.readFile(this.resolve(path)).content }
  private expand(text: string): string { return text.replace(/\\([nrt\\])/g, (_, character: string) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\' })[character] ?? character) }

  private prepare(words: string[], target: string | undefined, append: boolean, signal: AbortSignal): Prepared | Promise<Prepared> {
    const [command, ...args] = words, prepared: Prepared = { contents: new Map() }
    const countIndex = args.indexOf('-n')
    const paths = command === 'cat' ? args : ['head', 'tail', 'wc'].includes(command)
      ? args.filter((argument, index) => !argument.startsWith('-') && (countIndex < 0 || index !== countIndex + 1)) : []
    const reads = [...new Set(paths.map(path => this.resolve(path)))]
    if (append && target && this.store.hasFile(target) && !reads.includes(target)) reads.push(target)
    const capture = (index: number): Prepared | Promise<Prepared> => {
      for (; index < reads.length; index++) {
        signal.throwIfAborted()
        const path = reads[index]
        this.store.fileInfo(path)
        if (!this.store.isFileLoaded(path)) return this.store.loadFile(path, '.workspace', signal).then(() => {
          signal.throwIfAborted(); prepared.contents.set(path, this.store.readFile(path).content)
          return capture(index + 1)
        })
        prepared.contents.set(path, this.store.readFile(path).content)
      }
      if (command !== 'git' || args[0] !== 'diff') return prepared
      const selected = args.slice(1).filter(option => !option.startsWith('-'))
      const files = selected.length ? selected.map(path => this.resolve(path)) : this.store.gitWorkingTree().files.map(file => file.path)
      const diffs: string[] = []
      const captureDiff = (index: number): Prepared | Promise<Prepared> => {
        for (; index < files.length; index++) {
          signal.throwIfAborted()
          try { diffs.push(this.store.gitDiff(files[index]).diff) }
          catch (error) {
            if (!error || typeof error !== 'object' || !('status' in error) || error.status !== 503) throw error
            return this.store.loadDiff(files[index], undefined, signal).then(() => {
              signal.throwIfAborted(); diffs.push(this.store.gitDiff(files[index]).diff)
              return captureDiff(index + 1)
            })
          }
        }
        prepared.diff = diffs.join('\n'); return prepared
      }
      return captureDiff(0)
    }
    return capture(0)
  }

  private command(words: string[], prepared?: Prepared): Result {
    const [command, ...args] = words
    const paths = args.filter(argument => !argument.startsWith('-'))
    const line = (output: string): Result => ({ output: output + '\n' })
    if (command === 'help') return line(`Demo shell: ${COMMANDS.join(', ')}\n파일 변경은 탐색기·편집기·Git과 공유됩니다. >, >>, &&, ||, ;도 사용할 수 있습니다.`)
    if (command === 'clear') return { output: '', clear: true }
    if (command === 'exit' || command === 'logout') return { output: 'logout\n', exit: true }
    if (command === 'pwd') return line(this.cwd)
    if (command === 'cd') {
      const target = args[0] === '-' ? this.previousCwd : this.resolve(args[0] ?? '~')
      this.store.tree('.workspace', target)
      this.previousCwd = this.cwd; this.cwd = target
      return { output: args[0] === '-' ? target + '\n' : '' }
    }
    if (command === 'ls') {
      const showHidden = args.some(argument => /^-[a-z]*a[a-z]*$/i.test(argument))
      const long = args.some(argument => /^-[a-z]*l[a-z]*$/i.test(argument))
      return line((paths.length ? paths : ['.']).map(path => {
        const absolute = this.resolve(path)
        if (!this.isDirectory(absolute)) { this.store.fileInfo(absolute); return path }
        const entries = this.store.tree('.workspace', absolute).filter(node => showHidden || !node.name.startsWith('.'))
        const output = entries.map(node => long ? `${node.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--'} visitor  ${node.name}${node.type === 'dir' ? '/' : ''}` : `${node.name}${node.type === 'dir' ? '/' : ''}`).join(long ? '\n' : '  ')
        return paths.length > 1 ? `${path}:\n${output}` : output
      }).join('\n\n'))
    }
    if (command === 'cat') { this.requireArgs(args, command); return { output: args.map(path => this.read(path, prepared)).join('') } }
    if (command === 'echo') return { output: (args[0] === '-n' ? args.slice(1) : args).join(' ') + (args[0] === '-n' ? '' : '\n') }
    if (command === 'printf') {
      let index = 1
      return { output: this.expand(args[0] ?? '').replace(/%([sd%])/g, (_, type: string) => type === '%' ? '%' : args[index++] ?? '') }
    }
    if (command === 'touch') {
      this.requireArgs(paths, command)
      for (const path of paths) {
        const absolute = this.resolve(path)
        if (this.isDirectory(absolute)) continue
        if (!this.store.hasFile(absolute)) this.store.writeFile(absolute, '')
      }
      return { output: '' }
    }
    if (command === 'mkdir') {
      this.requireArgs(paths, command)
      for (const path of paths) {
        const absolute = this.resolve(path)
        if (args.includes('-p') && this.isDirectory(absolute)) continue
        this.store.createDirectory(absolute)
      }
      return { output: '' }
    }
    if (command === 'rm' || command === 'rmdir') {
      this.requireArgs(paths, command)
      for (const path of paths) {
        const absolute = this.resolve(path)
        if (absolute === this.store.workspacePath) throw new Error('데모 작업 공간 자체는 삭제할 수 없습니다.')
        if (this.isDirectory(absolute)) {
          if (command === 'rmdir' && this.store.tree('.workspace', absolute).length) throw new Error(`${path}: 폴더가 비어 있지 않습니다.`)
          if (command === 'rm' && !args.some(argument => /^-[a-z]*[rR]/.test(argument))) throw new Error(`${path}: 폴더를 지우려면 -r 옵션을 사용하세요.`)
        }
        if (command === 'rmdir' && !this.isDirectory(absolute)) throw new Error(`${path}: 폴더가 아닙니다.`)
        try { this.store.deletePath(absolute) }
        catch (error) { if (!args.some(argument => /^-[a-z]*f/.test(argument))) throw error }
      }
      return { output: '' }
    }
    if (command === 'cp' || command === 'mv') {
      if (paths.length !== 2) throw new Error(`${command}: 원본과 대상 경로를 입력하세요.`)
      const source = this.resolve(paths[0]), destination = this.resolve(paths[1])
      const target = this.isDirectory(destination) ? `${destination}/${source.split('/').at(-1)}` : destination
      this.store.movePath(source, target, '.workspace', command === 'cp')
      return { output: '' }
    }
    if (command === 'head' || command === 'tail' || command === 'wc') {
      const countIndex = args.indexOf('-n')
      const count = countIndex >= 0 ? Number(args[countIndex + 1]) : 10
      const files = args.filter((argument, index) => !argument.startsWith('-') && (countIndex < 0 || index !== countIndex + 1))
      this.requireArgs(files, command)
      if (!Number.isInteger(count) || count < 0) throw new Error('줄 수를 확인해 주세요.')
      return { output: files.map(path => {
        const content = this.read(path, prepared)
        if (command === 'wc') {
          const lines = (content.match(/\n/g) ?? []).length, words = content.trim() ? content.trim().split(/\s+/).length : 0
          return `${args.includes('-l') ? lines : `${lines} ${words} ${new TextEncoder().encode(content).length}`} ${path}\n`
        }
        const lines = content.replace(/\n$/, '').split('\n')
        return (command === 'head' ? lines.slice(0, count) : count ? lines.slice(-count) : []).join('\n') + (count && content ? '\n' : '')
      }).join('') }
    }
    if (command === 'history') return line(this.history.map((entry, index) => ` ${index + 1}  ${entry}`).join('\n'))
    if (command === 'whoami') return line('visitor')
    if (command === 'uname') return line(args.includes('-a') ? 'Demo browser virtual shell' : 'Demo')
    if (command === 'date') return line(new Date().toString())
    if (command === 'node' && ['--version', '-v'].includes(args[0])) return line('v24.0.0 (demo)')
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(command)) {
      if (['--version', '-v'].includes(args[0])) return line(command === 'bun' ? '1.3.0 (demo)' : '11.0.0 (demo)')
      const script = args[0] === 'run' ? args[1] : args[0]
      if (['install', 'i', 'ci', 'add'].includes(script)) return line('Dependencies are ready (demo).\n0 vulnerabilities')
      if (['test', 'lint', 'check', 'typecheck'].includes(script)) return line('Mew demo: checks are simulated; no real tests or commands are executed.')
      if (['dev', 'start', 'preview'].includes(script)) return line('Mew preview is ready (demo).\nLocal: https://demo.invalid/mew/\nPress Ctrl+C to return to the shell.')
      if (script === 'build') return line('✓ 12 modules transformed.\ndist/index.html  0.42 kB\n✓ built in 128ms (demo)')
      return line('Available scripts: dev, test, build, lint (demo)')
    }
    if (command === 'git') return this.git(args, prepared)
    throw new Error(`${command}: command not found. Type help for supported commands.`)
  }

  private git(args: string[], prepared?: Prepared): Result {
    const output = (text: string): Result => ({ output: text + '\n' })
    const [command, ...options] = args
    if (command === 'status') {
      const changes = this.store.gitWorkingTree().files, branch = this.store.gitRepository().branch
      return output(options.includes('--short') || options.includes('-s') ? changes.map(file => ` ${file.status === '?' ? '??' : file.status} ${file.path}`).join('\n') : `On branch ${branch}\n${changes.length ? changes.map(file => ` ${file.status} ${file.path}`).join('\n') : 'nothing to commit, working tree clean'}`)
    }
    if (command === 'diff') {
      if (prepared?.diff !== undefined) return { output: prepared.diff }
      const files = options.filter(option => !option.startsWith('-'))
      return { output: (files.length ? files.map(path => this.store.gitDiff(this.resolve(path)).diff) : this.store.gitWorkingTree().files.map(file => this.store.gitDiff(file.path).diff)).join('\n') }
    }
    if (command === 'log') return output(this.store.gitLog().commits.map(commit => `${commit.hash.slice(0, 7)} ${commit.subject}`).join('\n'))
    if (command === 'add') return { output: '' }
    if (command === 'commit') {
      const index = options.indexOf('-m'), message = index >= 0 ? options[index + 1] : ''
      if (!message) throw new Error('git commit: -m 뒤에 커밋 메시지를 입력하세요.')
      const result = this.store.commit(message)
      return output(`[${result.info.branch} ${result.hash.slice(0, 7)}] ${message}`)
    }
    if (command === 'branch') {
      if (options[0]) { const current = this.store.gitRepository().branch!; this.store.setBranch(options[0], true); this.store.setBranch(current); return { output: '' } }
      return output(this.store.gitBranches().branches.map(branch => `${branch.name === this.store.gitRepository().branch ? '*' : ' '} ${branch.name}`).join('\n'))
    }
    if (command === 'switch' || command === 'checkout') {
      const create = options.includes('-c') || options.includes('-b'), name = options.find(option => !option.startsWith('-'))
      if (!name) throw new Error('브랜치 이름을 입력하세요.')
      this.store.setBranch(name, create)
      return output(`Switched to ${create ? 'a new ' : ''}branch '${name}'`)
    }
    if (command === 'restore') { this.requireArgs(options, 'git restore'); this.store.discard(options.filter(option => option !== '--').map(path => this.resolve(path))); return { output: '' } }
    if (command === '--version') return output('git version 2.49.0 (demo)')
    return output('Demo git: status, diff, log, add, commit -m, branch, switch, checkout, restore')
  }

  private execute(line: string): void {
    if (this.closed) return
    if (this.execution) { this.queuedLines.push(line); return }
    void this.run(line)
  }

  private async run(line: string): Promise<void> {
    if (!line.trim()) { this.prompt(); return }
    const execution = { controller: new AbortController() }
    this.execution = execution
    if (this.history.at(-1) !== line) this.history.push(line)
    this.history = this.history.slice(-200); this.historyIndex = this.history.length; this.draft = ''
    try {
      const tokens = tokenize(line)
      let start = 0, previous = ';', success = true
      for (let index = 0; index <= tokens.length; index++) {
        const token = tokens[index]
        if (token && (!token.operator || ![';', '&&', '||'].includes(token.text))) continue
        const group = tokens.slice(start, index)
        if (!group.length) { if (index !== tokens.length) throw new Error('명령을 확인해 주세요.'); break }
        if (previous !== '&&' || success) if (previous !== '||' || !success) {
          try {
            const redirect = group.findIndex(item => item.operator)
            let target: string | undefined, append = false
            if (redirect >= 0) {
              if (!['>', '>>'].includes(group[redirect].text) || redirect !== group.length - 2 || group[redirect + 1].operator) throw new Error('출력할 파일 경로를 확인해 주세요.')
              target = this.resolve(group[redirect + 1].text); append = group[redirect].text === '>>'
            }
            const words = (redirect >= 0 ? group.slice(0, redirect) : group).map(item => item.text)
            const pending = this.prepare(words, target, append, execution.controller.signal)
            const prepared = pending instanceof Promise ? await pending : pending
            if (this.execution !== execution || this.closed) return
            const result = this.command(words, prepared)
            if (target) {
              let content = ''
              if (append && this.store.hasFile(target)) content = this.read(target, prepared)
              this.store.writeFile(target, content + result.output)
            } else this.emit(result.output.replace(/\r?\n/g, '\r\n'))
            if (result.clear) { this.scrollback = ''; this.emit('\x1b[2J\x1b[H') }
            if (result.exit) { this.close(); this.exit(); return }
            success = true
          } catch (error) {
            if (this.execution !== execution || this.closed) return
            success = false; this.emit(`Demo shell: ${error instanceof Error ? error.message : 'Command failed.'}\r\n`)
          }
        }
        previous = token?.text ?? ';'; start = index + 1
      }
    } catch (error) { if (this.execution === execution && !this.closed) this.emit(`Demo shell: ${error instanceof Error ? error.message : 'Command failed.'}\r\n`) }
    finally {
      if (this.execution === execution && !this.closed) {
        this.execution = undefined; this.prompt()
        const next = this.queuedLines.shift()
        if (next !== undefined) this.execute(next)
      }
    }
  }

  private navigateHistory(direction: number): void {
    if (this.historyIndex === this.history.length) this.draft = this.buffer.join('')
    this.historyIndex = Math.min(this.history.length, Math.max(0, this.historyIndex + direction))
    this.buffer = Array.from(this.history[this.historyIndex] ?? this.draft); this.cursor = this.buffer.length; this.redraw()
  }

  private complete(): void {
    if (this.cursor !== this.buffer.length) return
    const input = this.buffer.join(''), fragment = input.split(/\s+/).at(-1) ?? ''
    try {
      let candidates: string[]
      if (!/\s/.test(input)) candidates = COMMANDS.filter(command => command.startsWith(fragment)).map(command => command + ' ')
      else {
        const slash = fragment.lastIndexOf('/'), prefix = fragment.slice(0, slash + 1), part = fragment.slice(slash + 1)
        candidates = this.store.tree('.workspace', this.resolve(prefix || '.')).filter(node => node.name.startsWith(part)).map(node => prefix + node.name + (node.type === 'dir' ? '/' : ' '))
      }
      if (!candidates.length) return
      let common = candidates[0]
      for (const candidate of candidates) while (!candidate.startsWith(common)) common = common.slice(0, -1)
      if (common.length > fragment.length) { this.buffer.push(...Array.from(common.slice(fragment.length))); this.cursor = this.buffer.length; this.redraw() }
      else if (candidates.length > 1) { this.emit('\r\n' + candidates.join('  ') + '\r\n'); this.redraw() }
    } catch { /* Completion must not replace a valid command draft with an error. */ }
  }

  input(data: string): void {
    if (this.closed) return
    for (const character of data) {
      if (this.escape || character === '\x1b') {
        this.escape += character
        if (this.escape === '\x1b' || this.escape.startsWith('\x1b[') && /^[\d;]*$/.test(this.escape.slice(2))) continue
        const sequence = this.escape; this.escape = ''
        if (sequence === '\x1b[A') this.navigateHistory(-1)
        else if (sequence === '\x1b[B') this.navigateHistory(1)
        else if (sequence === '\x1b[D') { this.cursor = Math.max(0, this.cursor - 1); this.redraw() }
        else if (sequence === '\x1b[C') { this.cursor = Math.min(this.buffer.length, this.cursor + 1); this.redraw() }
        else if (['\x1b[H', '\x1b[1~'].includes(sequence)) { this.cursor = 0; this.redraw() }
        else if (['\x1b[F', '\x1b[4~'].includes(sequence)) { this.cursor = this.buffer.length; this.redraw() }
        else if (sequence === '\x1b[3~') { this.buffer.splice(this.cursor, 1); this.redraw() }
        continue
      }
      if (character === '\n' && this.lastWasCR) { this.lastWasCR = false; continue }
      this.lastWasCR = character === '\r'
      if (character === '\r' || character === '\n') {
        const line = this.buffer.join(''); this.buffer = []; this.cursor = 0
        this.emit('\r\n'); this.execute(line)
      } else if (character === '\x03') {
        this.cancelExecution()
        this.buffer = []; this.cursor = 0; this.historyIndex = this.history.length
        this.emit('^C\r\n'); this.prompt()
      } else if (character === '\x04') { if (!this.buffer.length) { this.close(); this.emit('logout\r\n'); this.exit(); return } }
      else if (character === '\x0c') { this.scrollback = ''; this.emit('\x1b[2J\x1b[H'); this.redraw() }
      else if (character === '\x01') { this.cursor = 0; this.redraw() }
      else if (character === '\x05') { this.cursor = this.buffer.length; this.redraw() }
      else if (character === '\x15') { this.buffer.splice(0, this.cursor); this.cursor = 0; this.redraw() }
      else if (character === '\x0b') { this.buffer.splice(this.cursor); this.redraw() }
      else if (character === '\t') this.complete()
      else if (character === '\x7f' || character === '\b') { if (this.cursor) { this.buffer.splice(--this.cursor, 1); this.redraw() } }
      else if (character >= ' ' && this.buffer.length < 100_000) {
        const atEnd = this.cursor === this.buffer.length
        this.buffer.splice(this.cursor++, 0, character)
        if (atEnd) this.emit(character); else this.redraw()
      }
    }
  }
}
