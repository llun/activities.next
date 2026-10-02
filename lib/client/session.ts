import { AUTH_BASE_PATH } from '@/lib/services/auth/constants'

/**
 * Asks better-auth to slide the signed-in session forward.
 *
 * Server-rendered session reads are pure reads (`disableRefresh` in
 * `getServerAuthSession`): a Server Component cannot write `Set-Cookie`, so a
 * refresh there pushed the database `expireAt` forward while the browser cookie
 * kept the Max-Age it was given at sign-in, and every user was signed out
 * seven days after signing in however active they were. `/get-session` runs in
 * better-auth's own route handler, so when the session is due for a refresh it
 * extends the database row AND re-issues the cookie in the same response.
 *
 * Resolves whether or not anyone is signed in; it never throws, because a
 * failed refresh only means the next attempt tries again.
 */
export const refreshAuthSession = async (): Promise<void> => {
  try {
    await fetch(`${AUTH_BASE_PATH}/get-session`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    })
  } catch {
    // Offline or a transient network failure: nothing to recover here.
  }
}
