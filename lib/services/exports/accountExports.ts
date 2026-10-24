import type { AccountExportCursor } from '@/lib/database/domains/accountExport/types'
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

type ExportRow = Record<string, unknown>

/**
 * One page of rows read through the account export reader: a keyset on the
 * row id, taken from the cursor, never from a row that has to still exist, so
 * a row deleted or edited between two slices cannot end the file, skip a row
 * or repeat one. Rows come oldest id first, which Mastodon does not care about.
 */
const readRows = async (
  database: Database,
  table:
    'mutes' | 'blocks' | 'actor_domain_blocks' | 'list_accounts' | 'bookmarks',
  actorId: string,
  cursor: unknown | null,
  pageSize: number
) => {
  const page = await database.getAccountExportRows({
    table,
    actorId,
    after: (cursor as AccountExportCursor | null) ?? null,
    limit: pageSize
  })
  return { rows: page.rows as ExportRow[], next: page.next }
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

/** One row per member, with the title of its list. */
const listsPage: PageFn = async (database, actorId, cursor, pageSize) => {
  const page = await readRows(
    database,
    'list_accounts',
    actorId,
    cursor,
    pageSize
  )
  const lists = await database.getLists({ actorId })
  const titles = new Map(lists.map((list) => [list.id, list.title]))
  const actorMap = await actorMapFor(
    database,
    page.rows.map((row) => String(row.targetActorId))
  )
  let text = ''
  for (const row of page.rows) {
    const title = titles.get(String(row.listId))
    const actor = actorMap.get(String(row.targetActorId))
    if (title === undefined || !actor) continue
    text += toCsvRow([title, `${actor.username}@${actor.domain}`])
  }
  return { text, next: page.next }
}

const mutedPage: PageFn = async (database, actorId, cursor, pageSize) => {
  const header = cursor ? '' : 'Account address,Hide notifications\n'
  const page = await readRows(database, 'mutes', actorId, cursor, pageSize)
  const actorMap = await actorMapFor(
    database,
    page.rows.map((row) => String(row.targetActorId))
  )
  const now = Date.now()
  let text = header
  for (const row of page.rows) {
    // A timed mute that has ended no longer mutes anyone.
    const endsAt =
      row.endsAt instanceof Date ? row.endsAt.getTime() : Number(row.endsAt)
    if (row.endsAt != null && endsAt <= now) continue
    const actor = actorMap.get(String(row.targetActorId))
    if (!actor) continue
    // In our schema, notifications: true means hide/mute notifications (Mastodon hide_notifications: true).
    text += toCsvRow([
      `${actor.username}@${actor.domain}`,
      Boolean(row.notifications)
    ])
  }
  return { text, next: page.next }
}

const blockedAccountsPage: PageFn = async (
  database,
  actorId,
  cursor,
  pageSize
) => {
  const page = await readRows(database, 'blocks', actorId, cursor, pageSize)
  const actorMap = await actorMapFor(
    database,
    page.rows.map((row) => String(row.targetActorId))
  )
  let text = ''
  for (const row of page.rows) {
    const actor = actorMap.get(String(row.targetActorId))
    if (!actor) continue
    text += toCsvRow([`${actor.username}@${actor.domain}`])
  }
  return { text, next: page.next }
}

const blockedDomainsPage: PageFn = async (
  database,
  actorId,
  cursor,
  pageSize
) => {
  const page = await readRows(
    database,
    'actor_domain_blocks',
    actorId,
    cursor,
    pageSize
  )
  let text = ''
  for (const row of page.rows) text += toCsvRow([String(row.domain)])
  return { text, next: page.next }
}

const bookmarksPage: PageFn = async (database, actorId, cursor, pageSize) => {
  const page = await readRows(database, 'bookmarks', actorId, cursor, pageSize)
  const statusIds = page.rows.map((row) => String(row.statusId))
  const statuses = statusIds.length
    ? await database.getStatusesByIds({ statusIds })
    : []
  const statusSet = new Set(statuses.map((s) => s.id))
  let text = ''
  for (const statusId of statusIds) {
    if (statusSet.has(statusId)) text += toCsvRow([statusId])
  }
  return { text, next: page.next }
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
