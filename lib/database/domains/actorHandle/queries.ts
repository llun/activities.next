import type { Selectable } from 'kysely'
import { sql } from 'kysely'

import type {
  ActorHandle,
  ActorHandleName,
  GetActorHandlesParams,
  GetCurrentActorHandleParams,
  GetLatestActorHandleReplacedAtParams,
  RecordActorHandleRenameParams,
  RecordActorHandleRenameResult
} from '@/lib/database/domains/actorHandle/types'
import { indexActorSearchDocument } from '@/lib/database/domains/search/accounts'
import { type Db, inTransaction } from '@/lib/database/kysely'
import type { ActorHandles } from '@/lib/database/kysely/db'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'
import type { ActorSettings } from '@/lib/types/database/rows'
import { generatePublicId } from '@/lib/utils/publicId'

const toActorHandle = (row: Selectable<ActorHandles>): ActorHandle => ({
  id: row.id,
  actorId: row.actorId,
  username: row.username,
  domain: row.domain.toLowerCase(),
  createdAt: getCompatibleTime(row.createdAt),
  replacedAt: row.replacedAt !== null ? getCompatibleTime(row.replacedAt) : null
})

// The current-first-then-newest-retired order the ledger is read in. The
// first key spells `is null` rather than an ascending sort because the two
// backends disagree on where NULL sorts: SQLite puts NULLs first ascending,
// PostgreSQL last.
const currentFirstOrder = [
  sql`(${sql.ref('replacedAt')} is null)`,
  'desc'
] as const

export const getActorHandles = async (
  db: Db,
  { actorId }: GetActorHandlesParams
): Promise<ActorHandle[]> => {
  const rows = await db
    .selectFrom('actor_handles')
    .selectAll()
    .where('actorId', '=', actorId)
    .orderBy(...currentFirstOrder)
    .orderBy('replacedAt', 'desc')
    .orderBy('id', 'asc')
    .execute()
  return rows.map(toActorHandle)
}

