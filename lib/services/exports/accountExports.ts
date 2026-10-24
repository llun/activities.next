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

/**
 * Where the next page of an id-paged file starts: the last row seen, and the
 * ids of the few rows before it (oldest last, the last row included).
 */
type IdCursor = { maxId: string; recent: string[] }
const RECENT_ROWS = 5

/**
 * One page of rows that the database pages by "rows after this id". A cursor
 * row deleted between two slices makes such a query answer nothing, which is
 * not the end of the file: the recent ids let the page start from the nearest
 * row that still exists, and the rows already exported are left out.
 */
const fetchIdPage = async <Row extends { id: string }>(
  fetchRows: (maxId: string | undefined, limit: number) => Promise<Row[]>,
  cursor: unknown | null,
  pageSize: number
): Promise<{ rows: Row[]; next: IdCursor | null }> => {
  const after = cursor as IdCursor | null
  let rows = await fetchRows(after?.maxId, pageSize)
  if (after && rows.length === 0) {
    const seen = new Set(after.recent)
    for (const id of [...after.recent].reverse().slice(1)) {
      const later = (await fetchRows(id, pageSize + RECENT_ROWS)).filter(
        (row) => !seen.has(row.id)
      )
      if (later.length > 0) {
        rows = later.slice(0, pageSize)
        break
      }
    }
  }
  if (rows.length < pageSize) return { rows, next: null }
  const recent = [...(after?.recent ?? []), ...rows.map((row) => row.id)]
  return {
    rows,
    next: {
      maxId: rows[rows.length - 1].id,
      recent: recent.slice(-RECENT_ROWS)
    }
  }
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

type ListKey = { id: string; createdAt: number }

/**
 * The cursor names the list being written (its id and creation time) and, in
 * it, the member cursor. A list deleted between two slices is replaced by the
 * first list created after it.
 */
const listsPage: PageFn = async (database, actorId, cursor, pageSize) => {
  const { list: key, members } = (cursor ?? {}) as {
    list?: ListKey
    members?: IdCursor | null
  }
  const lists = await database.getLists({ actorId })
  let position = 0
  let memberCursor: IdCursor | null = null
  if (key) {
    position = lists.findIndex((list) => list.id === key.id)
    if (position >= 0) {
      memberCursor = members ?? null
    } else {
      position = lists.findIndex(
        (list) =>
          list.createdAt > key.createdAt ||
          (list.createdAt === key.createdAt && list.id > key.id)
      )
    }
  }
  const list = lists[position]
  if (!list) return { text: '', next: null }
  const following = lists[position + 1]
  const nextList = following
    ? { list: { id: following.id, createdAt: following.createdAt } }
    : null

  const page = await fetchIdPage(
    (maxId, limit) =>
      database.getListMembers({
        listId: list.id,
        actorId,
        limit,
        ...(maxId ? { maxId } : null)
      }),
    memberCursor,
    pageSize
  )
  const actorMap = await actorMapFor(
    database,
    page.rows.map((m) => m.targetActorId)
  )
  let text = ''
  for (const member of page.rows) {
    const actor = actorMap.get(member.targetActorId)
    if (!actor) continue
    text += toCsvRow([list.title, `${actor.username}@${actor.domain}`])
  }
  return {
    text,
    next: page.next
      ? {
          list: { id: list.id, createdAt: list.createdAt },
          members: page.next
        }
      : nextList
  }
}

const mutedPage: PageFn = async (database, actorId, cursor, pageSize) => {
  const text = cursor ? '' : 'Account address,Hide notifications\n'
  const page = await fetchIdPage(
    (maxId, limit) =>
      database.getMutes({ actorId, limit, ...(maxId ? { maxId } : null) }),
    cursor,
    pageSize
  )
  const actorMap = await actorMapFor(
    database,
    page.rows.map((m) => m.targetActorId)
  )
  let output = text
  for (const mute of page.rows) {
    const actor = actorMap.get(mute.targetActorId)
    if (!actor) continue
    // In our schema, notifications: true means hide/mute notifications (Mastodon hide_notifications: true).
    output += toCsvRow([
      `${actor.username}@${actor.domain}`,
      mute.notifications
    ])
  }
  return { text: output, next: page.next }
}

const blockedAccountsPage: PageFn = async (
  database,
  actorId,
  cursor,
  pageSize
) => {
  const page = await fetchIdPage(
    (maxId, limit) =>
      database.getBlocks({ actorId, limit, ...(maxId ? { maxId } : null) }),
    cursor,
    pageSize
  )
  const actorMap = await actorMapFor(
    database,
    page.rows.map((b) => b.targetActorId)
  )
  let text = ''
  for (const block of page.rows) {
    const actor = actorMap.get(block.targetActorId)
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
  const page = await fetchIdPage(
    (maxId, limit) =>
      database.getActorDomainBlocks({
        actorId,
        limit,
        ...(maxId ? { maxId } : null)
      }),
    cursor,
    pageSize
  )
  let text = ''
  for (const item of page.rows) text += toCsvRow([item.domain])
  return { text, next: page.next }
}

const bookmarksPage: PageFn = async (database, actorId, cursor, pageSize) => {
  const page = await fetchIdPage(
    (maxId, limit) =>
      database.getBookmarks({ actorId, limit, ...(maxId ? { maxId } : null) }),
    cursor,
    pageSize
  )
  const statuses = page.rows.length
    ? await database.getStatusesByIds({
        statusIds: page.rows.map((b) => b.statusId)
      })
    : []
  const statusSet = new Set(statuses.map((s) => s.id))
  let text = ''
  for (const bookmark of page.rows) {
    if (statusSet.has(bookmark.statusId)) text += toCsvRow([bookmark.statusId])
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
