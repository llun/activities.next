import { aliasServedLocalActor } from '@/lib/services/actors/aliasServedLocalActor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { resolveStatusFromPath } from './resolveStatusFromPath'

vi.mock('@/lib/services/actors/aliasServedLocalActor', () => ({
  aliasServedLocalActor: vi.fn()
}))

describe('resolveStatusFromPath', () => {
  beforeEach(() => {
    // Default the alias fallback to a miss; individual tests opt into a hit.
    vi.mocked(aliasServedLocalActor).mockReset()
    vi.mocked(aliasServedLocalActor).mockResolvedValue(null)
  })

  const originalActorId = 'https://remote.example/users/original'
  const boosterActorId = 'https://boost.example/users/booster'
  const secondBoosterActorId = 'https://other.example/users/booster'
  const originalUrl = 'https://remote.example/@original/123'
  const statusHash = getHashFromString(originalUrl)

  const originalStatus = {
    id: 'https://remote.example/users/original/statuses/123',
    url: originalUrl,
    actorId: originalActorId,
    actor: {
      username: 'original',
      domain: 'remote.example'
    },
    type: StatusType.enum.Note,
    to: [],
    cc: [],
    edits: [],
    isLocalActor: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    text: 'Original status',
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    totalLikes: 0,
    attachments: [],
    tags: []
  } as Status

  const createAnnounce = (actorId = boosterActorId) =>
    ({
      id: `${actorId}/statuses/456/activity`,
      actorId,
      actor: {
        username: 'booster',
        domain: new URL(actorId).host
      },
      type: StatusType.enum.Announce,
      to: [],
      cc: [],
      edits: [],
      originalStatus,
      isLocalActor: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }) as Status

  const createDatabase = () => ({
    getActorFromUsername: vi.fn().mockResolvedValue({ id: originalActorId }),
    getStatusFromUrlHash: vi.fn().mockResolvedValue(null),
    getStatus: vi.fn().mockResolvedValue(null)
  })

  it('resolves a hash route from the scoped actor lookup', async () => {
    const database = createDatabase()
    database.getStatusFromUrlHash.mockResolvedValueOnce(originalStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: originalStatus,
      statusId: originalStatus.id
    })

    expect(database.getStatusFromUrlHash).toHaveBeenCalledTimes(1)
    expect(database.getStatusFromUrlHash).toHaveBeenCalledWith({
      urlHash: statusHash,
      actorId: originalActorId
    })
    expect(database.getStatus).not.toHaveBeenCalled()
  })

  it('resolves a boosted hash route to the original status when the path actor owns it', async () => {
    const database = createDatabase()
    const boostedStatus = createAnnounce()
    database.getStatusFromUrlHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(boostedStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: originalStatus,
      statusId: originalStatus.id
    })

    expect(database.getStatusFromUrlHash).toHaveBeenNthCalledWith(1, {
      urlHash: statusHash,
      actorId: originalActorId
    })
    expect(database.getStatusFromUrlHash).toHaveBeenNthCalledWith(2, {
      urlHash: statusHash
    })
    expect(database.getStatus).not.toHaveBeenCalled()
  })

  it('returns the original status when an unscoped hash lookup finds another boost of the same status', async () => {
    const database = createDatabase()
    const secondBoostedStatus = createAnnounce(secondBoosterActorId)
    database.getStatusFromUrlHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(secondBoostedStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: originalStatus,
      statusId: originalStatus.id
    })
  })

  it('does not resolve an unscoped hash when a note belongs to a different actor', async () => {
    const database = createDatabase()
    database.getStatusFromUrlHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...originalStatus,
        actorId: 'https://other.example/users/someone'
      })

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: null,
      statusId: ''
    })
  })

  it('does not resolve an unscoped hash when an announce original belongs to a different actor', async () => {
    const database = createDatabase()
    database.getStatusFromUrlHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...createAnnounce(),
        originalStatus: {
          ...originalStatus,
          actorId: 'https://other.example/users/someone'
        }
      })

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: statusHash
      })
    ).resolves.toEqual({
      fullStatusId: '',
      isStatusHash: true,
      status: null,
      statusId: ''
    })
  })

  it('returns null when the actor route is malformed', async () => {
    const database = createDatabase()

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: 'plain-username',
        statusParam: statusHash
      })
    ).resolves.toBeNull()

    expect(database.getActorFromUsername).not.toHaveBeenCalled()
    expect(database.getStatusFromUrlHash).not.toHaveBeenCalled()
    expect(database.getStatus).not.toHaveBeenCalled()
  })

  it('returns null when the actor route has malformed URI escapes', async () => {
    const database = createDatabase()

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '%E0%A4%A',
        statusParam: statusHash
      })
    ).resolves.toBeNull()

    expect(database.getActorFromUsername).not.toHaveBeenCalled()
    expect(database.getStatusFromUrlHash).not.toHaveBeenCalled()
    expect(database.getStatus).not.toHaveBeenCalled()
  })

  it('falls back from full status id to raw id for non-hash status params', async () => {
    const database = createDatabase()
    database.getStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(originalStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: '123'
      })
    ).resolves.toEqual({
      fullStatusId: 'https://remote.example/users/original/statuses/123',
      isStatusHash: false,
      status: originalStatus,
      statusId: originalStatus.id
    })

    expect(database.getStatusFromUrlHash).not.toHaveBeenCalled()
    expect(database.getStatus).toHaveBeenNthCalledWith(1, {
      statusId: 'https://remote.example/users/original/statuses/123',
      withReplies: false
    })
    expect(database.getStatus).toHaveBeenNthCalledWith(2, {
      statusId: '123',
      withReplies: false
    })
  })

  it('resolves full URL status params without raw id fallback', async () => {
    const database = createDatabase()
    database.getStatus.mockResolvedValueOnce(originalStatus)

    await expect(
      resolveStatusFromPath({
        database,
        actorParam: '@original@remote.example',
        statusParam: originalStatus.id
      })
    ).resolves.toEqual({
      fullStatusId: originalStatus.id,
      isStatusHash: false,
      status: originalStatus,
      statusId: originalStatus.id
    })

    expect(database.getStatusFromUrlHash).not.toHaveBeenCalled()
    expect(database.getStatus).toHaveBeenCalledTimes(1)
    expect(database.getStatus).toHaveBeenCalledWith({
      statusId: originalStatus.id,
      withReplies: false
    })
  })

  describe('trusted-host alias resolution', () => {
    const canonicalStatusId =
      'https://canonical.example/users/alice/statuses/123'
    const canonicalActorId = 'https://canonical.example/users/alice'
    // Shape mirrors the local actor row `aliasServedLocalActor` returns: a
    // canonical id/domain/username plus the privateKey that marks it local.
    const aliasCanonicalActor = {
      id: canonicalActorId,
      username: 'alice',
      domain: 'canonical.example',
      privateKey: 'private-key'
    } as unknown as Awaited<ReturnType<typeof aliasServedLocalActor>>

    it('rebuilds the canonical status id from the resolved actor domain, not the alias host', async () => {
      const database = createDatabase()
      database.getActorFromUsername.mockResolvedValue(null)
      vi.mocked(aliasServedLocalActor).mockResolvedValueOnce(
        aliasCanonicalActor
      )
      const canonicalStatus = {
        ...originalStatus,
        id: canonicalStatusId,
        actorId: canonicalActorId
      } as Status
      database.getStatus.mockResolvedValueOnce(canonicalStatus)

      await expect(
        resolveStatusFromPath({
          database,
          actorParam: '@alice@alias.example',
          statusParam: '123'
        })
      ).resolves.toEqual({
        fullStatusId: canonicalStatusId,
        isStatusHash: false,
        status: canonicalStatus,
        statusId: canonicalStatus.id
      })

      expect(aliasServedLocalActor).toHaveBeenCalledWith({
        database,
        username: 'alice',
        domain: 'alias.example'
      })
      expect(database.getStatus).toHaveBeenCalledWith({
        statusId: canonicalStatusId,
        withReplies: false
      })
    })

    it('scopes the hash lookup to the resolved canonical actor id', async () => {
      const database = createDatabase()
      database.getActorFromUsername.mockResolvedValue(null)
      vi.mocked(aliasServedLocalActor).mockResolvedValueOnce(
        aliasCanonicalActor
      )
      const canonicalStatus = {
        ...originalStatus,
        id: canonicalStatusId,
        actorId: canonicalActorId
      } as Status
      const hash = getHashFromString('https://canonical.example/@alice/123')
      database.getStatusFromUrlHash.mockResolvedValueOnce(canonicalStatus)

      const result = await resolveStatusFromPath({
        database,
        actorParam: '@alice@alias.example',
        statusParam: hash
      })

      expect(result?.status).toEqual(canonicalStatus)
      expect(database.getStatusFromUrlHash).toHaveBeenCalledWith({
        urlHash: hash,
        actorId: canonicalActorId
      })
    })

    it('does not consult the alias fallback when the path actor is a local match', async () => {
      const database = createDatabase()
      database.getActorFromUsername.mockResolvedValue({
        id: canonicalActorId,
        username: 'alice',
        domain: 'canonical.example',
        privateKey: 'private-key'
      })

      await resolveStatusFromPath({
        database,
        actorParam: '@alice@canonical.example',
        statusParam: '123'
      })

      expect(aliasServedLocalActor).not.toHaveBeenCalled()
    })

    it('falls back to the queried domain when neither the strict lookup nor the alias resolves an actor', async () => {
      const database = createDatabase()
      database.getActorFromUsername.mockResolvedValue(null)
      database.getStatus.mockResolvedValue(null)

      const result = await resolveStatusFromPath({
        database,
        actorParam: '@alice@alias.example',
        statusParam: '123'
      })

      expect(result?.fullStatusId).toBe(
        'https://alias.example/users/alice/statuses/123'
      )
    })
  })
})
