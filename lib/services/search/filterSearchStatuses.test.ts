import type { Database } from '@/lib/database/types'
import { filterSearchStatuses } from '@/lib/services/search/filterSearchStatuses'
import type { Status } from '@/lib/types/domain/status'

const VIEWER = 'https://local.test/users/viewer'

const status = (
  id: string,
  actorId: string,
  extra: Partial<{
    domain: string
    isActorLiked: boolean
    isActorBookmarked: boolean
  }> = {}
) =>
  ({
    id,
    type: 'Note',
    actorId,
    actor: { domain: extra.domain ?? new URL(actorId).host },
    isActorLiked: extra.isActorLiked ?? false,
    isActorBookmarked: extra.isActorBookmarked ?? false
  }) as unknown as Status

const database = ({
  userBlocks = [] as string[],
  rules = {} as Record<string, { severity: string } | null>
}) =>
  ({
    getActorDomainBlocks: vi.fn(async () =>
      userBlocks.map((domain) => ({ domain }))
    ),
    getDomainBlocksForDomains: vi.fn(async () => rules)
  }) as unknown as Database

const ids = (statuses: Status[]) => statuses.map((item) => item.id)

describe('filterSearchStatuses', () => {
  it('drops every result from a domain the viewer blocks, by host or handle domain', async () => {
    const result = await filterSearchStatuses({
      database: database({ userBlocks: ['blocked.test'] }),
      viewerId: VIEWER,
      statuses: [
        status('a', 'https://blocked.test/users/a', { isActorLiked: true }),
        status('b', 'https://ap.other.test/users/b', {
          domain: 'blocked.test'
        }),
        status('c', 'https://fine.test/users/c')
      ]
    })
    expect(ids(result)).toEqual(['c'])
  })

  it('drops a public-only result from an instance-suspended or silenced domain, with wildcard and port matching', async () => {
    const result = await filterSearchStatuses({
      database: database({
        rules: {
          'suspended.test': { severity: 'suspend' },
          'node.silenced.test': { severity: 'silence' },
          'noop.test': { severity: 'noop' }
        }
      }),
      viewerId: VIEWER,
      statuses: [
        status('suspended', 'https://suspended.test:8443/users/s'),
        status('silenced', 'https://node.silenced.test/users/s'),
        status('noop', 'https://noop.test/users/n'),
        status('liked', 'https://suspended.test:8443/users/l', {
          isActorLiked: true
        }),
        status('own', VIEWER)
      ]
    })
    expect(ids(result)).toEqual(['noop', 'liked', 'own'])
  })

  it('looks up rules only for results outside the library', async () => {
    const db = database({})
    await filterSearchStatuses({
      database: db,
      viewerId: VIEWER,
      statuses: [status('own', VIEWER)]
    })
    expect(db.getDomainBlocksForDomains).not.toHaveBeenCalled()
  })

  it('keeps a post from a silenced domain that mentions the viewer', async () => {
    const mention = {
      ...status('mention', 'https://silenced.test/users/m'),
      tags: [{ type: 'mention', value: VIEWER, name: '@viewer' }]
    } as unknown as Status
    const result = await filterSearchStatuses({
      database: database({
        rules: { 'silenced.test': { severity: 'silence' } }
      }),
      viewerId: VIEWER,
      statuses: [mention, status('other', 'https://silenced.test/users/o')]
    })
    expect(ids(result)).toEqual(['mention'])
  })

  it('counts a mention by profile URL or handle as library, but not a bare @username', async () => {
    const withMention = (id: string, tag: { value?: string; name: string }) =>
      ({
        ...status(id, `https://silenced.test/users/${id}`),
        tags: [{ type: 'mention', ...tag }]
      }) as unknown as Status
    const result = await filterSearchStatuses({
      database: database({
        rules: { 'silenced.test': { severity: 'silence' } }
      }),
      viewerId: VIEWER,
      viewerUsername: 'viewer',
      viewerDomain: 'local.test',
      statuses: [
        withMention('profile', {
          value: 'https://local.test/@viewer',
          name: '@viewer'
        }),
        withMention('handle', { name: '@viewer@local.test' }),
        withMention('bare', {
          value: 'https://silenced.test/users/viewer',
          name: '@viewer'
        })
      ]
    })
    expect(ids(result)).toEqual(['profile', 'handle'])
  })
})
