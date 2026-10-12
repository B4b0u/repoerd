export interface TokenService {
  /** 256-bit random token, base64url (sessions, setup grants, OAuth state). */
  random(): string
  /** One-time setup code, typable by a human: XXXX-XXXX-XXXX. */
  setupCode(): string
  /** SHA-256 hex digest: tokens are stored hashed, never as is. */
  hash(value: string): string
  /** Constant-time comparison of two hashes. */
  sameHash(a: string, b: string): boolean
}
