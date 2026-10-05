import { beforeEach, describe, expect, it, vi } from 'vitest'

import { filterReadableStatuses } from '@/lib/services/statusRouteAccess'
import { Actor, Database, Status } from '@/lib/types/database'
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
  beforeEach(() => {
    vi.mocked(filterReadableStatuses)
      .mockReset()
      .mockImplementation(async ({ statuses }) => statuses)
  })

  const boost = (originalStatus: Status, id = 'boost-1'): Status => ({
    ...createMockStatus({ id }),
    type: StatusType.enum.Announce,
    originalStatus
  })

  it.each(['direct', 'nested'])(
    'resolves parent context for a %s boosted reply',
    async (kind) => {
      const parent = createMockStatus({ id: 'parent-boosted-reply' })
      const reply = createMockStatus({ id: 'reply-1', reply: parent.id })
      const status =
        kind === 'nested' ? boost(boost(reply), 'boost-2') : boost(reply)
      const getStatusesByIds = vi.fn(async () => [parent])
      const database = { getStatusesByIds } as unknown as Database

      const result = await getTimelineContext({ database, statuses: [status] })

      expect(getStatusesByIds).toHaveBeenCalledWith({ statusIds: [parent.id] })
      expect(result.ancestorsById[parent.id]).toMatchObject({
        actor: { username: 'alice' },
        text: 'Content for parent-boosted-reply'
      })
    }
  )

  it('does not look up parent context for a boost of a standalone post', async () => {
    const getStatusesByIds = vi.fn()
    const database = { getStatusesByIds } as unknown as Database

    expect(
      await getTimelineContext({
        database,
        statuses: [boost(createMockStatus({ id: 'standalone' }))]
      })
    ).toEqual({ ancestorsById: {} })
    expect(getStatusesByIds).not.toHaveBeenCalled()
  })

  it('keeps unavailable parent context absent for boosted replies', async () => {
    const database = {
      getStatusesByIds: vi.fn(async () => [])
    } as unknown as Database

    expect(
      await getTimelineContext({
        database,
        statuses: [boost(createMockStatus({ id: 'reply-1', reply: 'missing' }))]
      })
    ).toEqual({ ancestorsById: {} })
  })

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

  it.each([false, true])(
    'excludes unreadable or blocked parent status (boosted: %s)',
    async (boosted) => {
      const parentReadable = createMockStatus({ id: 'parent-readable' })
      const parentUnreadable = createMockStatus({ id: 'parent-unreadable' })

      const child1 = createMockStatus({
        id: 'child-1',
        reply: 'parent-readable'
      })
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
        statuses: boosted
          ? [child1, child2].map((status) =>
              boost(status, `boost-${status.id}`)
            )
          : [child1, child2]
      })

      expect(result.ancestorsById['parent-readable']).toBeDefined()
      expect(result.ancestorsById['parent-unreadable']).toBeUndefined()
    }
  )

  it.each([false, true])(
    'sets empty preview contentHtml, text, and tags for CW or sensitive status (boosted: %s)',
    async (boosted) => {
      const parentWithSpoiler = createMockStatus({
        id: 'parent-cw',
        text: '<p>Secret content behind CW</p>',
        summary: 'Content Warning: Spoilers',
        isLocalActor: false,
        tags: [
          {
            id: 'tag-1',
            statusId: 'parent-cw',
            type: 'hashtag',
            name: 'spoiler',
            value: 'spoiler',
            createdAt: 1710000000000,
            updatedAt: 1710000000000
          }
        ]
      })

      const parentSensitive = createMockStatus({
        id: 'parent-sensitive',
        text: '<p>Sensitive image or text</p>',
        sensitive: true
      })

      const normalTags = [
        {
          id: 'tag-2',
          statusId: 'parent-normal',
          type: 'hashtag' as const,
          name: 'activities',
          value: 'activities',
          createdAt: 1710000000000,
          updatedAt: 1710000000000
        }
      ]

      const parentNormal = createMockStatus({
        id: 'parent-normal',
        text: '<p>Normal text</p>',
        isLocalActor: true,
        tags: normalTags
      })

      const child1 = createMockStatus({ id: 'child-1', reply: 'parent-cw' })
      const child2 = createMockStatus({
        id: 'child-2',
        reply: 'parent-sensitive'
      })
      const child3 = createMockStatus({
        id: 'child-3',
        reply: 'parent-normal'
      })

      const database = {
        getStatusesByIds: vi.fn(async () => [
          parentWithSpoiler,
          parentSensitive,
          parentNormal
        ])
      } as unknown as Database

      const result = await getTimelineContext({
        database,
        statuses: boosted
          ? [child1, child2, child3].map((status) =>
              boost(status, `boost-${status.id}`)
            )
          : [child1, child2, child3]
      })

      const previewCw = result.ancestorsById['parent-cw']
      expect(previewCw).toBeDefined()
      expect(previewCw.contentHtml).toBe('')
      expect(previewCw.text).toBe('')
      expect(previewCw.tags).toEqual([])
      expect(previewCw.isLocalActor).toBe(false)
      expect(previewCw.spoilerText).toBe('Content Warning: Spoilers')
      expect(previewCw.isSensitive).toBe(true)

      const previewSensitive = result.ancestorsById['parent-sensitive']
      expect(previewSensitive).toBeDefined()
      expect(previewSensitive.contentHtml).toBe('')
      expect(previewSensitive.text).toBe('')
      expect(previewSensitive.tags).toEqual([])
      expect(previewSensitive.isSensitive).toBe(true)

      const previewNormal = result.ancestorsById['parent-normal']
      expect(previewNormal).toBeDefined()
      expect(previewNormal.contentHtml).toBe('<p>Normal text</p>')
      expect(previewNormal.text).toBe('<p>Normal text</p>')
      expect(previewNormal.tags).toEqual(normalTags)
      expect(previewNormal.isLocalActor).toBe(true)
    }
  )

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

  it.each([false, true])(
    'strictly excludes blocked or muted parent statuses when currentActor is present (boosted: %s)',
    async (boosted) => {
      const parentBlocked = createMockStatus({
        id: 'parent-blocked',
        actorId: 'https://example.com/users/blocked-user'
      })
      const parentMuted = createMockStatus({
        id: 'parent-muted',
        actorId: 'https://example.com/users/muted-user'
      })
      const parentAllowed = createMockStatus({
        id: 'parent-allowed',
        actorId: 'https://example.com/users/allowed-user'
      })

      const child1 = createMockStatus({
        id: 'child-1',
        reply: 'parent-blocked'
      })
      const child2 = createMockStatus({ id: 'child-2', reply: 'parent-muted' })
      const child3 = createMockStatus({
        id: 'child-3',
        reply: 'parent-allowed'
      })

      const database = {
        getStatusesByIds: vi.fn(
          async ({ statusIds }: { statusIds: string[] }) => {
            return [parentBlocked, parentMuted, parentAllowed].filter((s) =>
              statusIds.includes(s.id)
            )
          }
        ),
        getBlockRelations: vi.fn(async () => [
          {
            actorId: 'https://example.com/users/viewer',
            targetActorId: 'https://example.com/users/blocked-user'
          }
        ]),
        getMuteRelations: vi.fn(async () => [
          {
            actorId: 'https://example.com/users/viewer',
            targetActorId: 'https://example.com/users/muted-user'
          }
        ])
      } as unknown as Database

      const currentActor = {
        id: 'https://example.com/users/viewer'
      } as Actor

      const result = await getTimelineContext({
        database,
        currentActor,
        statuses: boosted
          ? [child1, child2, child3].map((status) =>
              boost(status, `boost-${status.id}`)
            )
          : [child1, child2, child3]
      })

      expect(result.ancestorsById['parent-blocked']).toBeUndefined()
      expect(result.ancestorsById['parent-muted']).toBeUndefined()
      expect(result.ancestorsById['parent-allowed']).toBeDefined()
    }
  )

  it('indexes ancestorsById under id, url, uri, and publicId aliases', async () => {
    const parentWithAliases = createMockStatus({
      id: 'status-parent-id',
      url: 'https://example.com/parent-url',
      uri: 'https://example.com/parent-uri',
      publicId: 'parent-pub-id',
      text: 'Parent with aliases'
    } as unknown as Partial<Status> & { id: string })

    const child = createMockStatus({
      id: 'child-1',
      reply: 'status-parent-id'
    })

    const database = {
      getStatusesByIds: vi.fn(async () => [parentWithAliases])
    } as unknown as Database

    const result = await getTimelineContext({
      database,
      statuses: [child]
    })

    expect(result.ancestorsById['status-parent-id']).toBeDefined()
    expect(result.ancestorsById['https://example.com/parent-url']).toBeDefined()
    expect(result.ancestorsById['https://example.com/parent-uri']).toBeDefined()
    expect(result.ancestorsById['parent-pub-id']).toBeDefined()

    expect(result.ancestorsById['https://example.com/parent-url']).toBe(
      result.ancestorsById['status-parent-id']
    )
    expect(result.ancestorsById['parent-pub-id']).toBe(
      result.ancestorsById['status-parent-id']
    )
  })
})
