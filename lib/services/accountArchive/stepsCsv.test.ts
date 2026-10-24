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
