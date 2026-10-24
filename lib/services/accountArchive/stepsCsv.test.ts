import type { Database } from '@/lib/database/types'
import { EXPORT_FILES } from '@/lib/services/exports/accountExports'

import type { StepContext } from './steps.types'
import { csvStep } from './stepsCsv'

type Row = Record<string, unknown> & { id: string }

const follows = ['a', 'b', 'c'].map((name, index) => ({
  id: `follow-${index}`,
  targetActorId: `actor-${name}`,
  createdAt: 100 - index,
  reblogs: true,
  notify: false,
  languages: null
}))

describe('csvStep', () => {
  const appended: { entry: string; text: string }[] = []
  const calls: string[] = []
  let tables: Record<string, Row[]>

  const database = {
    getFollowingNewestFirst: async ({
      limit,
      cursor
    }: {
      limit: number
      cursor?: { id: string }
    }) => {
      calls.push('following')
      const start = cursor
        ? follows.findIndex((follow) => follow.id === cursor.id) + 1
        : 0
      return follows.slice(start, start + limit)
    },
    // A keyset on the id, as the real reader: no cursor row has to exist.
    getAccountExportRows: async ({
      table,
      after,
      limit
    }: {
      table: string
      after: (string | number)[] | null
      limit: number
    }) => {
      calls.push(table)
      const all = [...(tables[table] ?? [])].sort((a, b) =>
        a.id < b.id ? -1 : 1
      )
      const rows = all.filter((row) => !after || row.id > String(after[0]))
      const page = rows.slice(0, limit)
      return {
        rows: page,
        next: page.length === limit ? [page[page.length - 1].id] : null
      }
    },
    getActorsFromIds: async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({
        id,
        username: id.replace('actor-', ''),
        domain: 'llun.test'
      })),
    getLists: async () => [
      { id: 'list-1', title: 'First' },
      { id: 'list-2', title: 'Second' }
    ],
    getStatusesByIds: async () => []
  } as unknown as Database

  const context = {
    database,
    actor: { id: 'me', mastodonDir: '' },
    pageSize: 2,
    stage: {
      append: async (entry: string, text: string) => {
        appended.push({ entry, text })
      }
    }
  } as unknown as StepContext

  const textOf = (entry: string) =>
    appended
      .filter((part) => part.entry === entry)
      .map((part) => part.text)
      .join('')

  /** Runs one file to its end, with `between` run after its first page. */
  const runFile = async (index: number, between?: () => void) => {
    let cursor: unknown = { index, page: null }
    let first = true
    for (;;) {
      const result = await csvStep.run(context, cursor)
      if (result === 'done') return
      const next = result.cursor as { index: number }
      if (next.index !== index) return
      cursor = JSON.parse(JSON.stringify(next))
      if (first) between?.()
      first = false
    }
  }

  beforeEach(() => {
    appended.length = 0
    calls.length = 0
    tables = {
      blocks: ['k1', 'k2', 'k3', 'k4', 'k5'].map((id) => ({
        id,
        targetActorId: `actor-${id}`
      })),
      list_accounts: [
        { id: 'm1', listId: 'list-1', targetActorId: 'actor-a' },
        { id: 'm2', listId: 'list-1', targetActorId: 'actor-b' },
        { id: 'm3', listId: 'list-2', targetActorId: 'actor-a' },
        { id: 'm4', listId: 'gone', targetActorId: 'actor-a' }
      ]
    }
  })

  it('does one database page of one file per call and keeps the page cursor', async () => {
    const first = await csvStep.run(context, undefined)
    expect(calls).toEqual(['following'])
    expect(appended).toEqual([
      {
        entry: 'following_accounts.csv',
        text:
          'Account address,Show boosts,Notify on new posts,Languages\n' +
          'a@llun.test,true,false,\n' +
          'b@llun.test,true,false,\n'
      }
    ])
    expect(first).toMatchObject({ cursor: { index: 0 } })

    appended.length = 0
    const second = await csvStep.run(
      context,
      JSON.parse(JSON.stringify((first as { cursor: unknown }).cursor))
    )
    expect(appended).toEqual([
      { entry: 'following_accounts.csv', text: 'c@llun.test,true,false,\n' }
    ])
    expect(second).toEqual({ cursor: { index: 1, page: null } })
  })

  it('writes each member with its list title and leaves out a list that is gone', async () => {
    await runFile(1)
    expect(textOf('lists.csv')).toBe(
      'First,a@llun.test\nFirst,b@llun.test\nSecond,a@llun.test\n'
    )
  })

  it('stages an empty file once, so the entry exists', async () => {
    await runFile(2)
    expect(appended).toEqual([
      {
        entry: 'muted_accounts.csv',
        text: 'Account address,Hide notifications\n'
      }
    ])
  })

  it('ends after the last file', async () => {
    expect(
      await csvStep.run(context, { index: EXPORT_FILES.length - 1, page: null })
    ).toBe('done')
  })

  it('continues after a cursor row that was deleted instead of ending the file', async () => {
    // The last row of the first page is deleted before the next slice.
    await runFile(3, () => {
      tables.blocks = tables.blocks.filter((block) => block.id !== 'k2')
    })
    expect(textOf('blocked_accounts.csv')).toBe(
      'k1@llun.test\nk2@llun.test\nk3@llun.test\nk4@llun.test\nk5@llun.test\n'
    )
  })

  it('never skips or repeats a row when rows are deleted around the cursor', async () => {
    await runFile(3, () => {
      tables.blocks = tables.blocks.filter(
        (block) => !['k1', 'k2', 'k3'].includes(block.id)
      )
    })
    // Everything after the cursor is still written, nothing twice.
    expect(textOf('blocked_accounts.csv')).toBe(
      'k1@llun.test\nk2@llun.test\nk4@llun.test\nk5@llun.test\n'
    )
  })
})
