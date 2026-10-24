import { applyMute } from '@/lib/actions/applyMute'
import { applyUnmute } from '@/lib/actions/applyUnmute'
import { unblockActor } from '@/lib/actions/unblockActor'
import { unfollowActor } from '@/lib/actions/unfollowActor'
import type {
  BulkImport,
  BulkImportRow
} from '@/lib/database/domains/bulkImport/types'
import { Database } from '@/lib/database/types'
import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import { normalizeActorHost } from '@/lib/services/federation/domainRules'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

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

// Stops the run (by throwing) when it no longer holds the import's lease.
export type RenewLease = () => Promise<void>

// The username part of a row's handle, as toAcctKey writes it.
const rowUsername = (row: KeyedRow, actor: Actor): string =>
  toAcctKey(row.data.acct ?? '', actor).split('@')[0]

// Whether a handle's domain and an actor's host can be one account's two
// names: equal, or one a subdomain of the other (the WEB_DOMAIN split).
const isSameSite = (a: string, b: string): boolean =>
  a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)

export type OverwriteResult = {
  // False when the budget ran out; run it again to continue.
  done: boolean
  // Network work finished this pass (resolutions and removals).
  units: number
}

type AccountRelation = { targetActorId: string }

// Matches the current follows, blocks or mutes to the file's rows and removes
// the ones the file does not name. A row matches by handle first (cheap), then
// by the actor its handle resolves to: Mastodon exports the handle with its
// LOCAL_DOMAIN while the stored domain is the actor's host, and treating that
// as "not in the file" would unfollow and re-add the account. Resolutions are
// stored on the rows, so a budgeted pass picks up where it stopped.
const syncAccountRelations = async ({
  database,
  actor,
  bulkImport,
  deadline,
  renew,
  relations,
  remove,
  onKept
}: {
  database: Database
  actor: Actor
  bulkImport: BulkImport
  deadline: number
  renew: RenewLease
  relations: AccountRelation[]
  remove: (targetActorId: string) => Promise<unknown>
  onKept: (targetActorId: string, row: KeyedRow) => Promise<unknown>
}): Promise<OverwriteResult> => {
  const rows = await loadRowsByKey(database, bulkImport, (row) =>
    row.data.acct ? toAcctKey(row.data.acct, actor) : null
  )

  const targets = new Map<string, Actor>()
  for (let i = 0; i < relations.length; i += PAGE_SIZE) {
    const ids = relations.slice(i, i + PAGE_SIZE).map((r) => r.targetActorId)
    for (const target of await database.getActorsFromIds({ ids })) {
      targets.set(target.id, target)
    }
  }

  const kept = new Map<string, KeyedRow>()
  const unmatched: string[] = []
  for (const relation of relations) {
    const target = targets.get(relation.targetActorId)
    const row = target ? rows.get(getActorAcctKey(target)) : undefined
    if (row) kept.set(relation.targetActorId, row)
    else unmatched.push(relation.targetActorId)
  }

  // At least one unit per pass, so every continuation makes progress.
  let units = 0
  const outOfBudget = () => units > 0 && Date.now() >= deadline

  // Relations a row whose resolution failed might still name: the failure is
  // not proof the file omits them (an outage must never cost a follow), so
  // they stay, and the row pass retries the row.
  const protectedActorIds = new Set<string>()

  if (unmatched.length > 0) {
    // A row can only resolve to one of these relations if the username agrees;
    // every other row is left to the row pass.
    const unmatchedUsernames = new Set(
      unmatched.map((id) => targets.get(id)?.username.toLowerCase())
    )
    const keptRowIds = new Set([...kept.values()].map((row) => row.id))
    for (const row of rows.values()) {
      if (
        row.state !== 'pending' ||
        keptRowIds.has(row.id) ||
        row.data.resolvedActorId !== undefined ||
        !unmatchedUsernames.has(rowUsername(row, actor))
      ) {
        continue
      }
      if (outOfBudget()) return { done: false, units }
      let resolvedActorId: string | null = null
      let resolutionForbidden = false
      try {
        const resolved = await resolveAccountTarget({
          database,
          input: toAcctKey(row.data.acct ?? '', actor)
        })
        if (resolved.type === 'resolved') resolvedActorId = resolved.actor.id
        resolutionForbidden = resolved.type === 'forbidden'
      } catch (error) {
        logger.warn({
          message: 'Bulk import could not resolve an account',
          importId: bulkImport.id,
          err: toLoggableError(error)
        })
      }
      await renew()
      row.data = {
        ...row.data,
        resolvedActorId,
        ...(resolutionForbidden ? { resolutionForbidden } : {})
      }
      await database.updateBulkImportRowData({
        importId: bulkImport.id,
        rowId: row.id,
        data: row.data
      })
      units += 1
    }

    const rowsByActorId = new Map<string, KeyedRow>()
    // Handles (username, domain) of the rows that failed for a reason that
    // may pass: a forbidden domain is permanent, so it protects nothing.
    const failedHandles: string[][] = []
    for (const row of rows.values()) {
      if (row.data.resolvedActorId) {
        rowsByActorId.set(row.data.resolvedActorId, row)
      } else if (
        row.state === 'pending' &&
        row.data.resolvedActorId === null &&
        !row.data.resolutionForbidden
      ) {
        failedHandles.push(toAcctKey(row.data.acct ?? '', actor).split('@'))
      }
    }
    for (const targetActorId of unmatched) {
      const row = rowsByActorId.get(targetActorId)
      const target = targets.get(targetActorId)
      if (row) kept.set(targetActorId, row)
      else if (
        target &&
        failedHandles.some(
          ([username, domain]) =>
            username === target.username.toLowerCase() &&
            isSameSite(domain, target.domain.toLowerCase())
        )
      ) {
        protectedActorIds.add(targetActorId)
      }
    }
  }

  for (const { targetActorId } of relations) {
    if (kept.has(targetActorId) || protectedActorIds.has(targetActorId))
      continue
    if (outOfBudget()) return { done: false, units }
    await remove(targetActorId)
    units += 1
    await renew()
  }

  // Last: keeping the final row finishes the import (its counts meet), and a
  // finished import is never run again, so removals must all be done first.
  // The side effect comes before the mark, so a row left pending is redone and
  // a row marked is done; one that is no longer pending was kept by an earlier
  // pass.
  for (const [targetActorId, row] of kept) {
    if (row.state !== 'pending') continue
    if (outOfBudget()) return { done: false, units }
    await onKept(targetActorId, row)
    await renew()
    await keep(database, bulkImport, row)
    units += 1
  }
  return { done: true, units }
}

