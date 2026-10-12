export interface UserProfile {
  /** GitHub user id (numeric, as a string); 'fake-user' in fake mode. */
  id: string
  login: string
  avatarUrl: string | null
}

export interface AppUser extends UserProfile {
  isAdmin: boolean
}

export interface UserRecord extends AppUser {
  /** Last sign-in or session renewal (at most once a day); null when never recorded. */
  lastSeenAt: Date | null
}

/** The user's GitHub App user-to-server tokens. Expiry dates are null for non-expiring tokens. */
export interface UserTokens {
  accessToken: string
  accessTokenExpiresAt: Date | null
  refreshToken: string | null
  refreshTokenExpiresAt: Date | null
}

export interface UserRepository {
  /** Creates the user or updates their profile; never changes the admin flag. */
  upsert(profile: UserProfile): Promise<void>
  get(id: string): Promise<AppUser | null>
  /** Not for the first administrator: use `promoteFirstAdmin`, which is atomic. */
  setAdmin(id: string, isAdmin: boolean): Promise<void>
  countAdmins(): Promise<number>
  /** Makes the user administrator only if there is no administrator yet, atomically. */
  promoteFirstAdmin(id: string): Promise<boolean>
  getTokens(id: string): Promise<UserTokens | null>
  /** `null` clears the tokens: the user has to sign in again. */
  saveTokens(id: string, tokens: UserTokens | null): Promise<void>
  /** Administrators, sorted by login (case-insensitive). */
  listAdmins(): Promise<AppUser[]>
  /** Case-insensitive lookup by GitHub login. */
  findByLogin(login: string): Promise<AppUser | null>
  /** Removes the admin flag, atomically refusing to remove the last administrator (false). */
  demoteAdmin(id: string): Promise<boolean>
  /** Erases every user's GitHub tokens (the App changed); returns how many users had some. */
  clearAllTokens(): Promise<number>
  /** Every user, sorted by lower-cased login, then id. */
  listUsers(): Promise<UserRecord[]>
  /** Records a sign-in or a session renewal as the user's last activity. */
  recordActivity(id: string, at: Date): Promise<void>
}
