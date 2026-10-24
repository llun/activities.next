import type { Database } from '@/lib/database/types'
import { EXPORT_FILES } from '@/lib/services/exports/accountExports'

import type { StepContext } from './steps.types'
import { csvStep } from './stepsCsv'

const follows = ['a', 'b', 'c'].map((name, index) => ({
  id: `follow-${index}`,
  targetActorId: `actor-${name}`,
  createdAt: 100 - index,
  reblogs: true,
  notify: false,
  languages: null
}))
const lists = [
  { id: 'list-1', title: 'First' },
  { id: 'list-2', title: 'Second' }
]
const members: Record<string, { id: string; targetActorId: string }[]> = {
  'list-1': [
    { id: 'm1', targetActorId: 'actor-a' },
    { id: 'm2', targetActorId: 'actor-b' },
    { id: 'm3', targetActorId: 'actor-c' }
  ],
  'list-2': [{ id: 'm4', targetActorId: 'actor-a' }]
}

const calls: string[] = []

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
  getActorsFromIds: async ({ ids }: { ids: string[] }) =>
    ids.map((id) => ({
      id,
      username: id.replace('actor-', ''),
      domain: 'llun.test'
    })),
  getLists: async () => lists,
  getListMembers: async ({
    listId,
    limit,
    maxId
  }: {
    listId: string
    limit: number
    maxId?: string
  }) => {
    calls.push('lists')
    const all = members[listId]
    const start = maxId ? all.findIndex((member) => member.id === maxId) + 1 : 0
    return all.slice(start, start + limit)
  },
  getMutes: async () => [],
  getBlocks: async () => [],
  getActorDomainBlocks: async () => [],
  getBookmarks: async () => [],
  getStatusesByIds: async () => []
} as unknown as Database

describe('csvStep', () => {
  const appended: { entry: string; text: string }[] = []
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

  beforeEach(() => {
    appended.length = 0
    calls.length = 0
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
    expect(first).not.toBe('done')

    // A later call resumes from the cursor alone: no second header, no row
    // repeated, and the last page moves on to the next file.
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

  it('pages through every list and stages an empty file once', async () => {
    let cursor: unknown = { index: 1, page: null }
    let steps = 0
    for (;;) {
      const result = await csvStep.run(context, cursor)
      steps += 1
      const next = (result as { cursor: { index: number } }).cursor
      if (result === 'done' || next.index !== 1) break
      cursor = next
    }
    const lines = appended
      .filter((part) => part.entry === 'lists.csv')
      .map((part) => part.text)
      .join('')
    expect(lines).toBe(
      'First,a@llun.test\nFirst,b@llun.test\nFirst,c@llun.test\nSecond,a@llun.test\n'
    )
    // Two pages for the first list, one for the second.
    expect(calls).toEqual(['lists', 'lists', 'lists'])
    expect(steps).toBe(3)

    appended.length = 0
    await csvStep.run(context, { index: 2, page: null })
    expect(appended).toEqual([
      {
        entry: 'muted_accounts.csv',
        text: 'Account address,Hide notifications\n'
      }
    ])
    appended.length = 0
    await csvStep.run(context, { index: 3, page: null })
    expect(appended).toEqual([{ entry: 'blocked_accounts.csv', text: '' }])
  })

  it('ends after the last file', async () => {
    expect(
      await csvStep.run(context, { index: EXPORT_FILES.length - 1, page: null })
    ).toBe('done')
  })
})

describe('csvStep when rows change between slices', () => {
  let blocks: { id: string; targetActorId: string }[]
  let listRows: { id: string; title: string; createdAt: number }[]
  let listMembers: Record<string, { id: string; targetActorId: string }[]>
  const appended: { entry: string; text: string }[] = []

  const after = <Row extends { id: string }>(
    rows: Row[],
    limit: number,
    maxId?: string
  ) => {
    if (!maxId) return rows.slice(0, limit)
    const at = rows.findIndex((row) => row.id === maxId)
    // As the real queries do: a cursor row that is gone answers nothing.
    if (at < 0) return []
    return rows.slice(at + 1, at + 1 + limit)
  }

  const database = {
    getBlocks: async ({ limit, maxId }: { limit: number; maxId?: string }) =>
      after(blocks, limit, maxId),
    getLists: async () => listRows,
    getListMembers: async ({
      listId,
      limit,
      maxId
    }: {
      listId: string
      limit: number
      maxId?: string
    }) => after(listMembers[listId] ?? [], limit, maxId),
    getActorsFromIds: async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({ id, username: id, domain: 'llun.test' }))
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

  const textOf = (entry: string) =>
    appended
      .filter((part) => part.entry === entry)
      .map((part) => part.text)
      .join('')

  beforeEach(() => {
    appended.length = 0
    blocks = ['k1', 'k2', 'k3', 'k4', 'k5'].map((id) => ({
      id,
      targetActorId: id
    }))
    listRows = [
      { id: 'l1', title: 'One', createdAt: 5 },
      { id: 'l2', title: 'Two', createdAt: 5 },
      { id: 'l3', title: 'Three', createdAt: 9 }
    ]
    listMembers = {
      l1: ['a', 'b', 'c'].map((id) => ({ id: `l1-${id}`, targetActorId: id })),
      l2: [{ id: 'l2-a', targetActorId: 'a' }],
      l3: [{ id: 'l3-a', targetActorId: 'z' }]
    }
  })

  it('continues after a cursor row that was deleted instead of ending the file', async () => {
    // The last row of the first page is deleted before the next slice.
    await runFile(3, () => {
      blocks = blocks.filter((block) => block.id !== 'k2')
    })
    expect(textOf('blocked_accounts.csv')).toBe(
      'k1@llun.test\nk2@llun.test\nk3@llun.test\nk4@llun.test\nk5@llun.test\n'
    )
  })

  it('does not repeat a row when the fallback starts from an earlier one', async () => {
    await runFile(3, () => {
      blocks = blocks.filter((block) => block.id !== 'k2')
    })
    const rows = textOf('blocked_accounts.csv').trim().split('\n')
    expect(new Set(rows).size).toBe(rows.length)
  })

  it('keeps each list whole when the list being written is deleted', async () => {
    await runFile(1, () => {
      listRows = listRows.filter((list) => list.id !== 'l1')
    })
    // One's first page was written; the rest of One goes with the list, and
    // the lists after it are written from their start.
    expect(textOf('lists.csv')).toBe(
      'One,a@llun.test\nOne,b@llun.test\nTwo,a@llun.test\nThree,z@llun.test\n'
    )
  })

  it('orders lists of the same creation time by id and loses none', async () => {
    await runFile(1)
    expect(textOf('lists.csv')).toBe(
      'One,a@llun.test\nOne,b@llun.test\nOne,c@llun.test\nTwo,a@llun.test\nThree,z@llun.test\n'
    )
  })
})
