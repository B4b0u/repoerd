import { createCipheriv, hkdfSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SecretKeyMismatchError } from '../../src/application/ports/secret-box.js'
import { createSecretBox } from '../../src/infrastructure/crypto/secret-box.js'
import { nodeTokenService } from '../../src/infrastructure/crypto/tokens.js'

const KEY = 'k'.repeat(32)
const CODE =
  /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/

describe('createSecretBox', () => {
  it('round-trips secrets with a fresh IV each time', () => {
    const box = createSecretBox(KEY)
    const sealed = box.seal('-----BEGIN RSA PRIVATE KEY-----\nabc')
    expect(sealed.startsWith('v1.')).toBe(true)
    expect(sealed).not.toContain('PRIVATE')
    expect(box.seal('same')).not.toBe(box.seal('same'))
    expect(box.open(sealed)).toBe('-----BEGIN RSA PRIVATE KEY-----\nabc')
    expect(box.open(box.seal(''))).toBe('')
  })

  it('opens values sealed before the rename (historical key-derivation salt)', () => {
    const key = Buffer.from(hkdfSync('sha256', KEY, 'db-viewer', 'secret-box v1', 32))
    const iv = Buffer.alloc(12, 7)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update('stored-token', 'utf8'), cipher.final()])
    const enc = (bytes: Buffer) => bytes.toString('base64url')
    const sealed = ['v1', enc(iv), enc(cipher.getAuthTag()), enc(data)].join('.')
    expect(createSecretBox(KEY).open(sealed)).toBe('stored-token')
  })

  it('refuses tampered values, other keys and unsealed text', () => {
    const box = createSecretBox(KEY)
    const sealed = box.seal('token')
    const [version, iv = '', tag = '', data = ''] = sealed.split('.')
    const flip = (part: string) => `${part.startsWith('A') ? 'B' : 'A'}${part.slice(1)}`
    expect(() => box.open(`${version}.${iv}.${tag}.${flip(data)}`)).toThrow()
    expect(() => box.open(`${version}.${flip(iv)}.${tag}.${data}`)).toThrow()
    expect(() => box.open(`${version}.${iv}.${flip(tag)}.${data}`)).toThrow()
    expect(() => createSecretBox('x'.repeat(32)).open(sealed)).toThrow(SecretKeyMismatchError)
    expect(() => box.open('plain-text')).toThrow('Unsupported sealed secret')
  })
})

describe('nodeTokenService', () => {
  it('creates 256-bit URL-safe tokens and typable setup codes', () => {
    const token = nodeTokenService.random()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(nodeTokenService.random()).not.toBe(token)
    expect(nodeTokenService.setupCode()).toMatch(CODE)
  })

  it('never uses look-alike characters in setup codes', () => {
    for (let i = 0; i < 200; i++) {
      const code = nodeTokenService.setupCode()
      expect(code).toMatch(CODE)
      expect(code).not.toMatch(/[ILO01]/)
    }
  })

  it('hashes with SHA-256 and compares hashes safely', () => {
    const hash = nodeTokenService.hash('abc')
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(nodeTokenService.sameHash(hash, nodeTokenService.hash('abc'))).toBe(true)
    expect(nodeTokenService.sameHash(hash, nodeTokenService.hash('abd'))).toBe(false)
    expect(nodeTokenService.sameHash(hash, 'short')).toBe(false)
  })
})
