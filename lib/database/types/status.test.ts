import { FollowStatus } from '@/lib/models/follow'
import { StatusNote, StatusPoll, StatusType } from '@/lib/models/status'
import { TagType } from '@/lib/models/tag'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Timeline } from '@/lib/services/timelines/types'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { databaseBeforeAll, getTestDatabaseTable } from '../testUtils'
import { Database } from '../types'

describe('StatusDatabase', () => {
  const { actors, statuses } = DatabaseSeed
  const primaryActorId = actors.primary.id
  const replyAuthorId = actors.replyAuthor.id
  const pollAuthorId = actors.pollAuthor.id
  const extraActorId = actors.extra.id
  const emptyActorId = actors.empty.id
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    describe('getStatus', () => {
      it('returns status without replies by default', async () => {
        const status = await database.getStatus({
          statusId: statuses.primary.post
        })
        expect(status).toEqual({
          id: statuses.primary.post,
          actorId: primaryActorId,
          actor: {
            id: primaryActorId,
            username: actors.primary.username,
            domain: actors.primary.domain,
            followersUrl: `${primaryActorId}/followers`,
            inboxUrl: `${primaryActorId}/inbox`,
            sharedInboxUrl: `https://${actors.primary.domain}/inbox`,
            followingCount: 2,
            followersCount: 1,
            statusCount: 3,
            lastStatusAt: expect.toBeNumber(),
            createdAt: expect.toBeNumber(),
            manuallyApprovesFollowers: true
          },
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          edits: [],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: statuses.primary.post,
          text: 'This is Actor1 post',
          summary: '',
          reply: '',
          replies: [],
          actorAnnounceStatusId: null,
          isActorLiked: false,
          isLocalActor: true,
          totalLikes: 0,
          attachments: [],
          tags: []
        })
      })

      it('returns status with replies', async () => {
        const status = (await database.getStatus({
          statusId: statuses.primary.post,
          withReplies: true
        })) as StatusNote
        expect(status.replies).toHaveLength(2)
        expect(status).toMatchObject({
          id: statuses.primary.post,
          actorId: primaryActorId,
          actor: {
            id: primaryActorId,
            username: actors.primary.username,
            domain: actors.primary.domain,
            followersUrl: `${primaryActorId}/followers`,
            inboxUrl: `${primaryActorId}/inbox`,
            sharedInboxUrl: `https://${actors.primary.domain}/inbox`,
            followingCount: 2,
            followersCount: 1,
            createdAt: expect.toBeNumber()
          },
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          edits: [],
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: statuses.primary.post,
          text: 'This is Actor1 post',
          summary: '',
          reply: '',
          actorAnnounceStatusId: null,
          isActorLiked: false,
          isLocalActor: true,
          totalLikes: 0,
          attachments: [],
          tags: []
        })
      })

      it('returns status with attachments', async () => {
        const status = (await database.getStatus({
          statusId: statuses.primary.postWithAttachments
        })) as StatusNote
        expect(status.attachments).toHaveLength(2)
        expect(status.attachments).toMatchObject([
          {
            id: expect.toBeString(),
            actorId: primaryActorId,
            statusId: statuses.primary.postWithAttachments,
            type: 'Document',
            mediaType: 'image/png',
            url: 'https://via.placeholder.com/150',
            width: 150,
            height: 150,
            name: '',
            createdAt: expect.toBeNumber(),
            updatedAt: expect.toBeNumber()
          },
          {
            id: expect.toBeString(),
            actorId: primaryActorId,
            statusId: statuses.primary.postWithAttachments,
            type: 'Document',
            mediaType: 'image/png',
            url: 'https://via.placeholder.com/150',
            width: 150,
            height: 150,
            name: '',
            createdAt: expect.toBeNumber(),
            updatedAt: expect.toBeNumber()
          }
        ])
      })

      it('returns status with tags', async () => {
        const status = (await database.getStatus({
          statusId: statuses.replyAuthor.mentionReplyToPrimary
        })) as StatusNote
        expect(status.tags).toHaveLength(1)
        expect(status.tags).toMatchObject([
          {
            id: expect.toBeString(),
            statusId: statuses.replyAuthor.mentionReplyToPrimary,
            type: 'mention',
            name: '@test1',
            value: 'https://llun.test/@test1',
            createdAt: expect.toBeNumber(),
            updatedAt: expect.toBeNumber()
          }
        ])
      })

      it('returns announce status', async () => {
        const status = await database.getStatus({
          statusId: statuses.replyAuthor.announceOwn
        })
        expect(status).toMatchObject({
          id: statuses.replyAuthor.announceOwn,
          actorId: replyAuthorId,
          actor: {
            username: actors.replyAuthor.username,
            domain: actors.replyAuthor.domain
          },
          type: 'Announce',
          originalStatus: {
            id: statuses.replyAuthor.mentionReplyToPrimary,
            actorId: replyAuthorId,
            type: 'Note',
            text: expect.toBeString()
          }
        })
      })

      it('returns poll status', async () => {
        const status = await database.getStatus({
          statusId: statuses.poll.status
        })
        expect(status).toMatchObject({
          id: statuses.poll.status,
          actorId: pollAuthorId,
          type: 'Poll',
          url: statuses.poll.status,
          text: 'This is a poll',
          tags: [],
          choices: [
            {
              statusId: statuses.poll.status,
              title: 'Yes',
              totalVotes: 0
            },
            {
              statusId: statuses.poll.status,
              title: 'No',
              totalVotes: 0
            }
          ]
        })
      })
    })

    describe('getActorStatuses', () => {
      it('returns statuses for specific actor', async () => {
        const statuses = await database.getActorStatuses({
          actorId: primaryActorId
        })
        expect(statuses).toHaveLength(3)
        expect(statuses.map((item) => (item as StatusNote).text)).toEqual([
          'This is Actor1 post 3',
          'This is Actor1 post 2',
          'This is Actor1 post'
        ])
      })
    })

    describe('getActorStatusesCount', () => {
      it('returns total number of statuses for the specific actor', async () => {
        const count = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        expect(count).toBe(3)
      })
    })

    describe('getStatusReplies', () => {
      it('returns replies for specific status', async () => {
        const replies = await database.getStatusReplies({
          statusId: statuses.primary.post
        })
        expect(replies).toHaveLength(2)

        expect((replies[0] as StatusNote).text).toBe(
          'This is Actor2 reply to Actor1'
        )
        expect((replies[1] as StatusNote).text).toBe(
          '<p><span class="h-card"><a href="https://test.llun.dev/@test1@llun.test" target="_blank" class="u-url mention">@<span>test1</span></a></span> This is Actor1 post</p>'
        )
      })
    })

    describe('hasActorAnnouncedStatus', () => {
      it('returns true if actor has announced status', async () => {
        const result = await database.hasActorAnnouncedStatus({
          statusId: statuses.replyAuthor.mentionReplyToPrimary,
          actorId: replyAuthorId
        })
        expect(result).toBeTrue()
      })

      it('returns false if actor has not announced status', async () => {
        const result = await database.hasActorAnnouncedStatus({
          statusId: statuses.primary.post,
          actorId: primaryActorId
        })
        expect(result).toBeFalse()
      })
    })

    describe('getActorAnnounceStatus', () => {
      it('returns announce status for actor', async () => {
        const announce = await database.getActorAnnounceStatus({
          statusId: statuses.primary.postWithAttachments,
          actorId: replyAuthorId
        })
        expect(announce).toMatchObject({
          id: statuses.replyAuthor.announcePrimary,
          actorId: replyAuthorId,
          type: 'Announce'
        })
      })

      it('returns null when actor has not announced status', async () => {
        const announce = await database.getActorAnnounceStatus({
          statusId: statuses.primary.postWithAttachments,
          actorId: primaryActorId
        })
        expect(announce).toBeNull()
      })
    })

    describe('getStatusReblogsCount', () => {
      it('returns reblog count for announced status', async () => {
        const count = await database.getStatusReblogsCount({
          statusId: statuses.primary.postWithAttachments
        })
        expect(count).toBe(1)
      })

      it('returns zero when no reblogs exist', async () => {
        const count = await database.getStatusReblogsCount({
          statusId: statuses.primary.post
        })
        expect(count).toBe(0)
      })
    })

    describe('getFavouritedBy', () => {
      it('returns actors who favourited the status', async () => {
        const actors = await database.getFavouritedBy({
          statusId: statuses.primary.post
        })
        expect(actors).toHaveLength(0)
      })

      it('returns actors who favourited the status', async () => {
        const actors = await database.getFavouritedBy({
          statusId: statuses.poll.status
        })
        expect(actors).toHaveLength(1)
        expect(actors[0].id).toBe(replyAuthorId)
      })
    })

    describe('createNote', () => {
      it('creates a new note', async () => {
        const status = (await database.createNote({
          id: `${extraActorId}/statuses/new-post`,
          url: `${extraActorId}/statuses/new-post`,
          actorId: extraActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post'
        })) as StatusNote
        expect(status.text).toBe('This is a new post')
        expect(
          await database.getActorStatusesCount({ actorId: extraActorId })
        ).toBe(1)
      })

      it('creates a new note with attachments', async () => {
        await database.createNote({
          id: `${extraActorId}/statuses/new-post-2`,
          url: `${extraActorId}/statuses/new-post-2`,
          actorId: extraActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post with attachments'
        })
        await database.createAttachment({
          actorId: extraActorId,
          statusId: `${extraActorId}/statuses/new-post-2`,
          mediaType: 'image/png',
          url: 'https://via.placeholder.com/150',
          width: 150,
          height: 150
        })
        await database.createAttachment({
          actorId: extraActorId,
          statusId: `${extraActorId}/statuses/new-post-2`,
          mediaType: 'image/png',
          url: 'https://via.placeholder.com/150',
          width: 150,
          height: 150
        })
        const status = (await database.getStatus({
          statusId: `${extraActorId}/statuses/new-post-2`
        })) as StatusNote
        expect(status.text).toBe('This is a new post with attachments')
        expect(status.attachments).toHaveLength(2)
      })

      it('creates a new note with tags', async () => {
        await database.createNote({
          id: `${extraActorId}/statuses/new-post-3`,
          url: `${extraActorId}/statuses/new-post-3`,
          actorId: extraActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'This is a new post with tags'
        })
        const tag = await database.createTag({
          statusId: `${extraActorId}/statuses/new-post-3`,
          type: TagType.enum.mention,
          name: '@test1',
          value: 'https://llun.test/@test1'
        })
        const status = (await database.getStatus({
          statusId: `${extraActorId}/statuses/new-post-3`
        })) as StatusNote
        expect(status.text).toBe('This is a new post with tags')
        expect(status.tags).toHaveLength(1)
        expect(status.tags).toMatchObject([
          {
            id: tag.id,
            statusId: `${extraActorId}/statuses/new-post-3`,
            type: TagType.enum.mention,
            name: '@test1',
            value: 'https://llun.test/@test1',
            createdAt: tag.createdAt,
            updatedAt: tag.updatedAt
          }
        ])
      })
    })

    describe('updateNote', () => {
      it('updates note content and records edit history', async () => {
        const statusId = `${emptyActorId}/statuses/update-note`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original note'
        })

        const updated = await database.updateNote({
          statusId,
          text: 'Updated note',
          summary: 'Updated summary'
        })
        expect(updated).toMatchObject({
          id: statusId,
          text: 'Updated note',
          summary: 'Updated summary'
        })

        const fetched = (await database.getStatus({
          statusId
        })) as StatusNote
        expect(fetched.edits).toHaveLength(1)
        expect(fetched.edits[0]).toMatchObject({
          text: 'Original note',
          summary: '',
          createdAt: expect.toBeNumber()
        })
      })
    })

    describe('updatePoll', () => {
      it('updates poll content and choice totals', async () => {
        const pollId = `${emptyActorId}/statuses/poll-update`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Original poll',
          summary: 'Original summary',
          choices: ['Alpha', 'Beta'],
          endAt: Date.now() + 1000
        })

        const updated = await database.updatePoll({
          statusId: pollId,
          text: 'Updated poll',
          summary: 'Updated summary',
          choices: [
            { title: 'Alpha', totalVotes: 2 },
            { title: 'Beta', totalVotes: 1 }
          ]
        })

        expect(updated).toMatchObject({
          id: pollId,
          text: 'Updated poll',
          summary: 'Updated summary'
        })

        const fetched = (await database.getStatus({
          statusId: pollId
        })) as StatusPoll
        expect(fetched.edits).toHaveLength(1)
        expect(fetched.choices).toMatchObject([
          { title: 'Alpha', totalVotes: 2 },
          { title: 'Beta', totalVotes: 1 }
        ])
      })
    })

    describe('poll votes', () => {
      it('records votes and increments choice totals', async () => {
        const pollId = `${emptyActorId}/statuses/poll-votes`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: emptyActorId,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [],
          text: 'Vote poll',
          choices: ['Yes', 'No'],
          endAt: Date.now() + 1000
        })

        const voterId = replyAuthorId
        expect(
          await database.hasActorVoted({ statusId: pollId, actorId: voterId })
        ).toBeFalse()

        await database.createPollAnswer({
          statusId: pollId,
          actorId: voterId,
          choice: 0
        })
        await database.incrementPollChoiceVotes({
          statusId: pollId,
          choiceIndex: 0
        })

        expect(
          await database.hasActorVoted({ statusId: pollId, actorId: voterId })
        ).toBeTrue()
        expect(
          await database.getActorPollVotes({
            statusId: pollId,
            actorId: voterId
          })
        ).toEqual([0])

        const poll = (await database.getStatus({
          statusId: pollId,
          currentActorId: voterId
        })) as StatusPoll
        expect(poll.choices[0]).toMatchObject({ totalVotes: 1 })
        expect(poll).toMatchObject({
          voted: true,
          ownVotes: [0]
        })
      })
    })

    describe('createAnnounce', () => {
      const TEST_ID_ORIGINAL = `https://${TEST_DOMAIN}/users/announce-original`
      const TEST_ID_BOOSTER = `https://${TEST_DOMAIN}/users/announce-booster`
      const TEST_ID_FOLLOWER = `https://${TEST_DOMAIN}/users/announce-follower`

      beforeAll(async () => {
        await database.createAccount({
          email: `announce-original@${TEST_DOMAIN}`,
          username: 'announce-original',
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: 'privateKey-announce-original',
          publicKey: 'publicKey-announce-original'
        })
        await database.createAccount({
          email: `announce-booster@${TEST_DOMAIN}`,
          username: 'announce-booster',
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: 'privateKey-announce-booster',
          publicKey: 'publicKey-announce-booster'
        })
        await database.createAccount({
          email: `announce-follower@${TEST_DOMAIN}`,
          username: 'announce-follower',
          passwordHash: TEST_PASSWORD_HASH,
          domain: TEST_DOMAIN,
          privateKey: 'privateKey-announce-follower',
          publicKey: 'publicKey-announce-follower'
        })
      })

      it('returns status with actorAnnounceStatusId in timeline', async () => {
        await database.createFollow({
          actorId: TEST_ID_BOOSTER,
          targetActorId: TEST_ID_ORIGINAL,
          status: FollowStatus.enum.Accepted,
          inbox: `${TEST_ID_BOOSTER}/inbox`,
          sharedInbox: `${TEST_ID_BOOSTER}/inbox`
        })
        await database.createFollow({
          actorId: TEST_ID_FOLLOWER,
          targetActorId: TEST_ID_BOOSTER,
          status: FollowStatus.enum.Accepted,
          inbox: `${TEST_ID_FOLLOWER}/inbox`,
          sharedInbox: `${TEST_ID_FOLLOWER}/inbox`
        })

        const originalPostId = `${TEST_ID_ORIGINAL}/posts/boost-original`
        const note = await database.createNote({
          id: originalPostId,
          url: originalPostId,
          actorId: TEST_ID_ORIGINAL,
          text: 'This is status for boost',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${TEST_ID_ORIGINAL}/followers`]
        })
        await addStatusToTimelines(database, note)

        const announcePostId = `${TEST_ID_BOOSTER}/posts/boost-announce`
        const announce = await database.createAnnounce({
          id: announcePostId,
          actorId: TEST_ID_BOOSTER,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${TEST_ID_BOOSTER}/followers`],
          originalStatusId: originalPostId
        })
        if (!announce) {
          fail('Announce must not be undefined')
        }
        await addStatusToTimelines(database, announce)

        const boosterTimeline = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID_BOOSTER
        })
        const statusData = boosterTimeline.shift() as StatusNote
        expect(statusData.actorAnnounceStatusId).not.toBeNull()

        const followerTimeline = await database.getTimeline({
          timeline: Timeline.MAIN,
          actorId: TEST_ID_FOLLOWER
        })
        const announceStatus = followerTimeline.shift()
        if (announceStatus?.type !== StatusType.enum.Announce) {
          fail('Status must be announce')
        }

        const originalStatus = announceStatus.originalStatus
        expect(originalStatus.id).toEqual(note.id)
      })
    })

    describe('deleteStatus', () => {
      it('deletes a status', async () => {
        const beforeDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        await database.deleteStatus({
          statusId: statuses.primary.secondPost
        })
        const afterDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        expect(
          await database.getStatus({
            statusId: statuses.primary.secondPost
          })
        ).toBeNull()
        expect(afterDeleteCount).toBe(beforeDeleteCount - 1)
      })

      it('deletes a status and attachments', async () => {
        const beforeDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        await database.deleteStatus({
          statusId: statuses.primary.postWithAttachments
        })
        const afterDeleteCount = await database.getActorStatusesCount({
          actorId: primaryActorId
        })
        expect(
          await database.getStatus({
            statusId: statuses.primary.postWithAttachments
          })
        ).toBeNull()
        expect(
          await database.getAttachments({
            statusId: statuses.primary.postWithAttachments
          })
        ).toBeArrayOfSize(0)
        expect(afterDeleteCount).toBe(beforeDeleteCount - 1)
      })
    })
  })
})
