import { applyDomainBlock } from '@/lib/actions/applyDomainBlock'
import { applyMute } from '@/lib/actions/applyMute'
import { blockActor } from '@/lib/actions/blockActor'
import { followActor } from '@/lib/actions/followActor'
import { Database } from '@/lib/database/types'
import { fetchRemoteStatusJob } from '@/lib/jobs/fetchRemoteStatusJob'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { normalizeActorHost } from '@/lib/services/federation/domainRules'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Actor } from '@/lib/types/domain/actor'
import { actorIdsMatch } from '@/lib/utils/activitypub'

import { BulkImportRowData, BulkImportType } from './types'

export type ImportRowResult = { imported: boolean; error?: string }

// Mastodon's `extract_rows_by_acct` strips the local domain so a file naming
// `me@this.server` matches the local actor; here every handle is compared as a
// lowercase `username@domain` (usernames are case-insensitive), and a bare
// username belongs to the importing actor's own domain.
export const toAcctKey = (acct: string, actor: Actor): string => {
  const handle = acct.trim().replace(/^@/, '').toLowerCase()
  return handle.includes('@')
    ? handle
    : `${handle}@${actor.domain}`.toLowerCase()
}

export const getActorAcctKey = (target: {
  username: string
  domain: string
}): string => `${target.username}@${target.domain}`.toLowerCase()

const importAccountRow = async ({
  database,
  actor,
  type,
  data
}: {
  database: Database
  actor: Actor
  type: 'following' | 'blocking' | 'muting' | 'lists'
  data: BulkImportRowData
}): Promise<ImportRowResult> => {
  if (!data.acct) return { imported: false, error: 'Account not found' }

  const resolved = await resolveAccountTarget({
    database,
    input: toAcctKey(data.acct, actor)
  })
  if (resolved.type === 'forbidden') {
    return { imported: false, error: 'Domain not allowed' }
  }
  if (resolved.type !== 'resolved') {
    return { imported: false, error: 'Account not found' }
  }

  const target = resolved.actor
  const isSelf = actorIdsMatch(target.id, actor.id)

  if (type === 'following') {
    if (isSelf) return { imported: false, error: 'Cannot follow yourself' }
    const result = await followActor({
      database,
      currentActor: actor,
      requestedActorId: target.id,
      // A missing or blank cell is undefined: an existing follow keeps its
      // stored preference and only a new follow gets the defaults.
      reblogs: data.show_reblogs ?? undefined,
      notify: data.notify ?? undefined,
      languages: data.languages ?? undefined
    })
    if (result.type === 'forbidden') {
      return { imported: false, error: 'Domain not allowed' }
    }
    if (result.type === 'not-found') {
      return { imported: false, error: 'Account not found' }
    }
    return { imported: true }
  }

  if (type === 'blocking') {
    if (isSelf) return { imported: false, error: 'Cannot block yourself' }
    // An existing block is left as it is: applyBlock keeps it, and a second
    // Block would only be federated again.
    if (
      await database.isBlocking({ actorId: actor.id, targetActorId: target.id })
    ) {
      return { imported: true }
    }
    const result = await blockActor({
      database,
      currentActor: actor,
      requestedActorId: target.id
    })
    if (result.type === 'forbidden') {
      return { imported: false, error: 'Domain not allowed' }
    }
    if (result.type === 'not-found') {
      return { imported: false, error: 'Account not found' }
    }
    return { imported: true }
  }

  if (type === 'muting') {
    if (isSelf) return { imported: false, error: 'Cannot mute yourself' }
    // Our `notifications` flag is Mastodon's `hide_notifications`
    // (the mute route's `notifications` param, default true).
    await applyMute({
      database,
      actorId: actor.id,
      targetActorId: target.id,
      notifications: data.hide_notifications ?? true,
      endsAt: null
    })
    return { imported: true }
  }

  // lists
  if (!data.list_name) return { imported: false, error: 'List not found' }
  const list = (await database.getLists({ actorId: actor.id })).find(
    (item) => item.title === data.list_name
  )
  if (!list) return { imported: false, error: 'List not found' }

  if (!isSelf) {
    // Plain follow with default options; an existing follow is left alone.
    const result = await followActor({
      database,
      currentActor: actor,
      requestedActorId: target.id
    })
    if (result.type === 'forbidden') {
      return { imported: false, error: 'Domain not allowed' }
    }
    if (result.type === 'not-found') {
      return { imported: false, error: 'Account not found' }
    }
  }

  const added = await database.addListAccounts({
    listId: list.id,
    actorId: actor.id,
    targetActorIds: [target.id],
    requireFollowOrRequest: true
  })
  if (added.unrelatedActorIds.length > 0) {
    return { imported: false, error: 'Account is not followed' }
  }
  return { imported: true }
}

const importBookmarkRow = async ({
  database,
  actor,
  data
}: {
  database: Database
  actor: Actor
  data: BulkImportRowData
}): Promise<ImportRowResult> => {
  const uri = data.uri
  if (!uri) return { imported: false, error: 'Status not found' }

  let status = await database.getStatus({ statusId: uri })
  if (!status) {
    if (!URL.canParse(uri)) {
      return { imported: false, error: 'Invalid status URI' }
    }
    // A status that claims to live here but is not stored is gone.
    if (await isLocalFederationDomain(database, uri)) {
      return { imported: false, error: 'Status not found' }
    }
    // Same fetch the status page queues for an unknown remote status; the job
    // stores a public note (and its replies' first page) or nothing.
    await fetchRemoteStatusJob(database, {
      id: `fetch-remote-status-${uri}`,
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: { statusId: uri, firstPageOnly: true }
    })
    status = await database.getStatus({ statusId: uri })
    if (!status) return { imported: false, error: 'Status not found' }
  }

  if (!(await canActorReadStatus({ database, status, currentActor: actor }))) {
    return { imported: false, error: 'Status not found' }
  }

  await database.createBookmark({ actorId: actor.id, statusId: status.id })
  return { imported: true }
}

/**
 * Mastodon's BulkImportRowService for one row. Every branch is idempotent: a
 * re-delivered job may run a row again before it is marked processed.
 */
export const importRow = async ({
  database,
  actor,
  type,
  data
}: {
  database: Database
  actor: Actor
  type: BulkImportType
  data: BulkImportRowData
}): Promise<ImportRowResult> => {
  switch (type) {
    case 'following':
    case 'blocking':
    case 'muting':
    case 'lists':
      return importAccountRow({ database, actor, type, data })
    case 'domain_blocking': {
      const domain = data.domain ? normalizeActorHost(data.domain) : null
      // The domain block route rejects these the same way (422).
      if (!domain || domain.includes('*')) {
        return { imported: false, error: 'Invalid domain' }
      }
      await applyDomainBlock({ database, actorId: actor.id, domain })
      return { imported: true }
    }
    case 'bookmarks':
      return importBookmarkRow({ database, actor, data })
  }
}
