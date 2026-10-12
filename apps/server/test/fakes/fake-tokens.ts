import type { TokenService } from '../../src/application/ports/tokens.js'

/** Predictable tokens: token-1, token-2…; hash(x) is the string "hash(x)". */
export class FakeTokenService implements TokenService {
  private counter = 0
  code = 'ABCD-EFGH-JKMN'

  random() {
    this.counter++
    return `token-${this.counter}`
  }
  setupCode() {
    return this.code
  }
  hash(value: string) {
    return `hash(${value})`
  }
  sameHash(a: string, b: string) {
    return a === b
  }
}
