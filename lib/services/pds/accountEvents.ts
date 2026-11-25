import { appendPdsEvent, getPdsRepo } from '@/lib/database/domains/pds/queries'
import type { PdsEvent, PdsRepoStatus } from '@/lib/database/domains/pds/types'
import type { Db } from '@/lib/database/kysely'

import { resolveEffectivePdsRepoStatus } from './effectiveStatus'
import { getMovedToHost } from './moved'

// Appends `#account` events for a hosted repo from the database layer and the
// actor-deletion job. Kept out of `events.ts` (which imports `@atproto/repo`)
// so CommonJS callers can reach it: the CBOR encoder is loaded lazily with a
// bare package specifier, which stays native under tsx/cjs.

export type PdsAccountEventStatus =
  Exclude<PdsRepoStatus, 'active'> | 'deleted' | 'suspended'

/**
 * DAG-CBOR-encodes a sync-1.1 `#account` event payload. `status` is only
 * written when the account is inactive, matching `formatPdsAccountEvent`.
 */
export const encodePdsAccountEvent = async ({
  did,
  active,
  status,
  time = new Date().toISOString()
}: {
  did: string
  active: boolean
  status?: PdsAccountEventStatus
  time?: string
}): Promise<Uint8Array> => {
  const { encode } = await import('@atproto/lex-cbor')
  const payload: Record<string, unknown> = { did, active, time }
  if (!active && status) {
    payload.status = status
  }
  return encode(payload as Parameters<typeof encode>[0])
}

// Reads the actor and its account as they stand inside `db` (the caller's
// transaction), for the effective status.
const getStatusActor = async (db: Db, actorId: string) => {
  const row = await db
    .selectFrom('actors')
    .leftJoin('accounts', 'accounts.id', 'actors.accountId')
    .select([
      'actors.suspendedAt',
      'actors.deletionStatus',
      'actors.accountId',
      'accounts.approvedAt',
      'accounts.disabledAt',
      'accounts.verificationCode',
      'accounts.emailVerified'
    ])
    .where('actors.id', '=', actorId)
    .executeTakeFirst()
  if (!row) return null
  return {
    suspendedAt: row.suspendedAt,
    deletionStatus: row.deletionStatus,
    account: row.accountId
      ? {
          approvedAt: row.approvedAt,
          disabledAt: row.disabledAt,
          verificationCode: row.verificationCode,
          emailVerified: row.emailVerified
        }
      : null
  }
}

/**
 * Appends an `#account` event for the actor's hosted repo, if it has one that
 * is not already deleted. Returns the appended event, or null when there is
 * nothing to append to.
 *
 * `requireEffectiveActive` skips a repo whose effective status is not
 * `active` (`resolveEffectivePdsRepoStatus`: stored status `active`, and the
 * actor and account not suspended, disabled, deleting, unapproved or
 * unconfirmed); the moderation layer uses it when lifting a block, so a repo
 * still held by another block or turned off by its owner is not announced as
 * active.
 */
export const appendPdsAccountStatusEvent = async (
  db: Db,
  {
    actorId,
    active,
    status,
    requireEffectiveActive = false
  }: {
    actorId: string
    active: boolean
    status?: PdsAccountEventStatus
    requireEffectiveActive?: boolean
  }
): Promise<PdsEvent | null> => {
  const repo = await getPdsRepo(db, { actorId })
  if (!repo || repo.status === 'deleted' || getMovedToHost(repo) !== null) {
    return null
  }
  if (
    requireEffectiveActive &&
    resolveEffectivePdsRepoStatus(repo, await getStatusActor(db, actorId)) !==
      'active'
  ) {
    return null
  }
  const payload = await encodePdsAccountEvent({
    did: repo.did,
    active,
    status
  })
  return appendPdsEvent(db, { did: repo.did, type: 'account', payload })
}
