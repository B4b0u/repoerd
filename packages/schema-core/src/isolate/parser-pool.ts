import { type ChildProcess, fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { availableParallelism } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SchemaFormat } from '@repoerd/model'
import type { ConfigSchemaRead } from '../detect/config-schema-property.js'
import type { ImportAnalysis } from '../detect/relative-imports.js'
import type { PatchedLiamSchema } from '../parse/liam-patch.js'
import type { ChildMessage, ChildOp, ChildRequest, ChildResults } from './protocol.js'

/** Heap of a parser child (`--max-old-space-size`): a huge input kills the child, not the server. */
export const PARSER_HEAP_MB = 512
/** Default timeout of one call, parses included. */
export const DEFAULT_CALL_TIMEOUT_MS = 10_000
/** An idle child exits after this delay; the next call starts a new one. */
const DEFAULT_IDLE_MS = 60_000

/** The SWC analyses detection runs on repository files (in a parser child). */
export interface SourceAnalyzer {
  /**
   * The `schema` field of a config file; `{ ok: false }` when the property cannot be read, null
   * when the child died or timed out on it.
   */
  readConfigSchema(source: string): Promise<ConfigSchemaRead | null>
  /** The relative imports of a module; null when the child died or timed out on it. */
  analyzeImports(source: string): Promise<ImportAnalysis | null>
}

export type LiamParseOutcome =
  | { kind: 'parsed'; schema: PatchedLiamSchema; errors: string[] }
  /** Liam threw: its message. */
  | { kind: 'failed'; message: string }
  /** The child process died during the parse (native crash, out of memory). */
  | { kind: 'crashed' }
  | { kind: 'timeout' }

export interface ParserPool extends SourceAnalyzer {
  parse(input: string, format: SchemaFormat, timeoutMs?: number): Promise<LiamParseOutcome>
  /** Stops every child. A later call starts new ones. */
  close(): void
}

export interface ParserPoolOptions {
  /** Children at work at once; further calls wait their turn. Default: max(1, cores − 1). */
  size?: number
  /** Timeout of the detection calls. Default: 10 s. */
  callTimeoutMs?: number
  /** Default: 60 s. */
  idleMs?: number
  /** Tests only: another entry file for the children (a .ts entry runs through tsx). */
  entry?: URL
}

type CallOutcome<Op extends ChildOp> =
  | { kind: 'done'; value: ChildResults[Op] }
  | { kind: 'failed'; message: string }
  | { kind: 'crashed' }
  | { kind: 'timeout' }

type Reply = Extract<ChildMessage, { type: 'reply' }>
type Settled = { kind: 'reply'; reply: Reply } | { kind: 'crashed' }

// From the TypeScript sources (development, tests) the child runs through tsx; from dist, as is.
const FROM_SOURCES = import.meta.url.endsWith('.ts')
const DEFAULT_ENTRY = new URL(
  FROM_SOURCES ? './parser-child.ts' : './parser-child.js',
  import.meta.url,
)

function execArgvFor(entry: URL): string[] {
  const base = [`--max-old-space-size=${PARSER_HEAP_MB}`, '--disable-warning=ExperimentalWarning']
  if (!entry.pathname.endsWith('.ts')) return base
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
  return ['--import', tsx, ...base]
}

// The server's environment holds its secrets (SECRET_KEY, App credentials): a child only gets
// what a Node process needs to start.
const CHILD_ENV_KEYS = [
  'PATH',
  'Path',
  'NODE_ENV',
  'SystemRoot',
  'windir',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
]

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of CHILD_ENV_KEYS) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** One child process. It works on one request at a time. */
class ParserChild {
  alive = true
  private readonly process: ChildProcess
  private readonly ready: Promise<void>
  private settle: ((settled: Settled) => void) | null = null
  private inFlightId: number | null = null
  private idleTimer: NodeJS.Timeout | null = null

