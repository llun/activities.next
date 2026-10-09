import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { logger } from '@/lib/utils/logger'

import { getMastodonStatus, getMastodonStatuses } from './getMastodonStatus'
import { useSeededStatusDatabase } from './getMastodonStatus.testUtils'

// prettier-ignore
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({ host: 'test.llun.dev' })
}))

describe('getMastodonStatus', () => {
  const { database, getActorPublicId } = useSeededStatusDatabase()

  describe('getMastodonStatuses resilience', () => {
    beforeEach(() => {
      vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    })

    it('skips a status whose lookup-id collection throws and keeps the good one', async () => {
      const goodStatus = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status

      // A reblog whose original was deleted leaves a null originalStatus, which
      // throws while the collector recurses into the original. It must be
      // skipped, not crash the whole page.
      const brokenReblog = {
        id: `${ACTOR1_ID}/statuses/broken-reblog`,
        actorId: ACTOR1_ID,
        type: StatusType.enum.Announce,
        originalStatus: null
      } as unknown as Status

      const result = await getMastodonStatuses(database, [
        brokenReblog,
        goodStatus
      ])

      expect(result).toHaveLength(1)
      expect(result[0].id).toEqual(goodStatus.publicId)
      expect(logger.warn).toHaveBeenCalled()
    })

    // The opposite of the two above: a status carrying an attachment this
    // instance cannot fully describe must still serialise. `audio/mp4` is an
    // accepted upload with no stored duration for Mastodon's `Audio` shape, and
    // while such an attachment came back as a bare `null` the closing
    // `Mastodon.Status.parse` rejected the whole entity — so one audio clip
    // dropped the post out of every timeline as "un-hydratable" while the web
    // UI still showed it.
    it('serializes a status carrying an attachment it cannot fully describe', async () => {
      const statusId = `${ACTOR1_ID}/statuses/post-with-audio-attachment`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Ride recording',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'audio/mp4',
        url: 'https://llun.test/api/v1/files/medias/recording.m4a',
        name: 'Ride audio'
      })
      const status = (await database.getStatus({ statusId })) as Status

      const result = await getMastodonStatuses(database, [status])

      expect(result).toHaveLength(1)
      expect(result[0].media_attachments).toHaveLength(1)
      expect(result[0].media_attachments[0]).toMatchObject({
        type: 'unknown',
        description: 'Ride audio'
      })
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('skips a status whose serialization throws and keeps the good one', async () => {
      const goodStatus = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status

      // A Note missing its tags/attachments arrays passes id collection but
      // throws inside getMastodonStatus when those arrays are read.
      const brokenNote = {
        id: `${ACTOR1_ID}/statuses/broken-note`,
        actorId: ACTOR1_ID,
        type: StatusType.enum.Note,
        reply: '',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      } as unknown as Status

      const result = await getMastodonStatuses(database, [
        goodStatus,
        brokenNote
      ])

      expect(result).toHaveLength(1)
      expect(result[0].id).toEqual(goodStatus.publicId)
      expect(logger.warn).toHaveBeenCalled()
    })
  })

  describe('getMastodonStatuses', () => {
    it('hydrates multiple statuses while reusing actor lookups', async () => {
      const firstStatus = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status
      const secondStatus = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-3`
      })) as Status
      const getMastodonActorsFromIds = vi.spyOn(
        database,
        'getMastodonActorsFromIds'
      )
      const getStatusReblogsCounts = vi.spyOn(
        database,
        'getStatusReblogsCounts'
      )
      const getStatusRepliesCounts = vi.spyOn(
        database,
        'getStatusRepliesCounts'
      )
      const getStatusReblogsCount = vi.spyOn(database, 'getStatusReblogsCount')
      const getStatusRepliesCount = vi.spyOn(database, 'getStatusRepliesCount')

      const mastodonStatuses = await getMastodonStatuses(database, [
        firstStatus,
        secondStatus
      ])

      expect(mastodonStatuses).toHaveLength(2)
      expect(mastodonStatuses.map((status) => status.id)).toEqual([
        firstStatus.publicId,
        secondStatus.publicId
      ])
      expect(getMastodonActorsFromIds).toHaveBeenCalledTimes(1)
      expect(getMastodonActorsFromIds).toHaveBeenCalledWith({
        ids: [ACTOR1_ID]
      })
      expect(getStatusReblogsCounts).toHaveBeenCalledWith({
        statusIds: [firstStatus.id, secondStatus.id]
      })
      expect(getStatusRepliesCounts).toHaveBeenCalledWith({
        statusIds: [firstStatus.id, secondStatus.id]
      })
      expect(getStatusReblogsCount).not.toHaveBeenCalled()
      expect(getStatusRepliesCount).not.toHaveBeenCalled()
    })

    it('preserves pinned status context while bulk hydrating', async () => {
      const firstStatus = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status
      const secondStatus = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-3`
      })) as Status

      const mastodonStatuses = await getMastodonStatuses(
        database,
        [firstStatus, secondStatus],
        ACTOR1_ID,
        { pinnedStatusIds: new Set([firstStatus.id]) }
      )

      expect(mastodonStatuses.map((status) => status.pinned)).toEqual([
        true,
        false
      ])
    })

    it('does not mark reblogs pinned from explicit pin context', async () => {
      const originalStatusId = `${ACTOR2_ID}/statuses/mastodon-pinned-reblog-original-${Date.now()}`
      const announceStatusId = `${ACTOR1_ID}/statuses/mastodon-pinned-reblog-${Date.now()}`
      await database.createNote({
        id: originalStatusId,
        url: originalStatusId,
        actorId: ACTOR2_ID,
        text: 'Original status for pinned reblog serialization',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const announceStatus = await database.createAnnounce({
        id: announceStatusId,
        actorId: ACTOR1_ID,
        originalStatusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(
        database,
        announceStatus!,
        ACTOR1_ID,
        { pinnedStatusIds: new Set([announceStatusId]) }
      )

      expect(mastodonStatus).not.toHaveProperty('pinned')
    })

    it('omits pinned context for statuses not authored by the requester', async () => {
      const statusId = `${ACTOR2_ID}/statuses/mastodon-cross-account-pin-${Date.now()}`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR2_ID,
        text: 'Cross-account pin serialization',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const status = (await database.getStatus({ statusId })) as Status

      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR1_ID,
        { pinnedStatusIds: new Set([statusId]) }
      )

      expect(mastodonStatus).not.toHaveProperty('pinned')
    })

    it('derives pinned status context from persisted pins while bulk hydrating', async () => {
      const suffix = `bulk-pinned-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const firstStatusId = `${ACTOR1_ID}/statuses/${suffix}-one`
      const secondStatusId = `${ACTOR1_ID}/statuses/${suffix}-two`
      await database.createNote({
        id: firstStatusId,
        url: firstStatusId,
        actorId: ACTOR1_ID,
        text: 'Bulk pinned one',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: secondStatusId,
        url: secondStatusId,
        actorId: ACTOR1_ID,
        text: 'Bulk pinned two',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.pinStatus({
        actorId: ACTOR1_ID,
        statusId: firstStatusId
      })
      const firstStatus = (await database.getStatus({
        statusId: firstStatusId
      })) as Status
      const secondStatus = (await database.getStatus({
        statusId: secondStatusId
      })) as Status
      const getPinnedStatusIds = vi.spyOn(database, 'getPinnedStatusIds')

      try {
        const mastodonStatuses = await getMastodonStatuses(
          database,
          [firstStatus, secondStatus],
          ACTOR1_ID
        )

        expect(mastodonStatuses.map((status) => status.pinned)).toEqual([
          true,
          false
        ])
        expect(getPinnedStatusIds).toHaveBeenCalledTimes(1)
        expect(getPinnedStatusIds).toHaveBeenCalledWith({
          actorId: ACTOR1_ID,
          statusIds: [firstStatusId, secondStatusId]
        })
      } finally {
        getPinnedStatusIds.mockRestore()
      }
    })

    it('hydrates poll vote state in bulk while serializing status lists', async () => {
      const firstPollId = `${ACTOR3_ID}/statuses/mastodon-bulk-poll-1`
      const secondPollId = `${ACTOR3_ID}/statuses/mastodon-bulk-poll-2`

      await database.createPoll({
        id: firstPollId,
        url: firstPollId,
        actorId: ACTOR3_ID,
        text: 'First bulk poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: Date.now() + 60_000
      })
      await database.createPoll({
        id: secondPollId,
        url: secondPollId,
        actorId: ACTOR3_ID,
        text: 'Second bulk poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Alpha', 'Beta'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: firstPollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })
      await database.recordPollVotes({
        statusId: secondPollId,
        actorId: ACTOR2_ID,
        choices: [1]
      })

      const firstPoll = (await database.getStatus({
        statusId: firstPollId
      })) as Status
      const secondPoll = (await database.getStatus({
        statusId: secondPollId
      })) as Status
      const getActorPollVotesForStatuses = vi.spyOn(
        database,
        'getActorPollVotesForStatuses'
      )
      const hasActorVoted = vi.spyOn(database, 'hasActorVoted')
      const getActorPollVotes = vi.spyOn(database, 'getActorPollVotes')

      try {
        const mastodonStatuses = await getMastodonStatuses(
          database,
          [firstPoll, secondPoll],
          ACTOR2_ID
        )

        expect(mastodonStatuses).toHaveLength(2)
        expect(getActorPollVotesForStatuses).toHaveBeenCalledTimes(1)
        expect(getActorPollVotesForStatuses).toHaveBeenCalledWith({
          statusIds: [firstPollId, secondPollId],
          actorId: ACTOR2_ID
        })
        expect(hasActorVoted).not.toHaveBeenCalled()
        expect(getActorPollVotes).not.toHaveBeenCalled()
        expect(mastodonStatuses.map((status) => status.poll?.voted)).toEqual([
          true,
          true
        ])
        expect(
          mastodonStatuses.map((status) => status.poll?.own_votes)
        ).toEqual([[0], [1]])
      } finally {
        getActorPollVotesForStatuses.mockRestore()
        hasActorVoted.mockRestore()
        getActorPollVotes.mockRestore()
      }
    })

    it('reports distinct voters_count for a multiple-choice poll', async () => {
      const pollId = `${ACTOR3_ID}/statuses/mastodon-anyof-voters-${Date.now()}`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR3_ID,
        text: 'Multiple choice poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['First', 'Second'],
        pollType: 'anyOf',
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR1_ID,
        choices: [0, 1],
        allowAdditionalChoices: true
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0],
        allowAdditionalChoices: true
      })

      const status = (await database.getStatus({ statusId: pollId })) as Status
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR3_ID
      )

      expect(mastodonStatus?.poll?.votes_count).toEqual(3)
      expect(mastodonStatus?.poll?.voters_count).toEqual(2)
    })

    it('reports voters_count equal to votes_count for a single-choice poll', async () => {
      const pollId = `${ACTOR3_ID}/statuses/mastodon-oneof-voters-${Date.now()}`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR3_ID,
        text: 'Single choice poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        pollType: 'oneOf',
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR1_ID,
        choices: [0]
      })

      const status = (await database.getStatus({ statusId: pollId })) as Status
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR3_ID
      )

      expect(mastodonStatus?.poll?.votes_count).toEqual(1)
      expect(mastodonStatus?.poll?.voters_count).toEqual(1)
    })

    it('hides per-option tallies for a running hide_totals poll', async () => {
      const pollId = `${ACTOR3_ID}/statuses/mastodon-hide-totals-running-${Date.now()}`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR3_ID,
        text: 'Hidden totals poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['First', 'Second'],
        pollType: 'oneOf',
        endAt: Date.now() + 60_000,
        hideTotals: true
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR1_ID,
        choices: [0]
      })

      const status = (await database.getStatus({ statusId: pollId })) as Status
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR3_ID
      )

      expect(mastodonStatus?.poll?.options).toEqual([
        { title: 'First', votes_count: null },
        { title: 'Second', votes_count: null }
      ])
      // Mastodon's PollSerializer keeps the top-level counts numeric even while
      // per-option tallies are hidden.
      expect(mastodonStatus?.poll?.votes_count).toEqual(1)
      expect(mastodonStatus?.poll?.voters_count).toEqual(1)
    })

    it('reveals per-option tallies for a hide_totals poll after expiry', async () => {
      const pollId = `${ACTOR3_ID}/statuses/mastodon-hide-totals-expired-${Date.now()}`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR3_ID,
        text: 'Expired hidden totals poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['First', 'Second'],
        pollType: 'oneOf',
        endAt: Date.now() - 60_000,
        hideTotals: true
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR1_ID,
        choices: [0]
      })

      const status = (await database.getStatus({ statusId: pollId })) as Status
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR3_ID
      )

      expect(mastodonStatus?.poll?.expired).toBe(true)
      expect(mastodonStatus?.poll?.options).toEqual([
        { title: 'First', votes_count: 1 },
        { title: 'Second', votes_count: 0 }
      ])
    })

    it('keys hydrated account cache by actor id when account url is a profile url', async () => {
      const status = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status
      const account = await database.getMastodonActorFromId({ id: ACTOR1_ID })
      if (!account) {
        throw new Error('Expected seed actor account')
      }
      const getMastodonActorsFromIds = vi
        .spyOn(database, 'getMastodonActorsFromIds')
        .mockResolvedValueOnce([
          {
            ...account,
            url: 'https://llun.test/@test1'
          }
        ])
      const getMastodonActorFromId = vi.spyOn(
        database,
        'getMastodonActorFromId'
      )

      try {
        const mastodonStatuses = await getMastodonStatuses(database, [status])

        expect(mastodonStatuses).toHaveLength(1)
        expect(mastodonStatuses[0].account.url).toBe('https://llun.test/@test1')
        expect(getMastodonActorsFromIds).toHaveBeenCalledWith({
          ids: [ACTOR1_ID]
        })
        expect(getMastodonActorFromId).not.toHaveBeenCalled()
      } finally {
        getMastodonActorsFromIds.mockRestore()
        getMastodonActorFromId.mockRestore()
      }
    })

    it('hydrates reply parents in bulk while serializing status lists', async () => {
      const parentId = `${ACTOR1_ID}/statuses/post-1`
      const parent = (await database.getStatus({
        statusId: parentId
      })) as Status
      const parentActorPublicId = await getActorPublicId(ACTOR1_ID)
      const replyOne = (await database.getStatus({
        statusId: `${ACTOR2_ID}/statuses/post-2`
      })) as Status
      const replyTwo = (await database.getStatus({
        statusId: `${ACTOR2_ID}/statuses/reply-1`
      })) as Status
      const getStatusesByIds = vi.spyOn(database, 'getStatusesByIds')
      const getStatus = vi.spyOn(database, 'getStatus')

      try {
        const mastodonStatuses = await getMastodonStatuses(
          database,
          [replyOne, replyTwo],
          ACTOR1_ID
        )

        expect(mastodonStatuses).toHaveLength(2)
        expect(mastodonStatuses.map((status) => status.in_reply_to_id)).toEqual(
          [parent.publicId, parent.publicId]
        )
        expect(
          mastodonStatuses.map((status) => status.in_reply_to_account_id)
        ).toEqual([parentActorPublicId, parentActorPublicId])
        expect(getStatusesByIds).toHaveBeenCalledWith({
          statusIds: [parentId],
          currentActorId: ACTOR1_ID
        })
        expect(getStatus).not.toHaveBeenCalled()
      } finally {
        getStatusesByIds.mockRestore()
        getStatus.mockRestore()
      }
    })

    it('does not map unmatched bulk accounts by result index', async () => {
      const status = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status
      const getMastodonActorsFromIds = vi
        .spyOn(database, 'getMastodonActorsFromIds')
        .mockResolvedValueOnce([
          {
            id: 'remote.test:users:unrelated',
            url: 'https://remote.test/users/unrelated'
          }
        ] as Awaited<ReturnType<typeof database.getMastodonActorsFromIds>>)

      try {
        await expect(getMastodonStatuses(database, [status])).resolves.toEqual(
          []
        )
        expect(getMastodonActorsFromIds).toHaveBeenCalledWith({
          ids: [ACTOR1_ID]
        })
      } finally {
        getMastodonActorsFromIds.mockRestore()
      }
    })
  })

  describe('emoji reactions', () => {
    const reactedStatusId = `${ACTOR1_ID}/statuses/post-2`
    // Rollups are ordered by first-reaction time, stored with millisecond
    // resolution — space the writes so the expected order is deterministic.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

    beforeAll(async () => {
      await database.createStatusReaction({
        statusId: reactedStatusId,
        actorId: ACTOR2_ID,
        name: '\u{1F525}'
      })
      await tick()
      await database.createStatusReaction({
        statusId: reactedStatusId,
        actorId: ACTOR3_ID,
        name: '\u{1F525}'
      })
      await tick()
      await database.createStatusReaction({
        statusId: reactedStatusId,
        actorId: ACTOR3_ID,
        name: 'partyparrot@remote.test',
        url: 'https://remote.test/emoji/partyparrot.png'
      })
    })

    it('serializes the rollups under both dialect names', async () => {
      const status = (await database.getStatus({
        statusId: reactedStatusId
      })) as Status
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR2_ID
      )

      const expected = [
        {
          name: '\u{1F525}',
          count: 2,
          me: true,
          url: null,
          static_url: null
        },
        {
          name: 'partyparrot@remote.test',
          count: 1,
          me: false,
          url: 'https://remote.test/emoji/partyparrot.png',
          static_url: 'https://remote.test/emoji/partyparrot.png'
        }
      ]
      expect(mastodonStatus?.reactions).toEqual(expected)
      // The two dialects come from one rollup, so they can never disagree.
      expect(mastodonStatus?.pleroma?.emoji_reactions).toEqual(
        mastodonStatus?.reactions
      )
    })

    it('never lets a reaction move the favourite counters', async () => {
      const status = (await database.getStatus({
        statusId: reactedStatusId,
        currentActorId: ACTOR2_ID
      })) as Status
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR2_ID
      )

      expect(mastodonStatus?.favourites_count).toBe(0)
      expect(mastodonStatus?.favourited).toBeFalse()
    })

    it('reports me false for a viewer who has not reacted', async () => {
      const status = (await database.getStatus({
        statusId: reactedStatusId
      })) as Status
      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR1_ID
      )

      expect(
        mastodonStatus?.reactions?.every((reaction) => reaction.me === false)
      ).toBeTrue()
    })

    it('serializes empty arrays for a status without reactions', async () => {
      const status = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status
      const mastodonStatus = await getMastodonStatus(database, status)

      expect(mastodonStatus?.reactions).toEqual([])
      expect(mastodonStatus?.pleroma?.emoji_reactions).toEqual([])
    })

    it('resolves the whole page with one grouped rollup query', async () => {
      const firstStatus = (await database.getStatus({
        statusId: reactedStatusId
      })) as Status
      const secondStatus = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as Status
      const getStatusReactionRollups = vi.spyOn(
        database,
        'getStatusReactionRollups'
      )

      const mastodonStatuses = await getMastodonStatuses(
        database,
        [firstStatus, secondStatus],
        ACTOR2_ID
      )

      expect(getStatusReactionRollups).toHaveBeenCalledTimes(1)
      expect(getStatusReactionRollups).toHaveBeenCalledWith({
        statusIds: [firstStatus.id, secondStatus.id],
        currentActorId: ACTOR2_ID
      })
      expect(mastodonStatuses[0].reactions).toHaveLength(2)
      expect(mastodonStatuses[1].reactions).toEqual([])
    })

    it('surfaces a boosted status reactions on the reblog, not the wrapper', async () => {
      // announce-1 boosts ACTOR1's post-3, so the reaction has to land there for
      // the assertion below to distinguish wrapper from reblog.
      await database.createStatusReaction({
        statusId: `${ACTOR1_ID}/statuses/post-3`,
        actorId: ACTOR2_ID,
        name: '\u{1F44F}'
      })
      const announceStatus = (await database.getStatus({
        statusId: `${ACTOR2_ID}/statuses/announce-1`
      })) as Status
      const mastodonStatus = await getMastodonStatus(database, announceStatus)

      expect(mastodonStatus?.reactions).toEqual([])
      expect(mastodonStatus?.pleroma?.emoji_reactions).toEqual([])
      expect(mastodonStatus?.reblog?.reactions).toEqual([
        {
          name: '\u{1F44F}',
          count: 1,
          me: false,
          url: null,
          static_url: null
        }
      ])
      expect(mastodonStatus?.reblog?.pleroma?.emoji_reactions).toEqual(
        mastodonStatus?.reblog?.reactions
      )
    })
  })
})
