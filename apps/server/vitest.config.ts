import { defineConfig } from 'vitest/config'
import { workspaceAliases } from '../../workspace-aliases.ts'

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    testTimeout: 30_000,
    // schema-core may load Liam (WASI) in a test worker: no "experimental" notice for it.
    execArgv: ['--disable-warning=ExperimentalWarning'],
    coverage: { provider: 'v8', reporter: ['text-summary'], include: ['src/**'] },
  },
})