  constructor(entry: URL) {
    this.process = fork(fileURLToPath(entry), [], {
      execArgv: execArgvFor(entry),
      env: childEnv(),
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    let markReady = () => {}
    this.ready = new Promise<void>((resolve) => {
      markReady = resolve
    })
    this.process.on('message', (raw: unknown) => {
      // Whatever a child sends, this must never throw (an uncaught exception ends the server).
      if (!isObject(raw)) return
      if (raw.type === 'ready') markReady()
      else if (raw.type === 'reply') this.onReply(raw)
    })
    this.process.on('exit', () => {
      this.alive = false
      this.settle?.({ kind: 'crashed' })
    })
    // Spawn failures and IPC errors: the child is unusable either way.
    this.process.on('error', () => {
      this.kill()
      this.settle?.({ kind: 'crashed' })
    })
  }

  /** A reply for another request, or of the wrong shape: the child is misbehaving, drop it. */
  private onReply(raw: Record<string, unknown>): void {
    const valid =
      this.settle !== null &&
      raw.id === this.inFlightId &&
      (raw.ok === true || (raw.ok === false && typeof raw.message === 'string'))
    if (valid) {
      this.settle?.({ kind: 'reply', reply: raw as Reply })
    } else {
      this.kill()
      this.settle?.({ kind: 'crashed' })
    }
  }

  call<Op extends ChildOp>(request: ChildRequest, timeoutMs: number): Promise<CallOutcome<Op>> {
    this.busy()
    this.inFlightId = request.id
    return new Promise((resolve) => {
      // Counted from now, child start-up included: a child that never answers times out too.
      const timer = setTimeout(() => {
        this.settle = null
        this.inFlightId = null
        this.kill()
        resolve({ kind: 'timeout' })
      }, timeoutMs)
      this.settle = (settled) => {
        clearTimeout(timer)
        this.settle = null
        this.inFlightId = null
        if (settled.kind === 'crashed') resolve({ kind: 'crashed' })
        else if (settled.reply.ok)
          resolve({ kind: 'done', value: settled.reply.value as ChildResults[Op] })
        else resolve({ kind: 'failed', message: settled.reply.message })
      }
      if (!this.alive) {
        this.settle({ kind: 'crashed' })
        return
      }
      void this.ready.then(() => {
        if (!this.settle || !this.alive) return
        this.process.send(request, (error) => {
          if (error) this.settle?.({ kind: 'crashed' })
        })
      })
    })
  }

  /** Waits for the next call, exits after `idleMs`, and never keeps the server process alive. */
  idle(idleMs: number): void {
    this.idleTimer = setTimeout(() => this.kill(), idleMs)
    this.idleTimer.unref()
    this.process.unref()
    this.process.channel?.unref()
  }

  kill(): void {
    this.alive = false
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.process.exitCode === null && this.process.signalCode === null) this.process.kill()
  }

  private busy(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.process.ref()
    this.process.channel?.ref()
  }
}

/**
 * Parser children (`child_process.fork`): started on demand, reused, replaced when one dies.
 * A call running in a child that died answers `crashed`; the next call gets a new child.
 */
export function createParserPool(options: ParserPoolOptions = {}): ParserPool {
  const size = options.size ?? Math.max(1, availableParallelism() - 1)
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const entry = options.entry ?? DEFAULT_ENTRY
  const idle: ParserChild[] = []
  const all = new Set<ParserChild>()
  const waiting: Array<() => void> = []
  let active = 0
  let nextId = 0

  /** Gives the turn to the next waiting call, or frees the slot. */
  function giveBackSlot(): void {
    const next = waiting.shift()
    if (next) next()
    else active -= 1
  }

  async function acquire(): Promise<ParserChild> {
    if (active >= size) {
      // The releasing call hands its turn over: `active` stays unchanged.
      await new Promise<void>((resolve) => waiting.push(resolve))
    } else {
      active += 1
    }
    try {
      for (let child = idle.pop(); child; child = idle.pop()) {
        if (child.alive) return child
        all.delete(child)
      }
      const child = new ParserChild(entry)
      all.add(child)
      return child
    } catch (error) {
      // A child that cannot even start must not keep its slot.
      giveBackSlot()
      throw error
    }
  }

  function release(child: ParserChild): void {
    if (child.alive) {
      child.idle(idleMs)
      idle.push(child)
    } else {
      all.delete(child)
    }
    giveBackSlot()
  }

  async function call<Op extends ChildOp>(
    request: Extract<ChildRequest, { op: Op }>,
    timeoutMs: number,
  ): Promise<CallOutcome<Op>> {
    let child: ParserChild
    try {
      child = await acquire()
    } catch {
      return { kind: 'crashed' }
    }
    try {
      return await child.call<Op>(request, timeoutMs)
    } finally {
      release(child)
    }
  }

  return {
    async readConfigSchema(source) {
      const outcome = await call({ id: ++nextId, op: 'config-schema', source }, callTimeoutMs)
      return outcome.kind === 'done' ? outcome.value : null
    },
    async analyzeImports(source) {
      const outcome = await call({ id: ++nextId, op: 'imports', source }, callTimeoutMs)
      return outcome.kind === 'done' ? outcome.value : null
    },
    async parse(input, format, timeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
      const outcome = await call({ id: ++nextId, op: 'parse', input, format }, timeoutMs)
      return outcome.kind === 'done'
        ? { kind: 'parsed', schema: outcome.value.schema, errors: outcome.value.errors }
        : outcome
    },
    close() {
      for (const child of all) child.kill()
      all.clear()
      idle.length = 0
    },
  }
}

let shared: ParserPool | undefined

/** The pool used when none is given: created on first use, shared by the whole process. */
export function defaultParserPool(): ParserPool {
  shared ??= createParserPool()
  return shared
}
