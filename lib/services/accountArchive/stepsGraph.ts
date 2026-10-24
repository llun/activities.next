import type {
  AccountExportCursor,
  AccountExportTableName
} from '@/lib/database/domains/accountExport/types'

import { entryPath } from './layout'
import { groupBy, readAllExportRows, toIso } from './rows'
import type { CollectorStep, StepContext } from './steps.types'

/**
 * `graph.json`: who the actor follows and is followed by, and everything it set
 * up about other accounts (lists, mutes, blocks, domain blocks, notes,
 * endorsements) and about content (filters, featured and followed tags).
 *
 * It is one JSON object with one array per section, written a page at a time:
 * the cursor holds the section being written and how many items it already
 * has, so a resumed run continues the same array.
 */

interface PagedSection {
  kind: 'paged'
  key: string
  table: AccountExportTableName
  /** The column naming another actor, which gets a `handle` beside it. */
  actorColumn?: string
}

interface NestedSection {
  kind: 'lists' | 'filters'
  key: string
}

type GraphSection = PagedSection | NestedSection

export const GRAPH_SECTIONS: readonly GraphSection[] = [
  {
    kind: 'paged',
    key: 'follows',
    table: 'follows',
    actorColumn: 'targetActorId'
  },
  {
    kind: 'paged',
    key: 'followers',
    table: 'followers',
    actorColumn: 'actorId'
  },
  { kind: 'lists', key: 'lists' },
  { kind: 'paged', key: 'mutes', table: 'mutes', actorColumn: 'targetActorId' },
  {
    kind: 'paged',
    key: 'blocks',
    table: 'blocks',
    actorColumn: 'targetActorId'
  },
  { kind: 'paged', key: 'domainBlocks', table: 'actor_domain_blocks' },
  {
    kind: 'paged',
    key: 'accountNotes',
    table: 'account_notes',
    actorColumn: 'targetActorId'
  },
  { kind: 'filters', key: 'filters' },
  { kind: 'paged', key: 'featuredTags', table: 'featured_tags' },
  { kind: 'paged', key: 'followedTags', table: 'followed_tags' },
  {
    kind: 'paged',
    key: 'endorsements',
    table: 'endorsements',
    actorColumn: 'targetActorId'
  }
]

interface GraphCursor {
  section: number
  /** Items already written into the current section's array. */
  count: number
  after?: AccountExportCursor | null
}

const handleOf = (
  actor: { username: string; domain: string } | undefined,
  id: string
) => {
  if (actor) return `${actor.username}@${actor.domain}`
  try {
    return `unknown@${new URL(id).host}`
  } catch {
    return null
  }
}

const withHandles = async (
  context: StepContext,
  rows: Record<string, unknown>[],
  column: string
) => {
  const ids = [...new Set(rows.map((row) => String(row[column])))]
  if (ids.length === 0) return rows
  const actors = await context.database.getActorsFromIds({ ids })
  const byId = new Map(actors.map((actor) => [actor.id, actor]))
  return rows.map((row) => ({
    ...row,
    handle: handleOf(byId.get(String(row[column])), String(row[column]))
  }))
}

const readLists = async (context: StepContext) => {
  const { database, actor, pageSize } = context
  const [lists, members] = await Promise.all([
    readAllExportRows(database, 'lists', actor.id, pageSize),
    readAllExportRows(database, 'list_accounts', actor.id, pageSize)
  ])
  const withMemberHandles = await withHandles(context, members, 'targetActorId')
  const membersByList = groupBy(withMemberHandles, 'listId')
  return lists.map((list) => ({
    ...list,
    members: (membersByList.get(String(list.id)) ?? []).map((member) => ({
      targetActorId: member.targetActorId,
      handle: member.handle,
      createdAt: member.createdAt
    }))
  }))
}

const readFilters = async (context: StepContext) => {
  const { database, actor, pageSize } = context
  const [filters, keywords, statuses] = await Promise.all([
    readAllExportRows(database, 'filters', actor.id, pageSize),
    readAllExportRows(database, 'filter_keywords', actor.id, pageSize),
    readAllExportRows(database, 'filter_statuses', actor.id, pageSize)
  ])
  const keywordsByFilter = groupBy(keywords, 'filterId')
  const statusesByFilter = groupBy(statuses, 'filterId')
  return filters.map((filter) => ({
    ...filter,
    expiresAt: toIso(filter.expiresAt),
    keywords: (keywordsByFilter.get(String(filter.id)) ?? []).map(
      (keyword) => ({
        keyword: keyword.keyword,
        wholeWord: keyword.wholeWord
      })
    ),
    statuses: (statusesByFilter.get(String(filter.id)) ?? []).map(
      (status) => status.statusId
    )
  }))
}

export const graphStep: CollectorStep = {
  name: 'graph',
  async run(context, raw) {
    const { actor, stage } = context
    const entry = entryPath(actor.dir, 'graph.json')
    const cursor = (raw ?? null) as GraphCursor | null

    if (!cursor) {
      await stage.append(entry, '{"version":1')
    }
    const state: GraphCursor = cursor ?? { section: 0, count: 0, after: null }
    const section = GRAPH_SECTIONS[state.section]

    // The array opens when its section is first touched.
    if (state.count === 0 && !state.after) {
      await stage.append(entry, `,${JSON.stringify(section.key)}:[`)
    }

    let items: Record<string, unknown>[] = []
    let next: AccountExportCursor | null = null
    if (section.kind === 'paged') {
      const page = await context.database.getAccountExportRows({
        table: section.table,
        actorId: actor.id,
        after: state.after ?? null,
        limit: context.pageSize
      })
      items = section.actorColumn
        ? await withHandles(context, page.rows, section.actorColumn)
        : page.rows
      next = page.next
      if (section.key === 'follows') context.stats.follows += items.length
      if (section.key === 'followers') context.stats.followers += items.length
    } else if (section.kind === 'lists') {
      items = await readLists(context)
    } else {
      items = await readFilters(context)
    }

    if (items.length > 0) {
      const text = items.map((item) => JSON.stringify(item)).join(',')
      await stage.append(
        entry,
        state.count > 0 ? `,${text}` : text,
        items.length
      )
    }

    if (next) {
      return {
        cursor: {
          section: state.section,
          count: state.count + items.length,
          after: next
        } satisfies GraphCursor
      }
    }

    await stage.append(entry, ']')
    if (state.section + 1 < GRAPH_SECTIONS.length) {
      return {
        cursor: {
          section: state.section + 1,
          count: 0,
          after: null
        } satisfies GraphCursor
      }
    }
    await stage.append(entry, '}\n')
    return 'done'
  }
}
