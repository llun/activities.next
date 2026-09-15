import { describe, expect, it, vi } from 'vitest'

import { filterReadableStatuses } from '@/lib/services/statusRouteAccess'
import { Database, Status } from '@/lib/types/database'
import { StatusType } from '@/lib/types/domain/status'

import { getTimelineContext } from './getTimelineContext'

vi.mock('@/lib/services/statusRouteAccess', () => ({
  filterReadableStatuses: vi.fn(
    async ({ statuses }: { statuses: Status[] }) => statuses
  )
}))

const createMockStatus = (
  overrides: Partial<Status> & { id: string }
): Status => {
  const baseTime = 1710000000000
  return {
    actorId: 'https://example.com/users/alice',
    actor: {
      id: 'https://example.com/users/alice',
      username: 'alice',
      domain: 'example.com',
      name: 'Alice Smith',
      iconUrl: 'https://example.com/alice.png',
      followersUrl: 'https://example.com/users/alice/followers',
      inboxUrl: 'https://example.com/users/alice/inbox',
      sharedInboxUrl: 'https://example.com/inbox',
      followingCount: 10,
      followersCount: 20,
      statusCount: 30,
      lastStatusAt: baseTime,
      createdAt: baseTime
    },
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    edits: [],
    isLocalActor: true,
    createdAt: baseTime,
    updatedAt: baseTime,
    type: StatusType.enum.Note,
    url: `${overrides.id}/url`,
    text: `Content for ${overrides.id}`,
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    ...overrides
  } as Status
}

