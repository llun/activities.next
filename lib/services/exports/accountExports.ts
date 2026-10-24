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

/** One page of a file: its text and where the next page starts (null at the end). */
export type ExportPage = { text: string; next: unknown | null }

type PageFn = (
  database: Database,
  actorId: string,
  cursor: unknown | null,
  pageSize: number
) => Promise<ExportPage>

const idsCursor = (page: { id: string }[], pageSize: number) =>
  page.length < pageSize ? null : { maxId: page[page.length - 1].id }

const maxIdOf = (cursor: unknown | null) => {
  const maxId = (cursor as { maxId?: string } | null)?.maxId
  return maxId ? { maxId } : null
}

const actorMapFor = async (database: Database, ids: string[]) => {
  const actors = await database.getActorsFromIds({ ids })
  return new Map(actors.map((a) => [a.id, a]))
}

const followingPage: PageFn = async (database, actorId, cursor, pageSize) => {
  const after = cursor as { createdAt: number; id: string } | null
  let text = after
    ? ''
    : 'Account address,Show boosts,Notify on new posts,Languages\n'
  const page = await database.getFollowingNewestFirst({
    actorId,
    limit: pageSize,
    cursor: after ?? undefined
  })
  if (page.length === 0) return { text, next: null }

  const actorMap = await actorMapFor(
    database,
    page.map((f) => f.targetActorId)
  )
  for (const follow of page) {
    const targetActor = actorMap.get(follow.targetActorId)
    if (!targetActor) continue
    const acct = `${targetActor.username}@${targetActor.domain}`
    text += toCsvRow([
      acct,
      follow.reblogs,
      follow.notify,
      formatLanguages(follow.languages)
    ])
  }
  const last = page[page.length - 1]
  return {
    text,
    next:
      page.length < pageSize ? null : { createdAt: last.createdAt, id: last.id }
  }
}

/** The cursor is the list's position, then the last member seen in it. */
const listsPage: PageFn = async (database, actorId, cursor, pageSize) => {
  const { list: position = 0, maxId } = (cursor ?? {}) as {
    list?: number
    maxId?: string
  }
  const lists = await database.getLists({ actorId })
  const list = lists[position]
  if (!list) return { text: '', next: null }
  const nextList = position + 1 < lists.length ? { list: position + 1 } : null

  const page = await database.getListMembers({
    listId: list.id,
    actorId,
    limit: pageSize,
    ...(maxId ? { maxId } : null)
  })
  if (page.length === 0) return { text: '', next: nextList }

  const actorMap = await actorMapFor(
    database,
    page.map((m) => m.targetActorId)
  )
  let text = ''
  for (const member of page) {
    const actor = actorMap.get(member.targetActorId)
    if (!actor) continue
    text += toCsvRow([list.title, `${actor.username}@${actor.domain}`])
  }
  return {
    text,
    next:
      page.length < pageSize
        ? nextList
        : { list: position, maxId: page[page.length - 1].id }
  }
}

const mutedPage: PageFn = async (database, actorId, cursor, pageSize) => {
  let text = cursor ? '' : 'Account address,Hide notifications\n'
  const page = await database.getMutes({
    actorId,
    limit: pageSize,
    ...maxIdOf(cursor)
  })
  if (page.length === 0) return { text, next: null }

  const actorMap = await actorMapFor(
    database,
    page.map((m) => m.targetActorId)
  )
  for (const mute of page) {
    const actor = actorMap.get(mute.targetActorId)
    if (!actor) continue
    // In our schema, notifications: true means hide/mute notifications (Mastodon hide_notifications: true).
    text += toCsvRow([`${actor.username}@${actor.domain}`, mute.notifications])
  }
  return { text, next: idsCursor(page, pageSize) }
}

