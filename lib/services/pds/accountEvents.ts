import { appendPdsEvent, getPdsRepo } from '@/lib/database/domains/pds/queries'
import type { PdsEvent, PdsRepoStatus } from '@/lib/database/domains/pds/types'
import type { Db } from '@/lib/database/kysely'

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

/**
 * Appends an `#account` event for the actor's hosted repo, if it has one that
 * is not already deleted. Returns the appended event, or null when there is
 * nothing to append to.
 *
 * `requireActiveRepo` skips a repo whose stored status is not `active`; the
 * moderation layer uses it when reactivating so a deactivated or taken-down
 * repo is not announced as active.
 */
export const appendPdsAccountStatusEvent = async (
  db: Db,
  {
    actorId,
    active,
    status,
    requireActiveRepo = false
  }: {
    actorId: string
    active: boolean
    status?: PdsAccountEventStatus
    requireActiveRepo?: boolean
  }
): Promise<PdsEvent | null> => {
  const repo = await getPdsRepo(db, { actorId })
  if (!repo || repo.status === 'deleted') return null
  if (requireActiveRepo && repo.status !== 'active') return null
  const payload = await encodePdsAccountEvent({
    did: repo.did,
    active,
    status
  })
  return appendPdsEvent(db, { did: repo.did, type: 'account', payload })
}
