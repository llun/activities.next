import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

import { getFederatedStatusDeliveryInboxes } from './statusDelivery'

jest.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: jest.fn()
}))

const makeActor = (id: string, overrides: Partial<Actor> = {}): Actor => ({
  id,
  type: 'Person',
  username: id.split('/').pop() ?? 'user',
  domain: new URL(id).host,
  name: 'Test User',
  summary: '',
  followersUrl: `${id}/followers`,
  inboxUrl: `${id}/inbox`,
  sharedInboxUrl: `https://${new URL(id).host}/inbox`,
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 0,
  publicKey: 'public-key',
  updatedAt: 0,
  ...overrides
})

const makeStatus = (overrides: Partial<Status>): Status =>
  ({
    id: 'https://local.test/users/alice/statuses/1',
    actorId: 'https://local.test/users/alice',
    actor: null,
    type: 'Note',
    url: 'https://local.test/users/alice/statuses/1',
    text: 'hello',
    summary: null,
    to: [],
    cc: [],
    edits: [],
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    isLocalActor: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }) as Status

const makeDatabase = (overrides: Partial<Database>): Database =>
  ({
    getActorsFromIds: jest.fn().mockResolvedValue([]),
    getFollowersInbox: jest.fn().mockResolvedValue([]),
    getDomainBlocksForDomains: jest.fn().mockResolvedValue({}),
    getDomainAllowsForDomains: jest.fn().mockResolvedValue({}),
    ...overrides
  }) as Database

describe('getFederatedStatusDeliveryInboxes', () => {
  beforeEach(() => {
    jest.mocked(getActorPerson).mockResolvedValue(null)
  })

  it('delivers direct statuses only to explicit remote recipients', async () => {
    const currentActor = makeActor('https://local.test/users/alice', {
      privateKey: 'private-key'
    })
    const remoteActor = makeActor('https://remote.test/users/bob')
    const localRecipient = makeActor('https://local.test/users/carol', {
      privateKey: 'private-key'
    })
    const database = makeDatabase({
      getActorsFromIds: jest.fn(async ({ ids }) => {
        return ids
          .map((id) => {
            if (id === remoteActor.id) return remoteActor
            if (id === localRecipient.id) return localRecipient
            return null
          })
          .filter((actor): actor is Actor => actor !== null)
      })
    })

    const inboxes = await getFederatedStatusDeliveryInboxes({
      database,
      currentActor,
      status: makeStatus({
        to: [currentActor.id, remoteActor.id, localRecipient.id]
      })
    })

    expect(inboxes).toEqual([remoteActor.sharedInboxUrl])
    expect(database.getFollowersInbox).not.toHaveBeenCalled()
  })

  it('loads explicit recipient actors in one database query', async () => {
    const currentActor = makeActor('https://local.test/users/alice', {
      privateKey: 'private-key'
    })
    const actorIds = Array.from(
      { length: 10 },
      (_, index) => `https://remote-${index}.test/users/bob`
    )
    const database = makeDatabase({
      getActorsFromIds: jest.fn(async ({ ids }) => ids.map(makeActor))
    })

    await getFederatedStatusDeliveryInboxes({
      database,
      currentActor,
      status: makeStatus({ to: actorIds })
    })

    expect(database.getActorsFromIds).toHaveBeenCalledTimes(1)
    expect(database.getActorsFromIds).toHaveBeenCalledWith({ ids: actorIds })
    expect(getActorPerson).not.toHaveBeenCalled()
  })

  it('bounds explicit recipient remote profile lookups', async () => {
    const currentActor = makeActor('https://local.test/users/alice', {
      privateKey: 'private-key'
    })
    const actorIds = Array.from(
      { length: 10 },
      (_, index) => `https://remote-${index}.test/users/bob`
    )
    let activeLookups = 0
    let maxActiveLookups = 0
    const database = makeDatabase({
      getActorsFromIds: jest.fn().mockResolvedValue([])
    })
    jest.mocked(getActorPerson).mockImplementation(async ({ actorId }) => {
      activeLookups += 1
      maxActiveLookups = Math.max(maxActiveLookups, activeLookups)
      await new Promise((resolve) => setTimeout(resolve, 1))
      activeLookups -= 1
      return {
        id: actorId,
        type: 'Person',
        inbox: `${actorId}/inbox`,
        endpoints: {
          sharedInbox: `https://${new URL(actorId).host}/inbox`
        }
      }
    })

    await getFederatedStatusDeliveryInboxes({
      database,
      currentActor,
      status: makeStatus({ to: actorIds })
    })

    expect(maxActiveLookups).toBeLessThanOrEqual(8)
  })
})
