import { secureHeaders } from 'hono/secure-headers'

export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  // Radix and sonner inject <style> elements.
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com'],
  connectSrc: ["'self'"],
  fontSrc: ["'self'"],
  // The GitHub App manifest is posted to github.com by a form of the setup page.
  formAction: ["'self'", 'https://github.com'],
  frameAncestors: ["'none'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
}

/** Hono's hardening headers with RepoERD's CSP; HSTS stays off the parent domain's subdomains. */
export const securityHeaders = () =>
  secureHeaders({
    contentSecurityPolicy: CONTENT_SECURITY_POLICY,
    strictTransportSecurity: 'max-age=15552000',
  })
