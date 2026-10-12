import { runAdminCli } from './admin-cli.js'

// repoerd-admin: recovery commands, run next to the server
// (docker compose exec repoerd repoerd-admin <command>).
runAdminCli(process.argv.slice(2), process.env, {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  },
)
