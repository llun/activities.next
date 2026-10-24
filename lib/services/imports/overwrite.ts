import { applyMute } from '@/lib/actions/applyMute'
import { applyUnmute } from '@/lib/actions/applyUnmute'
import { unblockActor } from '@/lib/actions/unblockActor'
import { unfollowActor } from '@/lib/actions/unfollowActor'
import type {
  BulkImport,
  BulkImportRow
} from '@/lib/database/domains/bulkImport/types'
import { Database } from '@/lib/database/types'
import { normalizeActorHost } from '@/lib/services/federation/domainRules'
import { Actor } from '@/lib/types/domain/actor'

import { getActorAcctKey, toAcctKey } from './importRow'

const PAGE_SIZE = 200

type KeyedRow = Pick<BulkImportRow, 'id' | 'state' | 'data'>

// Every row, whatever its state: a row an earlier, interrupted run already
// marked must still count as "in the file", or this run would remove the very
// item it kept.
const loadRowsByKey = async (
  database: Database,
  bulkImport: BulkImport,
  getKey: (row: BulkImportRow) => string | null
): Promise<Map<string, KeyedRow>> => {
  const rows = new Map<string, KeyedRow>()
  let fromRowIndex = 0
  for (;;) {
    const page = await database.getBulkImportRows({
      importId: bulkImport.id,
      fromRowIndex,
      limit: PAGE_SIZE
    })
    for (const row of page) {
      const key = getKey(row)
      if (key) rows.set(key, row)
    }
    if (page.length < PAGE_SIZE) return rows
    fromRowIndex = page[page.length - 1].rowIndex + 1
  }
}

// Collects the whole set before anything is removed: the paged queries use the
// previous page's last row as a cursor, and that row may be what is deleted.
const collectAll = async <T extends { id: string }>(
  fetchPage: (maxId: string | undefined) => Promise<T[]>
): Promise<T[]> => {
  const all: T[] = []
  let maxId: string | undefined
  for (;;) {
    const page = await fetchPage(maxId)
    all.push(...page)
    if (page.length < PAGE_SIZE) return all
    maxId = page[page.length - 1].id
  }
}

// A kept item counts as imported; markBulkImportRowProcessed ignores a row that
// is no longer pending, so a repeated pass never counts it twice.
const keep = async (
  database: Database,
  bulkImport: BulkImport,
  row: KeyedRow
) => {
  await database.markBulkImportRowProcessed({
    importId: bulkImport.id,
    rowId: row.id,
    imported: true
  })
}

/**
 * Mastodon BulkImportService's overwrite pre-pass: keep (and count) what the
 * file names, remove what it does not. Idempotent, so an interrupted pass can
 * simply run again from the start.
 */
export const applyOverwrite = async ({
  database,
  actor,
  bulkImport
}: {
  database: Database
  actor: Actor
  bulkImport: BulkImport
}): Promise<void> => {
  const actorId = actor.id
  const accountKey = (row: BulkImportRow) =>
    row.data.acct ? toAcctKey(row.data.acct, actor) : null

  switch (bulkImport.type) {
    case 'following': {
      const rows = await loadRowsByKey(database, bulkImport, accountKey)
      const follows = await collectAll((maxId) =>
        database.getFollowing({ actorId, limit: PAGE_SIZE, maxId })
      )
      for (const follow of follows) {
        const target = await database.getActorFromId({
          id: follow.targetActorId
        })
        const row = target ? rows.get(getActorAcctKey(target)) : undefined
        if (!row) {
          await unfollowActor({
            database,
            currentActor: actor,
            targetActorId: follow.targetActorId
          })
          continue
        }
        await keep(database, bulkImport, row)
        // Only what the file states: a blank cell leaves the stored value.
        const reblogs = row.data.show_reblogs ?? undefined
        const notify = row.data.notify ?? undefined
        const languages = row.data.languages ?? undefined
        if (
          reblogs !== undefined ||
          notify !== undefined ||
          languages !== undefined
        ) {
          await database.updateFollowPreferences({
            actorId,
            targetActorId: follow.targetActorId,
            reblogs,
            notify,
            languages
          })
        }
      }
      return
    }
    case 'blocking': {
      const rows = await loadRowsByKey(database, bulkImport, accountKey)
      const blocks = await collectAll((maxId) =>
        database.getBlocks({ actorId, limit: PAGE_SIZE, maxId })
      )
      for (const block of blocks) {
        const target = await database.getActorFromId({
          id: block.targetActorId
        })
        const row = target ? rows.get(getActorAcctKey(target)) : undefined
        if (row) {
          // The block stays as it is; re-applying it would federate it again.
          await keep(database, bulkImport, row)
        } else {
          await unblockActor({
            database,
            currentActor: actor,
            targetActorId: block.targetActorId
          })
        }
      }
      return
    }
    case 'muting': {
      const rows = await loadRowsByKey(database, bulkImport, accountKey)
      const mutes = await collectAll((maxId) =>
        database.getMutes({ actorId, limit: PAGE_SIZE, maxId })
      )
      for (const mute of mutes) {
        const target = await database.getActorFromId({
          id: mute.targetActorId
        })
        const row = target ? rows.get(getActorAcctKey(target)) : undefined
        if (!row) {
          await applyUnmute({
            database,
            actorId,
            targetActorId: mute.targetActorId
          })
          continue
        }
        await keep(database, bulkImport, row)
        await applyMute({
          database,
          actorId,
          targetActorId: mute.targetActorId,
          notifications: row.data.hide_notifications ?? true,
          endsAt: null
        })
      }
      return
    }
    case 'domain_blocking': {
      // Mastodon runs this type synchronously; the row pass then blocks the
      // domains of the file (a no-op for the ones kept here).
      const rows = await loadRowsByKey(database, bulkImport, (row) =>
        row.data.domain ? normalizeActorHost(row.data.domain) : null
      )
      const blocks = await database.getActorDomainBlocks({ actorId })
      for (const block of blocks) {
        if (!rows.has(block.domain)) {
          await database.deleteActorDomainBlock({
            actorId,
            domain: block.domain
          })
        }
      }
      return
    }
    case 'bookmarks': {
      const rows = await loadRowsByKey(
        database,
        bulkImport,
        (row) => row.data.uri ?? null
      )
      const bookmarks = await collectAll((maxId) =>
        database.getBookmarks({ actorId, limit: PAGE_SIZE, maxId })
      )
      for (const bookmark of bookmarks) {
        // A bookmark made through a boost keeps that boost's URI as its source.
        const row =
          rows.get(bookmark.statusId) ??
          (bookmark.sourceStatusId
            ? rows.get(bookmark.sourceStatusId)
            : undefined)
        if (row) {
          await keep(database, bulkImport, row)
        } else {
          await database.deleteBookmark({
            actorId,
            statusId: bookmark.statusId
          })
        }
      }
      return
    }
    case 'lists': {
      const rows = await loadRowsByKey(
        database,
        bulkImport,
        (row) => row.data.list_name ?? null
      )
      const lists = await database.getLists({ actorId })
      for (const list of lists) {
        if (!rows.has(list.title)) {
          await database.deleteList({ id: list.id, actorId })
          continue
        }
        // List membership changes do not reach the timeline retroactively, so
        // (like Mastodon) clear it and let the rows rebuild it.
        for (;;) {
          const members = await database.getListMembers({
            listId: list.id,
            actorId,
            limit: PAGE_SIZE
          })
          if (members.length === 0) break
          await database.removeListAccounts({
            listId: list.id,
            actorId,
            targetActorIds: members.map((member) => member.targetActorId)
          })
        }
      }
      return
    }
  }
}