describe('getTimelineContext', () => {
  it('enforces max 3 rounds traversal limit', async () => {
    // Chain: postE -> postD -> postC -> postB -> postA
    const postA = createMockStatus({ id: 'status-a', reply: '' })
    const postB = createMockStatus({ id: 'status-b', reply: 'status-a' })
    const postC = createMockStatus({ id: 'status-c', reply: 'status-b' })
    const postD = createMockStatus({ id: 'status-d', reply: 'status-c' })
    const postE = createMockStatus({ id: 'status-e', reply: 'status-d' })

    const statusMap = new Map<string, Status>([
      ['status-a', postA],
      ['status-b', postB],
      ['status-c', postC],
      ['status-d', postD]
    ])

    const getStatusesByIds = vi.fn(
      async ({ statusIds }: { statusIds: string[] }) => {
        return statusIds
          .map((id) => statusMap.get(id))
          .filter(Boolean) as Status[]
      }
    )

    const database = {
      getStatusesByIds
    } as unknown as Database

    const result = await getTimelineContext({
      database,
      statuses: [postE]
    })

    // Round 1 fetches postD
    // Round 2 fetches postC
    // Round 3 fetches postB
    // Max 3 rounds reached -> postA is NOT fetched
    expect(getStatusesByIds).toHaveBeenCalledTimes(3)
    expect(result.ancestorsById['status-d']).toBeDefined()
    expect(result.ancestorsById['status-c']).toBeDefined()
    expect(result.ancestorsById['status-b']).toBeDefined()
    expect(result.ancestorsById['status-a']).toBeUndefined()
  })

  it('enforces max 80 statuses count limit', async () => {
    // Create 79 initial statuses, where status-78 replies to parent1
    const initialStatuses: Status[] = []
    for (let i = 0; i < 79; i++) {
      initialStatuses.push(
        createMockStatus({
          id: `initial-${i}`,
          reply: i === 78 ? 'parent-1' : ''
        })
      )
    }

    const parent1 = createMockStatus({ id: 'parent-1', reply: 'parent-2' })
    const parent2 = createMockStatus({ id: 'parent-2', reply: 'parent-3' })

    const statusMap = new Map<string, Status>([
      ['parent-1', parent1],
      ['parent-2', parent2]
    ])

    const getStatusesByIds = vi.fn(
      async ({ statusIds }: { statusIds: string[] }) => {
        return statusIds
          .map((id) => statusMap.get(id))
          .filter(Boolean) as Status[]
      }
    )

    const database = {
      getStatusesByIds
    } as unknown as Database

    const result = await getTimelineContext({
      database,
      statuses: initialStatuses
    })

    // Starts with 79 statuses.
    // Round 1 fetches parent-1 -> total becomes 80.
    // Limit (80) reached, so parent-2 is never fetched in subsequent rounds.
    expect(result.ancestorsById['parent-1']).toBeDefined()
    expect(result.ancestorsById['parent-2']).toBeUndefined()
    expect(getStatusesByIds).toHaveBeenCalledTimes(1)
  })

  it('excludes unreadable or blocked parent status', async () => {
    const parentReadable = createMockStatus({ id: 'parent-readable' })
    const parentUnreadable = createMockStatus({ id: 'parent-unreadable' })

    const child1 = createMockStatus({ id: 'child-1', reply: 'parent-readable' })
    const child2 = createMockStatus({
      id: 'child-2',
      reply: 'parent-unreadable'
    })

    const getStatusesByIds = vi.fn(
      async ({ statusIds }: { statusIds: string[] }) => {
        return [parentReadable, parentUnreadable].filter((s) =>
          statusIds.includes(s.id)
        )
      }
    )

    const mockedFilter = vi.mocked(filterReadableStatuses)
    mockedFilter.mockImplementationOnce(async ({ statuses }) => {
      return statuses.filter((s) => s.id !== 'parent-unreadable')
    })

    const database = {
      getStatusesByIds
    } as unknown as Database

    const result = await getTimelineContext({
      database,
      statuses: [child1, child2]
    })

    expect(result.ancestorsById['parent-readable']).toBeDefined()
    expect(result.ancestorsById['parent-unreadable']).toBeUndefined()
  })

  it('sets empty preview contentHtml and text for CW or sensitive status', async () => {
    const parentWithSpoiler = createMockStatus({
      id: 'parent-cw',
      text: '<p>Secret content behind CW</p>',
      summary: 'Content Warning: Spoilers'
    })

    const parentSensitive = createMockStatus({
      id: 'parent-sensitive',
      text: '<p>Sensitive image or text</p>',
      sensitive: true
    })

    const child1 = createMockStatus({ id: 'child-1', reply: 'parent-cw' })
    const child2 = createMockStatus({
      id: 'child-2',
      reply: 'parent-sensitive'
    })

    const database = {
      getStatusesByIds: vi.fn(async () => [parentWithSpoiler, parentSensitive])
    } as unknown as Database

    const result = await getTimelineContext({
      database,
      statuses: [child1, child2]
    })

    const previewCw = result.ancestorsById['parent-cw']
    expect(previewCw).toBeDefined()
    expect(previewCw.contentHtml).toBe('')
    expect(previewCw.text).toBe('')
    expect(previewCw.spoilerText).toBe('Content Warning: Spoilers')
    expect(previewCw.isSensitive).toBe(true)

    const previewSensitive = result.ancestorsById['parent-sensitive']
    expect(previewSensitive).toBeDefined()
    expect(previewSensitive.contentHtml).toBe('')
    expect(previewSensitive.text).toBe('')
    expect(previewSensitive.isSensitive).toBe(true)
  })

  it('gracefully returns empty ancestors when parent is missing or not found', async () => {
    const orphanChild = createMockStatus({
      id: 'orphan-child',
      reply: 'missing-parent-id'
    })

    const database = {
      getStatusesByIds: vi.fn(async () => [])
    } as unknown as Database

    const result = await getTimelineContext({
      database,
      statuses: [orphanChild]
    })

    expect(result).toEqual({ ancestorsById: {} })
  })

  it('resolves parent by URL using getStatusFromUrl when getStatusesByIds misses', async () => {
    const parentByUrl = createMockStatus({
      id: 'https://remote.test/posts/parent-url-1',
      url: 'https://remote.test/posts/parent-url-1',
      text: 'Parent fetched via URL'
    })

    const child = createMockStatus({
      id: 'child-with-url-reply',
      reply: 'https://remote.test/posts/parent-url-1'
    })

    const database = {
      getStatusesByIds: vi.fn(async () => []),
      getStatusFromUrl: vi.fn(async ({ url }: { url: string }) => {
        if (url === 'https://remote.test/posts/parent-url-1') {
          return parentByUrl
        }
        return null
      })
    } as unknown as Database

    const result = await getTimelineContext({
      database,
      statuses: [child]
    })

    expect(database.getStatusFromUrl).toHaveBeenCalledWith({
      url: 'https://remote.test/posts/parent-url-1'
    })
    expect(
      result.ancestorsById['https://remote.test/posts/parent-url-1']
    ).toBeDefined()
    expect(
      result.ancestorsById['https://remote.test/posts/parent-url-1'].text
    ).toBe('Parent fetched via URL')
  })
})
