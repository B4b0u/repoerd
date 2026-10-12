import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { SecretBox } from './application/ports/secret-box.js'
import { type Maintenance, makeMaintenance } from './application/use-cases/maintenance.js'
import { readStoredLogin } from './domain/user-login.js'
import { openDatabase } from './infrastructure/persistence/database.js'
import { SqliteInstanceConfigRepository } from './infrastructure/persistence/sqlite-instance-config-repository.js'
import { SqliteSessionRepository } from './infrastructure/persistence/sqlite-session-repository.js'
import { SqliteUserRepository } from './infrastructure/persistence/sqlite-user-repository.js'

export const EXIT_OK = 0
export const EXIT_FAILURE = 1
export const EXIT_USAGE = 2
/** The database of the Docker image. */
export const DEFAULT_DATABASE_PATH = '/data/repoerd.sqlite'
export const RESTART_NOTE = 'Restart the container to apply (outside Docker: restart the server).'

export const USAGE = [
  'Usage: repoerd-admin <command>',
  '',
  'Commands:',
  '  list-admins            List the administrators',
  '  promote <login>        Make a user who signed in once an administrator (immediate)',
  '  set-public-url <url>   Change the public URL (restart to apply)',
  '  set-allowed-orgs [org ...]',
  '                         Restrict sign-in to these organisations; none removes the restriction (restart to apply)',
  '  reset-app              Forget the GitHub App, the GitHub tokens of the users and every session (restart to apply)',
  '',
  'Reads DATABASE_PATH (default /data/repoerd.sqlite). No command needs SECRET_KEY.',
].join('\n')

export interface CliOutput {
  out(line: string): void
  err(line: string): void
}

/** Number of arguments of each command; 'any' for a list. */
const ARITY: Record<string, number | 'any'> = {
  'list-admins': 0,
  promote: 1,
  'set-public-url': 1,
  'set-allowed-orgs': 'any',
  'reset-app': 0,
}

/**
 * No command seals or opens a secret: a SECRET_KEY that changed, or that the server now refuses,
 * cannot block a recovery. Any use would be a bug, and fails loudly.
 */
const NO_SECRETS: SecretBox = {
  seal: () => {
    throw new Error('repoerd-admin never writes a secret')
  },
  open: () => {
    throw new Error('repoerd-admin never reads a secret')
  },
}

/** repoerd-admin (spec §4.3): one command against the server's database, next to the server. */
export async function runAdminCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: CliOutput,
): Promise<number> {
  const [command, ...args] = argv
  if (argv.some((arg) => arg === '--help' || arg === '-h') || command === 'help') {
    io.out(USAGE)
    return EXIT_OK
  }
  if (command === undefined || !Object.hasOwn(ARITY, command)) {
    io.err(command === undefined ? 'Missing command.' : `Unknown command "${command}".`)
    io.err(USAGE)
    return EXIT_USAGE
  }
  const arity = ARITY[command]
  if (arity !== 'any' && args.length !== arity) {
    io.err(`"${command}" takes ${arity === 0 ? 'no argument' : 'one argument'}.`)
    io.err(USAGE)
    return EXIT_USAGE
  }
  const databasePath = env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH
  // Never create a database: a wrong path would silently "fix" an empty one.
  if (!existsSync(databasePath)) {
    io.err(
      `No database at ${databasePath}. Set DATABASE_PATH to the file the server uses (it creates it at its first start).`,
    )
    return EXIT_FAILURE
  }
  const problem = checkIsRepoerdDatabase(databasePath)
  if (problem) {
    io.err(problem)
    return EXIT_FAILURE
  }
  // WAL mode and better-sqlite3's 5 s busy timeout: safe next to the running server.
  const { db, close } = openDatabase(databasePath)
  try {
    const maintenance = makeMaintenance({
      config: new SqliteInstanceConfigRepository(db, NO_SECRETS),
      users: new SqliteUserRepository(db, NO_SECRETS),
      sessions: new SqliteSessionRepository(db),
    })
    return await run(maintenance, command, args, io)
  } finally {
    close()
  }
}

/** Read-only look before anything is migrated: an unrelated file must stay untouched. */
function checkIsRepoerdDatabase(databasePath: string): string | null {
  let sqlite: Database.Database | undefined
  try {
    sqlite = new Database(databasePath, { readonly: true, fileMustExist: true })
    const table = sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'instance_config'")
      .get()
    return table ? null : `${databasePath} is not a RepoERD database`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Not an SQLite file at all, or an unreadable one.
    if (/not a database/i.test(message)) return `${databasePath} is not a RepoERD database`
    return `Cannot open the database at ${databasePath}: ${message}`
  } finally {
    sqlite?.close()
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

async function run(
  maintenance: Maintenance,
  command: string,
  args: readonly string[],
  io: CliOutput,
): Promise<number> {
  switch (command) {
    case 'list-admins': {
      const admins = await maintenance.listAdmins()
      if (admins.length === 0) {
        io.out('No administrator yet: the first person to sign in after the setup becomes one.')
      }
      for (const admin of admins) {
        const { login, stale } = readStoredLogin(admin.login)
        io.out(
          stale
            ? `${login} (former login: the account was renamed on GitHub; id ${admin.id})`
            : `${login} (id ${admin.id})`,
        )
      }
      return EXIT_OK
    }
    case 'promote': {
      const result = await maintenance.promote(args[0] ?? '')
      if (!result.ok) {
        io.err(
          `Nobody signed in to RepoERD as "${result.error.kind === 'user-not-found' ? result.error.login : ''}" yet: they must sign in once first.`,
        )
        return EXIT_FAILURE
      }
      io.out(
        result.value.alreadyAdmin
          ? `${result.value.user.login} is already an administrator.`
          : `${result.value.user.login} is now an administrator (effective immediately).`,
      )
      return EXIT_OK
    }
    case 'set-public-url': {
      const result = await maintenance.setPublicUrl(args[0] ?? '')
      if (!result.ok) {
        io.err(
          `"${args[0] ?? ''}" is not a valid public URL: use an http(s) address without path, like https://erd.example.com.`,
        )
        return EXIT_FAILURE
      }
      io.out(`Public URL set to ${result.value.publicUrl}.`)
      io.out(
        `The GitHub App must declare the callback URL ${result.value.callbackUrl} (change it in the App settings on GitHub).`,
      )
      io.out(RESTART_NOTE)
      return EXIT_OK
    }
    case 'set-allowed-orgs': {
      const result = await maintenance.setAllowedOrgs(args)
      if (!result.ok) {
        const login = result.error.kind === 'invalid-organization' ? result.error.login : ''
        io.err(`"${login}" is not a valid GitHub organisation name: nothing was changed.`)
        return EXIT_FAILURE
      }
      io.out(
        result.value.length === 0
          ? 'The sign-in restriction is removed: anyone with access to an installation of the GitHub App can sign in.'
          : `Sign-in is now restricted to: ${result.value.join(', ')}.`,
      )
      // The server reads its in-memory copy of the configuration (sign-in, /admin, repositories).
      io.out(RESTART_NOTE)
      return EXIT_OK
    }
    case 'reset-app': {
      const { tokensCleared, sessionsDeleted } = await maintenance.resetApp()
      io.out(
        `GitHub App forgotten, with the GitHub tokens of ${plural(tokensCleared, 'user')} and ${plural(sessionsDeleted, 'session')}. Layouts, repository settings and administrators are kept.`,
      )
      io.out(
        `${RESTART_NOTE} The server then prints a new setup code in its logs: open /setup to register a GitHub App again.`,
      )
      return EXIT_OK
    }
    default:
      return EXIT_USAGE
  }
}
