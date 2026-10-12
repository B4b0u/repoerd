export interface ShutdownDeps {
  server: { close(callback: (error?: Error) => void): unknown }
  closeParsers: () => void
  closeDatabase: () => void
  logger: { info(message: string): void; error(details: object, message: string): void }
  exit: (code: number) => void
  timeoutMs?: number
}

/**
 * Stops accepting connections, lets the requests in flight finish, then stops the parser children
 * and closes SQLite (`docker stop` sends SIGTERM, then kills after 10 s). Repeated calls are ignored; the 8 s timer forces
 * the exit whatever happens. At process level the signals are handled with `process.once`: after
 * the first one the default disposition applies again, so outside Docker a second SIGTERM/SIGINT
 * kills the process at once, while as PID 1 in Docker the kernel ignores it.
 */
export function makeShutdown(deps: ShutdownDeps): (signal: string) => void {
  let started = false
  return (signal) => {
    if (started) return
    started = true
    deps.logger.info(`${signal} received: shutting down`)
    // Under Docker's 10 s SIGKILL, so the forced exit is logged.
    const timer = setTimeout(() => {
      deps.logger.error({}, 'Requests still running after the shutdown delay: exiting anyway')
      deps.exit(1)
    }, deps.timeoutMs ?? 8_000)
    deps.server.close((error) => {
      clearTimeout(timer)
      if (error) deps.logger.error({ err: error }, 'The HTTP server closed with an error')
      deps.closeParsers()
      deps.closeDatabase()
      deps.exit(error ? 1 : 0)
    })
  }
}
