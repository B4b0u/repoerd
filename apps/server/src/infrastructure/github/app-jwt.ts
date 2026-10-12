import { createPrivateKey, createSign } from 'node:crypto'

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')

/**
 * JWT authenticating as the GitHub App: RS256, issued 60 s in the past (clock drift),
 * expiring 9 minutes from now (GitHub accepts at most 10).
 */
export function createAppJwt(appId: number, privateKeyPem: string, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000) - 60
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: String(appId), iat, exp: iat + 600 })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(createPrivateKey(privateKeyPem))
  return `${unsigned}.${signature.toString('base64url')}`
}
