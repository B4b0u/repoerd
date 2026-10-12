import type { AppUser } from '../application/ports/user-repository.js'

/** The signed-in user of a request (session in real mode, fixed administrator in fake mode). */
export type CurrentUser = AppUser