export const getCurrentActorHandle = async (
  db: Db,
  { actorId }: GetCurrentActorHandleParams
): Promise<ActorHandle | null> => {
  const row = await db
    .selectFrom('actor_handles')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('replacedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()
  return row ? toActorHandle(row) : null
}

export const getLatestActorHandleReplacedAt = async (
  db: Db,
  { actorId }: GetLatestActorHandleReplacedAtParams
): Promise<number | null> => {
  const row = await db
    .selectFrom('actor_handles')
    .select('replacedAt')
    .where('actorId', '=', actorId)
    .where('replacedAt', 'is not', null)
    .orderBy('replacedAt', 'desc')
    .limit(1)
    .executeTakeFirst()
  return row?.replacedAt !== null && row?.replacedAt !== undefined
    ? getCompatibleTime(row.replacedAt)
    : null
}

// The ledger row a handle folds to, whichever actor holds it and whether it
// is current or retired. The folded unique index allows at most one row per
// handle, so a lookup is never ambiguous. Domains fold at read as well as at
// write, so a legacy mixed-case stored domain matches its lowercase spelling.
const findHandleRow = async (
  db: Db,
  { username, domain }: ActorHandleName
): Promise<Selectable<ActorHandles> | undefined> =>
  db
    .selectFrom('actor_handles')
    .selectAll()
    .where(sql`lower(${sql.ref('username')})`, '=', username.toLowerCase())
    .where(sql`lower(${sql.ref('domain')})`, '=', domain.toLowerCase())
    .limit(1)
    .executeTakeFirst()

// The actorId a ledger row reserves for a handle, or null when the handle is
// not in the ledger. Every row counts: a CURRENT row names the actor that
// holds the handle now, a REPLACED one the actor that gave it up.
export const getActorIdFromHandle = async (
  db: Db,
  handle: ActorHandleName
): Promise<string | null> => {
  const row = await findHandleRow(db, handle)
  return row?.actorId ?? null
}

// The actorId a REPLACED ledger row points at — the third arm of
// getActorFromUsername, which resolves a renamed actor through the handle it
// gave up. Runs only on a miss of the actors arms, so it can never shadow a
// live actor's current handle.
export const getActorIdFromReplacedHandle = async (
  db: Db,
  handle: ActorHandleName
): Promise<string | null> => {
  const row = await findHandleRow(db, handle)
  return row && row.replacedAt !== null ? row.actorId : null
}

export const recordActorHandleRename = async (
  db: Db,
  { actorId, username, domain, now, cooldownMs }: RecordActorHandleRenameParams
): Promise<RecordActorHandleRenameResult> => {
  try {
    return await inTransaction(db, async (trx) => {
      // The actors row lock serialises concurrent renames of the same actor
      // (and the mint paths' handle inserts against this one). A no-op on
      // SQLite, which locks the whole database per write transaction — the
      // actorMigration pattern.
      const actor = await forUpdate(
        trx,
        trx.selectFrom('actors').selectAll().where('id', '=', actorId).limit(1)
      ).executeTakeFirst()
      // Not found, not local (a remote row has no private key) or not
      // account-backed: nothing to rename.
      if (!actor?.accountId || !actor.privateKey) {
        return { ok: false, status: 'not_found' }
      }
      const settings =
        getCompatibleJSON<ActorSettings>(actor.settings as string) ?? {}
      // A moved or redirecting actor can't rename (settings.movedTo is set in
      // the same transaction that records the outgoing migration, so the
      // pointer IS the active migration).
      if (settings.movedTo) {
        return { ok: false, status: 'moved' }
      }
      if (actor.deletionStatus !== null || actor.suspendedAt !== null) {
        return { ok: false, status: 'unavailable' }
      }

      const rows = await trx
        .selectFrom('actor_handles')
        .selectAll()
        .where('actorId', '=', actorId)
        .execute()
      const ledger = rows.map(toActorHandle)
      const currentRow = ledger.find((row) => row.replacedAt === null) ?? null
      const currentHandle: ActorHandleName = {
        username: String(actor.username ?? ''),
        domain: String(actor.domain ?? '').toLowerCase()
      }

      // A case twin in `actors` folds to this actor's current handle: neither
      // twin may rename. Retiring the handle would hand its folded lookup to
      // the twin (the ledger's retired row would lose to the twin's live
      // actors row were the lookup order not fixed, and the twin's own row
      // would shadow the reservation), so the winner of a backfill case pair
      // is as stuck as the skipped twin the `!currentRow` check below refuses.
      const actorsTwin = await trx
        .selectFrom('actors')
        .select('id')
        .where(
          sql`lower(${sql.ref('username')})`,
          '=',
          currentHandle.username.toLowerCase()
        )
        .where(sql`lower(${sql.ref('domain')})`, '=', currentHandle.domain)
        .where('id', '!=', actorId)
        .limit(1)
        .executeTakeFirst()
      if (actorsTwin) {
        return { ok: false, status: 'cannot_rename' }
      }

      // The actor holds no current row (minted before the ledger, or a backfill
      // case twin) and ANOTHER actor's row occupies its handle: renaming would
      // lazily mint a row for a handle the ledger already attributes elsewhere.
      if (!currentRow) {
        const twin = await findHandleRow(trx, currentHandle)
        if (twin && twin.actorId !== actorId) {
          return { ok: false, status: 'cannot_rename' }
        }
      }

      const targetUsername = username
      const targetDomain = domain.toLowerCase()
      if (
        targetUsername.toLowerCase() === currentHandle.username.toLowerCase() &&
        targetDomain === currentHandle.domain
      ) {
        return { ok: false, status: 'unchanged' }
      }

      // A rename inside the cooldown after the actor's latest replacement is
      // refused. Backfilled and lazily minted rows have a null replacedAt and
      // never trigger it.
      const latestReplacedAt = ledger
        .filter((row) => row.replacedAt !== null)
        .reduce<number | null>(
          (latest, row) =>
            latest === null || (row.replacedAt ?? 0) > latest
              ? row.replacedAt
              : latest,
          null
        )
      if (
        latestReplacedAt !== null &&
        latestReplacedAt + cooldownMs > now.getTime()
      ) {
        return {
          ok: false,
          status: 'cooldown',
          cooldownUntil: latestReplacedAt + cooldownMs
        }
      }

      // The target is held by ANOTHER actor — live in `actors`, current or
      // retired in the ledger. The actor's OWN replaced row for the target is
      // not taken: it is the rename-back case below.
      const actorsTaken = await trx
        .selectFrom('actors')
        .select('id')
        .where(
          sql`lower(${sql.ref('username')})`,
          '=',
          targetUsername.toLowerCase()
        )
        .where(sql`lower(${sql.ref('domain')})`, '=', targetDomain)
        .where('id', '!=', actorId)
        .limit(1)
        .executeTakeFirst()
      if (actorsTaken) {
        return { ok: false, status: 'taken' }
      }
      const ledgerTaken = await findHandleRow(trx, {
        username: targetUsername,
        domain: targetDomain
      })
      if (ledgerTaken && ledgerTaken.actorId !== actorId) {
        return { ok: false, status: 'taken' }
      }

      // Lazily mint the current row the actor is missing, from the actor's own
      // row (the backfill's twin rule means that is safe exactly when the check
      // above passed). An own replaced row for the current handle is revived
      // rather than duplicated.
      let previousRow = currentRow
      if (!previousRow) {
        const ownCurrentHandleRow = ledger.find(
          (row) =>
            row.replacedAt !== null &&
            row.username.toLowerCase() ===
              currentHandle.username.toLowerCase() &&
            row.domain === currentHandle.domain
        )
        if (ownCurrentHandleRow) {
          await trx
            .updateTable('actor_handles')
            .set({
              replacedAt: null,
              // The row returns to current under the actor's stored spelling,
              // so the history never shows a casing the actor does not hold.
              username: currentHandle.username,
              domain: currentHandle.domain
            })
            .where('id', '=', ownCurrentHandleRow.id)
            .execute()
          previousRow = {
            ...ownCurrentHandleRow,
            username: currentHandle.username,
            domain: currentHandle.domain,
            replacedAt: null
          }
        } else {
          const mintedId = generatePublicId()
          await trx
            .insertInto('actor_handles')
            .values({
              id: mintedId,
              actorId,
              username: currentHandle.username,
              domain: currentHandle.domain,
              createdAt: new Date(getCompatibleTime(actor.createdAt ?? 0)),
              replacedAt: null
            })
            .execute()
          previousRow = {
            id: mintedId,
            actorId,
            username: currentHandle.username,
            domain: currentHandle.domain,
            createdAt: getCompatibleTime(actor.createdAt ?? 0),
            replacedAt: null
          }
        }
      }

      // Rename back: the actor's own replaced row for the target becomes
      // current again; a second row for it must never exist.
      let handleId: string
      const ownTargetRow =
        ledgerTaken && ledgerTaken.actorId === actorId ? ledgerTaken : null
      if (ownTargetRow) {
        await trx
          .updateTable('actor_handles')
          .set({
            replacedAt: null,
            // A rename back revives the row under the target's exact spelling:
            // the ledger must not keep the casing the handle was retired with
            // (alice → bob → ALICE would otherwise leave `alice` in the
            // history, and a later rename would mint its prefix from there).
            username: targetUsername,
            domain: targetDomain
          })
          .where('id', '=', ownTargetRow.id)
          .execute()
        handleId = ownTargetRow.id
      } else {
        handleId = generatePublicId()
        await trx
          .insertInto('actor_handles')
          .values({
            id: handleId,
            actorId,
            username: targetUsername,
            domain: targetDomain,
            createdAt: now,
            replacedAt: null
          })
          .execute()
      }

      await trx
        .updateTable('actor_handles')
        .set({ replacedAt: now })
        .where('id', '=', previousRow.id)
        // The revived rename-back row IS the row that just became current; do
        // not retire what was just revived.
        .where('id', '!=', handleId)
        .execute()

      await trx
        .updateTable('actors')
        .set({
          username: targetUsername,
          domain: targetDomain,
          updatedAt: now
        })
        .where('id', '=', actorId)
        .execute()

      // The search document carries the handle: re-index it in the same
      // transaction, so search sees the new name exactly when the actors row
      // does.
      await indexActorSearchDocument(trx, { id: actorId })

      return {
        ok: true,
        // The locked actors row as stored — not the ledger row that was just
        // retired, whose casing may lag behind (the rename-back revive above
        // is what keeps them equal from now on). Status permalinks were minted
        // from the actors row's spelling, so the rewrite prefix must be too.
        previous: {
          username: currentHandle.username,
          domain: String(actor.domain ?? '')
        },
        current: { username: targetUsername, domain: targetDomain },
        handleId,
        renamedAt: now.getTime()
      }
    })
  } catch (error) {
    // A concurrent rename onto the same target (or a sign-up racing this
    // rename) commits its ledger row between the taken checks above and the
    // insert below; the folded unique index is what stops the double claim,
    // and the collision reads as `taken`, never as a 500.
    if (isUniqueConstraintError(error)) {
      return { ok: false, status: 'taken' }
    }
    throw error
  }
}

export const actorHandleQueries = {
  getActorHandles,
  getCurrentActorHandle,
  getLatestActorHandleReplacedAt,
  recordActorHandleRename
}
