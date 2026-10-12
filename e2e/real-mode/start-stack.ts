/**
 * Second web server of the E2E run: a fake of the GitHub endpoints that setup and sign-in use,
 * then the production server in real mode pointed at it (REPOERD_TEST_GITHUB_URL). The one-time
 * setup code the server logs is written to SETUP_CODE_FILE for the tests.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { startFakeGitHub } from './fake-github.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const port = required('REAL_PORT')
const githubPort = Number(required('FAKE_GITHUB_PORT'))
const databasePath = required('REAL_DATABASE_PATH')
const setupCodeFile = required('SETUP_CODE_FILE')

// A data folder given through REPOERD_E2E_DATA outlives the run: every run starts unconfigured.
for (const suffix of ['', '-wal', '-shm', '-journal'])
  rmSync(`${databasePath}${suffix}`, { force: true })
rmSync(setupCodeFile, { force: true })

const github = await startFakeGitHub(githubPort)
const closeGitHub = () => {
  if (github.listening) github.close()
}

const env: NodeJS.ProcessEnv = { ...process.env }
// The developer's shell may point elsewhere: this stack decides everything that matters.
for (const name of ['WEB_DIST_PATH', 'FIXTURES_PATH', 'REPOERD_VERSION']) delete env[name]
Object.assign(env, {
  NODE_ENV: 'production',
  GITHUB_MODE: 'real',
  PORT: port,
  DATABASE_PATH: databasePath,
  // A fresh random key: the example keys published in the repository are refused in real mode.
  SECRET_KEY: randomBytes(32).toString('base64'),
  REPOERD_TEST_GITHUB_URL: `http://127.0.0.1:${githubPort}`,
})

const serverEntry = fileURLToPath(new URL('../../apps/server/dist/main.js', import.meta.url))
const server = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'inherit'] })
const output = server.stdout
if (!output) throw new Error('The server has no output stream')
createInterface({ input: output }).on('line', (line) => {
  process.stdout.write(`${line}\n`)
  const code = /one-time setup code: ([A-Za-z0-9-]+)/.exec(line)?.[1]
  if (code) writeFileSync(setupCodeFile, code)
})

const stop = () => {
  server.kill('SIGTERM')
  closeGitHub()
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
server.on('exit', (code) => {
  closeGitHub()
  process.exit(code ?? 1)
})
