import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'

/**
 * Kysely counterpart of `findActorRowByUsername` in
 * lib/database/sql/utils/usernameMatch.ts, for domains that have moved to
 * Kysely; the Knex helper stays for `actor.ts`. Read that helper's comment for
 * the rules both follow:
 *
 * - the exact `(username, domain)` match is tried first, so a lookup that works
 *   today cannot break (SQLite's `lower()` folds ASCII only) and an exactly
 *   cased row wins over a case variant;
 * - only on a miss does it fold with `lower(username) = ?` against the input's
 *   `toLowerCase()` (not `normalizeUsername`, which also trims), ordered by
 *   `createdAt` then `id` so the account that claimed the name first wins;
 * - `domain` is matched case-sensitively in both arms.
 *
 * The Knex helper's MySQL arm is not carried over: the Kysely layer supports
 * SQLite and PostgreSQL only.
 */
export const findActorRowByUsername = async (
  db: Db,
  { username, domain }: { username: string; domain: string }
) => {
  const exactMatch = await db
    .selectFrom('actors')
    .selectAll()
    .where('username', '=', username)
    .where('domain', '=', domain)
    .limit(1)
    .executeTakeFirst()
  if (exactMatch) return exactMatch

  return db
    .selectFrom('actors')
    .selectAll()
    .where(sql`lower(${sql.ref('username')})`, '=', username.toLowerCase())
    .where('domain', '=', domain)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .limit(1)
    .executeTakeFirst()
}