const blockedAccountsPage: PageFn = async (
  database,
  actorId,
  cursor,
  pageSize
) => {
  const page = await database.getBlocks({
    actorId,
    limit: pageSize,
    ...maxIdOf(cursor)
  })
  if (page.length === 0) return { text: '', next: null }

  const actorMap = await actorMapFor(
    database,
    page.map((b) => b.targetActorId)
  )
  let text = ''
  for (const block of page) {
    const actor = actorMap.get(block.targetActorId)
    if (!actor) continue
    text += toCsvRow([`${actor.username}@${actor.domain}`])
  }
  return { text, next: idsCursor(page, pageSize) }
}

const blockedDomainsPage: PageFn = async (
  database,
  actorId,
  cursor,
  pageSize
) => {
  const page = await database.getActorDomainBlocks({
    actorId,
    limit: pageSize,
    ...maxIdOf(cursor)
  })
  if (page.length === 0) return { text: '', next: null }
  let text = ''
  for (const item of page) text += toCsvRow([item.domain])
  return { text, next: idsCursor(page, pageSize) }
}

const bookmarksPage: PageFn = async (database, actorId, cursor, pageSize) => {
  const page = await database.getBookmarks({
    actorId,
    limit: pageSize,
    ...maxIdOf(cursor)
  })
  if (page.length === 0) return { text: '', next: null }

  const statuses = await database.getStatusesByIds({
    statusIds: page.map((b) => b.statusId)
  })
  const statusSet = new Set(statuses.map((s) => s.id))
  let text = ''
  for (const bookmark of page) {
    if (statusSet.has(bookmark.statusId)) text += toCsvRow([bookmark.statusId])
  }
  return { text, next: idsCursor(page, pageSize) }
}

const PAGES: Record<ExportFileName, PageFn> = {
  'following_accounts.csv': followingPage,
  'lists.csv': listsPage,
  'muted_accounts.csv': mutedPage,
  'blocked_accounts.csv': blockedAccountsPage,
  'blocked_domains.csv': blockedDomainsPage,
  'bookmarks.csv': bookmarksPage
}

/**
 * One database page of `file`: the text it adds and the cursor for the next
 * page, null after the last. The first call passes a null cursor and its text
 * starts with the file's header row, if it has one. A caller that has to stop
 * between pages (the account archive) keeps the cursor; the whole-file
 * functions below just loop.
 */
export const exportPage = (
  file: ExportFileName,
  database: Database,
  actorId: string,
  cursor: unknown | null,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<ExportPage> => PAGES[file](database, actorId, cursor, pageSize)

type ExportOptions = { pageSize?: number }

export const exportAccountData = async (
  file: ExportFileName,
  database: Database,
  actorId: string,
  options?: ExportOptions
): Promise<string> => {
  let output = ''
  let cursor: unknown | null = null
  do {
    const page = await exportPage(
      file,
      database,
      actorId,
      cursor,
      options?.pageSize
    )
    output += page.text
    cursor = page.next
  } while (cursor)
  return output
}

export const exportFollowingAccounts = (
  database: Database,
  actorId: string,
  options?: ExportOptions
) => exportAccountData('following_accounts.csv', database, actorId, options)

export const exportLists = (
  database: Database,
  actorId: string,
  options?: ExportOptions
) => exportAccountData('lists.csv', database, actorId, options)

export const exportMutedAccounts = (
  database: Database,
  actorId: string,
  options?: ExportOptions
) => exportAccountData('muted_accounts.csv', database, actorId, options)

export const exportBlockedAccounts = (
  database: Database,
  actorId: string,
  options?: ExportOptions
) => exportAccountData('blocked_accounts.csv', database, actorId, options)

export const exportBlockedDomains = (
  database: Database,
  actorId: string,
  options?: ExportOptions
) => exportAccountData('blocked_domains.csv', database, actorId, options)

export const exportBookmarks = (
  database: Database,
  actorId: string,
  options?: ExportOptions
) => exportAccountData('bookmarks.csv', database, actorId, options)