/**
 * Mastodon BulkImportService's overwrite pre-pass: keep (and count) what the
 * file names, remove what it does not. Idempotent, so an interrupted pass can
 * simply run again from the start. The account types and bookmarks stop when
 * `deadline` passes (after at least one unit of work) and report `done: false`.
 */
export const applyOverwrite = async ({
  database,
  actor,
  bulkImport,
  deadline = Number.POSITIVE_INFINITY,
  renew = async () => {}
}: {
  database: Database
  actor: Actor
  bulkImport: BulkImport
  deadline?: number
  renew?: RenewLease
}): Promise<OverwriteResult> => {
  const actorId = actor.id

  // shortcut: only the account types and bookmarks are budgeted; the others
  // are local work bounded by the 20,000 row cap. Budget them if one ever
  // does remote work.
  switch (bulkImport.type) {
    case 'following': {
      const follows = await collectAll((maxId) =>
        database.getFollowing({ actorId, limit: PAGE_SIZE, maxId })
      )
      return syncAccountRelations({
        database,
        actor,
        bulkImport,
        deadline,
        renew,
        relations: follows,
        remove: (targetActorId) =>
          unfollowActor({ database, currentActor: actor, targetActorId }),
        onKept: async (targetActorId, row) => {
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
              targetActorId,
              reblogs,
              notify,
              languages
            })
          }
        }
      })
    }
    case 'blocking': {
      const blocks = await collectAll((maxId) =>
        database.getBlocks({ actorId, limit: PAGE_SIZE, maxId })
      )
      return syncAccountRelations({
        database,
        actor,
        bulkImport,
        deadline,
        renew,
        relations: blocks,
        remove: (targetActorId) =>
          unblockActor({ database, currentActor: actor, targetActorId }),
        // The block stays as it is; re-applying it would federate it again.
        onKept: async () => {}
      })
    }
    case 'muting': {
      const mutes = await collectAll((maxId) =>
        database.getMutes({ actorId, limit: PAGE_SIZE, maxId })
      )
      return syncAccountRelations({
        database,
        actor,
        bulkImport,
        deadline,
        renew,
        relations: mutes,
        remove: (targetActorId) =>
          applyUnmute({ database, actorId, targetActorId }),
        onKept: (targetActorId, row) =>
          applyMute({
            database,
            actorId,
            targetActorId,
            notifications: row.data.hide_notifications ?? true,
            endsAt: null
          })
      })
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
      return { done: true, units: 0 }
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
      const kept = new Map<string, KeyedRow>()
      const omitted: string[] = []
      for (const bookmark of bookmarks) {
        // A bookmark made through a boost keeps that boost's URI as its source.
        const row =
          rows.get(bookmark.statusId) ??
          (bookmark.sourceStatusId
            ? rows.get(bookmark.sourceStatusId)
            : undefined)
        if (row) kept.set(row.id, row)
        else omitted.push(bookmark.statusId)
      }
      // Both lists are recomputed on every pass, so a pass that stops early
      // leaves only the remaining work for the next one.
      let units = 0
      const outOfBudget = () => units > 0 && Date.now() >= deadline
      for (const statusId of omitted) {
        if (outOfBudget()) return { done: false, units }
        await database.deleteBookmark({ actorId, statusId })
        units += 1
        await renew()
      }
      // Last, as for the account types: keeping the final row finishes the
      // import, so a crash between the two must not leave deletions undone.
      for (const row of kept.values()) {
        if (row.state !== 'pending') continue
        if (outOfBudget()) return { done: false, units }
        await renew()
        await keep(database, bulkImport, row)
        units += 1
      }
      return { done: true, units }
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
      return { done: true, units: 0 }
    }
  }
}
