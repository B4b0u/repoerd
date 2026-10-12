import { serveStatic } from '@hono/node-server/serve-static'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from './types.js'

const IMMUTABLE = 'public, max-age=31536000, immutable'
const NO_CACHE = 'no-cache'
/** Answered by the server itself: an unknown path there stays a JSON 404, never the web app. */
const SERVER_PATHS = /^\/(?:api|auth|setup\/github)(?:\/|$)|^\/healthz$/

/**
 * Serves the web build: its files as they are (hashed assets cached for a year), and index.html
 * for any other GET so the client-side router shows the page (refresh, deep links).
 */
export function serveWebBuild(distPath: string): MiddlewareHandler<AppEnv> {
  const file = serveStatic<AppEnv>({ root: distPath })
  const indexPage = serveStatic<AppEnv>({ root: distPath, path: 'index.html' })
  return async (c, next) => {
    const readable = c.req.method === 'GET' || c.req.method === 'HEAD'
    if (!readable || SERVER_PATHS.test(c.req.path)) return next()

    const hashed = c.req.path.startsWith('/assets/')
    c.header('Cache-Control', hashed ? IMMUTABLE : NO_CACHE)
    let found = true
    const response = await file(c, async () => {
      found = false
    })
    if (found) return response
    if (hashed) {
      // An index.html from another version asked for a file this build does not have.
      c.header('Cache-Control', 'no-store')
      return c.text('Not found', 404)
    }
    c.header('Cache-Control', NO_CACHE)
    return indexPage(c, next)
  }
}
