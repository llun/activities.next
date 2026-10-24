import type { Database } from '@/lib/database/types'
import {
  escapeCsvField,
  formatLanguages,
  toCsvRow
} from '@/lib/services/exports/csv'

export const EXPORT_FILES = [
  'following_accounts.csv',
  'lists.csv',
  'muted_accounts.csv',
  'blocked_accounts.csv',
  'blocked_domains.csv',
  'bookmarks.csv'
] as const

export type ExportFileName = (typeof EXPORT_FILES)[number]

export const isExportFileName = (file: string): file is ExportFileName =>
  (EXPORT_FILES as readonly string[]).includes(file)

export const DEFAULT_PAGE_SIZE = 500

export const csvEscape = escapeCsvField
export { escapeCsvField, formatLanguages, toCsvRow }

export const exportFollowingAccounts = async (
  database: Database,
  actorId: string,
  options?: { pageSize?: number }
): Promise<string> => {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  let cursor: { createdAt: number; id: string } | undefined
  let output = 'Account address,Show boosts,Notify on new posts,Languages\n'

  for (;;) {
    const page = await database.getFollowingNewestFirst({
      actorId,
      limit: pageSize,
      cursor
    })
    if (page.length === 0) break

    const targetActorIds = page.map((f) => f.targetActorId)
    const actors = await database.getActorsFromIds({ ids: targetActorIds })
    const actorMap = new Map(actors.map((a) => [a.id, a]))

    for (const follow of page) {
      const targetActor = actorMap.get(follow.targetActorId)
      if (!targetActor) continue
      const acct = `${targetActor.username}@${targetActor.domain}`
      output += toCsvRow([
        acct,
        follow.reblogs,
        follow.notify,
        formatLanguages(follow.languages)
      ])
    }

    if (page.length < pageSize) break
    const last = page[page.length - 1]
    cursor = { createdAt: last.createdAt, id: last.id }
  }

  return output
}

export const exportLists = async (
  database: Database,
  actorId: string,
  options?: { pageSize?: number }
): Promise<string> => {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  const lists = await database.getLists({ actorId })
  let output = ''

  for (const list of lists) {
    let maxId: string | undefined
    for (;;) {
      const page = await database.getListMembers({
        listId: list.id,
        actorId,
        limit: pageSize,
        ...(maxId ? { maxId } : null)
      })
      if (page.length === 0) break

      const targetActorIds = page.map((m) => m.targetActorId)
      const actors = await database.getActorsFromIds({ ids: targetActorIds })
      const actorMap = new Map(actors.map((a) => [a.id, a]))

      for (const member of page) {
        const actor = actorMap.get(member.targetActorId)
        if (!actor) continue
        const acct = `${actor.username}@${actor.domain}`
        output += toCsvRow([list.title, acct])
      }

      if (page.length < pageSize) break
      maxId = page[page.length - 1].id
    }
  }

  return output
}

export const exportMutedAccounts = async (
  database: Database,
  actorId: string,
  options?: { pageSize?: number }
): Promise<string> => {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  let maxId: string | undefined
  let output = 'Account address,Hide notifications\n'

  for (;;) {
    const page = await database.getMutes({
      actorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (page.length === 0) break

    const targetActorIds = page.map((m) => m.targetActorId)
    const actors = await database.getActorsFromIds({ ids: targetActorIds })
    const actorMap = new Map(actors.map((a) => [a.id, a]))

    for (const mute of page) {
      const actor = actorMap.get(mute.targetActorId)
      if (!actor) continue
      const acct = `${actor.username}@${actor.domain}`
      // In our schema, notifications: true means hide/mute notifications (Mastodon hide_notifications: true).
      output += toCsvRow([acct, mute.notifications])
    }

    if (page.length < pageSize) break
    maxId = page[page.length - 1].id
  }

  return output
}

export const exportBlockedAccounts = async (
  database: Database,
  actorId: string,
  options?: { pageSize?: number }
): Promise<string> => {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  let maxId: string | undefined
  let output = ''

  for (;;) {
    const page = await database.getBlocks({
      actorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (page.length === 0) break

    const targetActorIds = page.map((b) => b.targetActorId)
    const actors = await database.getActorsFromIds({ ids: targetActorIds })
    const actorMap = new Map(actors.map((a) => [a.id, a]))

    for (const block of page) {
      const actor = actorMap.get(block.targetActorId)
      if (!actor) continue
      const acct = `${actor.username}@${actor.domain}`
      output += toCsvRow([acct])
    }

    if (page.length < pageSize) break
    maxId = page[page.length - 1].id
  }

  return output
}

export const exportBlockedDomains = async (
  database: Database,
  actorId: string,
  options?: { pageSize?: number }
): Promise<string> => {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  let maxId: string | undefined
  let output = ''

  for (;;) {
    const page = await database.getActorDomainBlocks({
      actorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (page.length === 0) break

    for (const item of page) {
      output += toCsvRow([item.domain])
    }

    if (page.length < pageSize) break
    maxId = page[page.length - 1].id
  }

  return output
}

export const exportBookmarks = async (
  database: Database,
  actorId: string,
  options?: { pageSize?: number }
): Promise<string> => {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE
  let maxId: string | undefined
  let output = ''

  for (;;) {
    const page = await database.getBookmarks({
      actorId,
      limit: pageSize,
      ...(maxId ? { maxId } : null)
    })
    if (page.length === 0) break

    const statusIds = page.map((b) => b.statusId)
    const statuses = await database.getStatusesByIds({ statusIds })
    const statusSet = new Set(statuses.map((s) => s.id))

    for (const bookmark of page) {
      if (!statusSet.has(bookmark.statusId)) continue
      output += toCsvRow([bookmark.statusId])
    }

    if (page.length < pageSize) break
    maxId = page[page.length - 1].id
  }

  return output
}

export const exportAccountData = async (
  file: ExportFileName,
  database: Database,
  actorId: string,
  options?: { pageSize?: number }
): Promise<string> => {
  switch (file) {
    case 'following_accounts.csv':
      return exportFollowingAccounts(database, actorId, options)
    case 'lists.csv':
      return exportLists(database, actorId, options)
    case 'muted_accounts.csv':
      return exportMutedAccounts(database, actorId, options)
    case 'blocked_accounts.csv':
      return exportBlockedAccounts(database, actorId, options)
    case 'blocked_domains.csv':
      return exportBlockedDomains(database, actorId, options)
    case 'bookmarks.csv':
      return exportBookmarks(database, actorId, options)
  }
}
