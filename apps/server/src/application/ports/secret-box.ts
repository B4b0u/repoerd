/** A sealed value would not open: SECRET_KEY is not the key it was sealed with. */
export class SecretKeyMismatchError extends Error {
  override name = 'SecretKeyMismatchError'

  constructor() {
    super('SECRET_KEY does not match the stored data')
  }
}

/** Symmetric encryption of secrets stored in the database (App secrets, user tokens). */
export interface SecretBox {
  seal(plain: string): string
  /** Throws when the value was tampered with or sealed with another key. */
  open(sealed: string): string
}
