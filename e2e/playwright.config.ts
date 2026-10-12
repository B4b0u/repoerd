import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { removeDataDir } from './global-teardown'
import { REAL_DATABASE_FILE, SETUP_CODE_FILE } from './real-mode/files'

// Never 3000 / 3100 / 5173: those belong to the developer's own tools and `pnpm dev`.
const PORT = 3400
/** Real mode (tests-real/), against the fake GitHub of real-mode/fake-github.ts on FAKE_GITHUB_PORT. */
const REAL_PORT = 3401
const FAKE_GITHUB_PORT = 3402
// Created once by the main process; workers inherit it through the environment.
const inherited = process.env.REPOERD_E2E_DATA
const dataDir = inherited ?? mkdtempSync(path.join(tmpdir(), 'repoerd-e2e-'))
process.env.REPOERD_E2E_DATA = dataDir
// Only a folder created here is ever deleted; a user-provided one is left alone.
if (!inherited) process.env.REPOERD_E2E_DATA_OWNED = '1'
// The server is stopped after the global teardown: clean up once more when the main process exits.
if (!inherited) process.on('exit', () => removeDataDir(dataDir))
const database = path.join(dataDir, 'e2e.sqlite')

export default defineConfig({
  // One server per mode, one database each: the tests run one after the other.
  globalTeardown: './global-teardown.ts',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testDir: './tests',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}` },
    },
    {
      name: 'real-mode',
      testDir: './tests-real',
      // 127.0.0.1 like the fake GitHub: one spelling of this machine for the whole stack.
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${REAL_PORT}` },
    },
  ],
  webServer: [
    {
      // The production build (pnpm e2e builds it first): the web is served by the API server.
      command: 'node ../apps/server/dist/main.js',
      url: `http://localhost:${PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'production',
        GITHUB_MODE: 'fake',
        PORT: String(PORT),
        DATABASE_PATH: database,
        SECRET_KEY: 'e2e-only-secret-key-never-used-in-production',
      },
    },
    {
      // Node runs the TypeScript file itself (type stripping).
      command: 'node --disable-warning=ExperimentalWarning real-mode/start-stack.ts',
      url: `http://127.0.0.1:${REAL_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        REAL_PORT: String(REAL_PORT),
        FAKE_GITHUB_PORT: String(FAKE_GITHUB_PORT),
        REAL_DATABASE_PATH: path.join(dataDir, REAL_DATABASE_FILE),
        SETUP_CODE_FILE: path.join(dataDir, SETUP_CODE_FILE),
      },
    },
  ],
})
