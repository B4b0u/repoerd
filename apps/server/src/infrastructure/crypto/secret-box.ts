import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { type SecretBox, SecretKeyMismatchError } from '../../application/ports/secret-box.js'

const VERSION = 'v1'
const encode = (bytes: Buffer) => bytes.toString('base64url')
const decode = (text: string) => Buffer.from(text, 'base64url')

/** AES-256-GCM with a key derived from SECRET_KEY (HKDF-SHA256). */
export function createSecretBox(secretKey: string): SecretBox {
  // Historical salt (the project was called db-viewer): changing it would make every stored secret unreadable.
  const key = Buffer.from(hkdfSync('sha256', secretKey, 'db-viewer', 'secret-box v1', 32))
  return {
    seal(plain) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return [VERSION, encode(iv), encode(cipher.getAuthTag()), encode(data)].join('.')
    },
    open(sealed) {
      const [version, iv, tag, data] = sealed.split('.')
      if (version !== VERSION || !iv || !tag || data === undefined) {
        throw new Error('Unsupported sealed secret')
      }
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, decode(iv))
        decipher.setAuthTag(decode(tag))
        return Buffer.concat([decipher.update(decode(data)), decipher.final()]).toString('utf8')
      } catch {
        // The authentication tag does not match: another key, or a tampered value.
        throw new SecretKeyMismatchError()
      }
    },
  }
}
