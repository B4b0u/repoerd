import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { TokenService } from '../../application/ports/tokens.js'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export const nodeTokenService: TokenService = {
  random: () => randomBytes(32).toString('base64url'),
  setupCode: () => {
    const chars = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)])
    return [0, 4, 8].map((start) => chars.slice(start, start + 4).join('')).join('-')
  },
  hash: (value) => createHash('sha256').update(value, 'utf8').digest('hex'),
  sameHash: (a, b) => {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    return left.length === right.length && timingSafeEqual(left, right)
  },
}
