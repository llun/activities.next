import {
  actors,
  emptyActorId,
  extraActorId,
  pollAuthorId,
  primaryActorId,
  replyAuthorId,
  statuses
} from '@/lib/database/sql/statusTestHelpers'
import { SQLITE_MAX_BINDINGS } from '@/lib/database/sql/utils/knex'
import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { STUCK_PROCESSING_THRESHOLD_MS } from '@/lib/services/fitness-files/processingState'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  StatusAnnounce,
  StatusNote,
  StatusType
} from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import {
  generatePublicId,
  getPublicIdTimestamp,
  isPublicId
} from '@/lib/utils/publicId'

describe('StatusDatabase', () => {
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
          publicId: expect.toBeString(),
          actorId: primaryActorId,
          actor: {
            id: primaryActorId,
            publicId: expect.toBeString(),
            username: actors.primary.username,
            domain: actors.primary.domain,
            type: 'Person',
            followersUrl: `${primaryActorId}/followers`,
            inboxUrl: `${primaryActorId}/inbox`,
            sharedInboxUrl: `https://${actors.primary.domain}/inbox`,
            followingCount: 2,
            followersCount: 1,
            statusCount: 3,
            // Stripped from the author a status embeds; see
            // getStatusActorProfile in status.ts.
            lastStatusAt: null,
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
          sensitive: false,
          language: null,
          detectedLanguage: null,
          applicationName: null,
          applicationWebsite: null,
          reply: '',
          replies: [],
          actorAnnounceStatusId: null,
          isActorLiked: false,
          isActorBookmarked: false,
          isLocalActor: true,
          totalLikes: 0,
          totalShares: 0,
          reactions: [],
          attachments: [],
          tags: []
        })
      })

      describe('emoji reaction hydration', () => {
        const reactedStatusId = statuses.primary.post

        afterEach(async () => {
          await database.deleteStatusReaction({
            statusId: reactedStatusId,
            actorId: extraActorId,
            name: '🔥'
          })
          await database.deleteStatusReaction({
            statusId: reactedStatusId,
            actorId: replyAuthorId,
            name: '🔥'
          })
        })

        it('hydrates rollups onto a single status with the viewer own flag', async () => {
          await database.createStatusReaction({
            statusId: reactedStatusId,
            actorId: extraActorId,
            name: '🔥'
          })
          await database.createStatusReaction({
            statusId: reactedStatusId,
            actorId: replyAuthorId,
            name: '🔥'
          })

          const status = (await database.getStatus({
            statusId: reactedStatusId,
            withReplies: false,
            currentActorId: extraActorId
          })) as StatusNote

          expect(status.reactions).toEqual([
            { name: '🔥', count: 2, me: true, url: null, static_url: null }
          ])
        })

        it('hydrates rollups for every status a list returns', async () => {
          await database.createStatusReaction({
            statusId: reactedStatusId,
            actorId: extraActorId,
            name: '🔥'
          })

          // getActorStatuses batches its rollups, so the reacted status carries
          // them and every other status in the page resolves to an empty array
          // from the same batch rather than a per-status query.
          const actorStatuses = await database.getActorStatuses({
            actorId: primaryActorId,
            // The hydration viewer, deliberately NOT `visibleToActorId` — that
            // one is the visibility filter and passing a viewer there would
            // change which statuses come back.
            currentActorId: extraActorId
          })
          const reacted = actorStatuses.find(
            (status) => status.id === reactedStatusId
          ) as StatusNote

          expect(reacted.reactions).toEqual([
            { name: '🔥', count: 1, me: true, url: null, static_url: null }
          ])
          // Every other status in the page resolves to an empty array from the
          // same batch. `toEqual([])` rather than `toBeDefined()`: the per-status
          // fallback would also leave these defined, so only the exact value
          // distinguishes a seeded batch from a fallback query.
          for (const status of actorStatuses) {
            if (status.id === reactedStatusId) continue
            if (status.type === StatusType.enum.Announce) continue
            expect(status.reactions).toEqual([])
          }
        })

        it('resolves the viewer own boost from the batch on a list path', async () => {
          // actorAnnounceStatusId is the boost button's state. It used to be
          // looked up per status (fully hydrating an Announce just to read its
          // id); it now comes from the same batch as likes and bookmarks, so
          // the list path must still report it correctly.
          const announceId = await database.createAnnounce({
            id: `${extraActorId}/statuses/announce-batch-test`,
            actorId: extraActorId,
            cc: [],
            to: [ACTIVITY_STREAM_PUBLIC],
            originalStatusId: reactedStatusId
          })

          try {
            const actorStatuses = await database.getActorStatuses({
              actorId: primaryActorId,
              currentActorId: extraActorId
            })
            const boosted = actorStatuses.find(
              (status) => status.id === reactedStatusId
            ) as StatusNote

            expect(boosted.actorAnnounceStatusId).toEqual(announceId?.id)
          } finally {
            await database.deleteStatus({
              statusId: `${extraActorId}/statuses/announce-batch-test`
            })
          }
        })

        it('hydrates rollups for the replies under a status', async () => {
          const replies = await database.getStatusReplies({
            statusId: statuses.primary.post,
            currentActorId: extraActorId
          })
          expect(replies.length).toBeGreaterThan(0)

          const target = replies[0]
          await database.createStatusReaction({
            statusId: target.id,
            actorId: extraActorId,
            name: '🎯'
          })

          try {
            const hydrated = await database.getStatusReplies({
              statusId: statuses.primary.post,
              currentActorId: extraActorId
            })
            const reacted = hydrated.find(
              (reply) => reply.id === target.id
            ) as StatusNote

            expect(reacted.reactions).toEqual([
              { name: '🎯', count: 1, me: true, url: null, static_url: null }
            ])
          } finally {
            await database.deleteStatusReaction({
              statusId: target.id,
              actorId: extraActorId,
              name: '🎯'
            })
          }
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

      it('returns status with linked fitness file metadata', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-status`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'This post has a linked fitness file'
        })

        const fitnessFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-status.fit`,
          fileName: 'status.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096,
          sourceUrl: 'https://www.strava.com/activities/123'
        })

        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness).toMatchObject({
          id: fitnessFile?.id,
          fileName: 'status.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096,
          url: `/api/v1/fitness-files/${fitnessFile?.id}`,
          sourceUrl: 'https://www.strava.com/activities/123',
          processingStuck: false,
          gearId: null,
          gearName: null
        })
      })

      it('returns summary metrics and elevation series on status.fitness', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-summary-status`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Post with fitness summary metrics'
        })

        const fitnessFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-summary.fit`,
          fileName: 'summary.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096
        })

        await database.updateFitnessFileActivityData(fitnessFile!.id, {
          avgPower: 220,
          maxPower: 650,
          avgHeartRate: 148,
          maxHeartRate: 177,
          totalWorkKj: 520,
          elevationSeries: [100, 110, 120]
        })

        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness).toMatchObject({
          avgPower: 220,
          maxPower: 650,
          avgHeartRate: 148,
          maxHeartRate: 177,
          totalWorkKj: 520,
          elevationSeries: [100, 110, 120]
        })
      })

      it('returns the recorded activity start time on the fitness file', async () => {
        // The post's own createdAt is not a stand-in for it: a Strava webhook
        // import is stamped when it published, not when the ride began, so
        // every surface reading the activity's date needs the recorded value.
        const statusId = `${emptyActorId}/statuses/fitness-activity-start`
        const activityStartTime = new Date('2026-05-27T05:12:00.000Z')

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'This post was published hours after the ride started'
        })

        const fitnessFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-activity-start.fit`,
          fileName: 'activity-start.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096
        })
        await database.updateFitnessFileActivityData(fitnessFile!.id, {
          activityStartTime
        })

        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness?.activityStartTime).toBe(
          activityStartTime.getTime()
        )
      })

      it('returns the assigned gear name alongside the fitness file', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-gear`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'This ride has gear'
        })

        const fitnessFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-gear.fit`,
          fileName: 'gear.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096
        })
        const gear = await database.createFitnessGear({
          actorId: emptyActorId,
          kind: 'bike',
          name: 'Moots'
        })
        await database.setFitnessFileGear({
          fitnessFileId: fitnessFile!.id,
          actorId: emptyActorId,
          gearId: gear.id
        })

        // The name arrives on the same query as the file — a second lookup per
        // status is an N+1 across a timeline page.
        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness).toMatchObject({
          id: fitnessFile?.id,
          gearId: gear.id,
          gearName: 'Moots'
        })
      })

      it('returns the recording device alongside the assigned gear', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-device-gear`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'This ride has a bike and a head unit'
        })

        const fitnessFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-device-gear.fit`,
          fileName: 'device-gear.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096
        })
        const bike = await database.createFitnessGear({
          actorId: emptyActorId,
          kind: 'bike',
          name: 'Moots Routt'
        })
        const device = await database.createFitnessGear({
          actorId: emptyActorId,
          kind: 'device',
          name: 'the Edge',
          deviceKey: 'name:garmin edge 840'
        })
        await database.setFitnessFileGear({
          fitnessFileId: fitnessFile!.id,
          actorId: emptyActorId,
          gearId: bike.id
        })
        await database.updateFitnessFileActivityData(fitnessFile!.id, {
          deviceGearId: device.id
        })

        // Two rows of the same table on one status, so the device needs an
        // aliased join of its own — both names still arrive on one query.
        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness).toMatchObject({
          gearId: bike.id,
          gearName: 'Moots Routt',
          deviceGearId: device.id,
          // The owner's rename, not the recorded device name.
          deviceGearName: 'the Edge'
        })
      })

      it('withholds a soft-deleted device name without dropping the activity', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-device-deleted`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Recorded on a device that has since been removed'
        })

        const fitnessFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-device-deleted.fit`,
          fileName: 'device-deleted.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096
        })
        const device = await database.createFitnessGear({
          actorId: emptyActorId,
          kind: 'device',
          name: 'Removed device',
          deviceKey: 'name:removed device'
        })
        await database.updateFitnessFileActivityData(fitnessFile!.id, {
          deviceGearId: device.id
        })
        // Deleting detaches the column, so re-point it to prove the JOIN's own
        // `deletedAt` guard is what withholds the name.
        await database.deleteFitnessGear({
          id: device.id,
          actorId: emptyActorId
        })
        await database.updateFitnessFileActivityData(fitnessFile!.id, {
          deviceGearId: device.id
        })

        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness).toMatchObject({
          id: fitnessFile?.id,
          deviceGearId: device.id,
          deviceGearName: null
        })
      })

      it('reports a recorded map failure as a kind, never as the reason', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-map-failed`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'This activity has no route map'
        })

        const fitnessFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-map-failed.fit`,
          fileName: 'map-failed.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096
        })
        await database.updateFitnessFileActivityData(fitnessFile!.id, {
          mapError: 's3.internal.example: connection refused'
        })
        await database.updateFitnessFileProcessingStatus(
          fitnessFile!.id,
          'completed'
        )

        const status = (await database.getStatus({ statusId })) as StatusNote
        // This payload is served to every viewer of the status, so it carries
        // the fact and never the reason — a raw error string can name internal
        // infrastructure. The owner reads the reason on their own files page.
        expect(status.fitness?.mapFailure).toBe('missing')
        expect(JSON.stringify(status.fitness)).not.toContain('s3.internal')
        // The activity itself is fine and must stay usable everywhere.
        expect(status.fitness?.processingStatus).toBe('completed')
      })

      it('distinguishes a stale map from a missing one', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-map-stale`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'This activity still shows its previous route map'
        })

        const fitnessFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-map-stale.fit`,
          fileName: 'map-stale.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096
        })
        await database.updateFitnessFileActivityData(fitnessFile!.id, {
          hasMapData: true,
          mapImagePath: 'medias/old-route-map.webp',
          mapError: 'tile server down'
        })

        // A failed regeneration keeps the map it could not replace, so the copy
        // the post picks must not claim the activity has none.
        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness?.mapFailure).toBe('stale')
      })

      it('leaves mapFailure unset for an activity whose map is fine', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-map-ok`

        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'This activity has a route map'
        })

        await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: `fitness/${Date.now()}-map-ok.fit`,
          fileName: 'map-ok.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 4096
        })

        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness?.mapFailure).toBeUndefined()
      })

      it('serializes movingTimeSeconds when present and omits it otherwise', async () => {
        const withStatusId = `${emptyActorId}/statuses/fitness-moving`
        await database.createNote({
          id: withStatusId,
          url: withStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'ride with moving time'
        })
        const withFile = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId: withStatusId,
          path: `fitness/${Date.now()}-moving.tcx`,
          fileName: 'moving.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 2048
        })
        await database.updateFitnessFileActivityData(withFile!.id, {
          totalDistanceMeters: 31_333.8,
          totalDurationSeconds: 4_614,
          movingTimeSeconds: 4_374,
          activityType: 'Ride'
        })

        const withStatus = (await database.getStatus({
          statusId: withStatusId
        })) as StatusNote
        expect(withStatus.fitness?.movingTimeSeconds).toBe(4_374)
        expect(withStatus.fitness?.totalDurationSeconds).toBe(4_614)

        // A file with no parsed activity data omits the field entirely (the
        // serializer uses a conditional spread), so callers fall back to
        // elapsed time.
        const withoutStatusId = `${emptyActorId}/statuses/fitness-no-moving`
        await database.createNote({
          id: withoutStatusId,
          url: withoutStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'ride without moving time'
        })
        await database.createFitnessFile({
          actorId: emptyActorId,
          statusId: withoutStatusId,
          path: `fitness/${Date.now()}-nomoving.tcx`,
          fileName: 'nomoving.tcx',
          fileType: 'tcx',
          mimeType: 'application/vnd.garmin.tcx+xml',
          bytes: 2048
        })

        const withoutStatus = (await database.getStatus({
          statusId: withoutStatusId
        })) as StatusNote
        expect(withoutStatus.fitness).toBeDefined()
        expect(
          withoutStatus.fitness && 'movingTimeSeconds' in withoutStatus.fitness
        ).toBe(false)
      })

      it('flags a fitness file stranded in processing as processingStuck', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          vi.setSystemTime(new Date('2031-01-01T00:00:00.000Z'))
          const statusId = `${emptyActorId}/statuses/fitness-stuck`

          await database.createNote({
            id: statusId,
            url: statusId,
            actorId: emptyActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'This post is stuck processing'
          })

          const fitnessFile = await database.createFitnessFile({
            actorId: emptyActorId,
            statusId,
            path: `fitness/${Date.now()}-stuck.fit`,
            fileName: 'stuck.fit',
            fileType: 'fit',
            mimeType: 'application/octet-stream',
            bytes: 4096
          })
          await database.updateFitnessFileProcessingStatus(
            fitnessFile!.id,
            'processing'
          )

          // Jump past the stuck threshold without finishing the job.
          vi.setSystemTime(
            new Date(Date.now() + STUCK_PROCESSING_THRESHOLD_MS + 60_000)
          )

          const status = (await database.getStatus({ statusId })) as StatusNote
          expect(status.fitness?.processingStatus).toBe('processing')
          expect(status.fitness?.processingStuck).toBe(true)
        } finally {
          vi.useRealTimers()
        }
      })

      it('serializes the primary fitness file when a status has several', async () => {
        const statusId = `${emptyActorId}/statuses/fitness-multi`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Same ride recorded on two devices'
        })

        // Insert the secondary file first so an unordered .first() would
        // wrongly surface it instead of the primary.
        const secondary = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: 'fitness/multi-secondary.fit',
          fileName: 'secondary.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 1024
        })
        const primary = await database.createFitnessFile({
          actorId: emptyActorId,
          statusId,
          path: 'fitness/multi-primary.fit',
          fileName: 'primary.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 2048
        })
        await database.updateFitnessFilePrimary(secondary!.id, false)
        await database.updateFitnessFilePrimary(primary!.id, true)

        const status = (await database.getStatus({ statusId })) as StatusNote
        expect(status.fitness?.id).toBe(primary!.id)
        expect(status.fitness?.fileName).toBe('primary.fit')
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

    describe('getStatusFromUrl', () => {
      it('returns status by URL', async () => {
        const status = await database.getStatusFromUrl({
          url: statuses.primary.post
        })
        expect(status?.id).toBe(statuses.primary.post)
      })

      it('returns null for unknown URL', async () => {
        const status = await database.getStatusFromUrl({
          url: 'https://example.test/statuses/does-not-exist'
        })
        expect(status).toBeNull()
      })
    })

    describe('getStatusFromUrlHash', () => {
      it('returns status by URL hash', async () => {
        const status = await database.getStatusFromUrlHash({
          urlHash: getHashFromString(statuses.primary.post)
        })
        expect(status?.id).toBe(statuses.primary.post)
      })

      it('returns status by URL hash scoped to actor', async () => {
        const status = await database.getStatusFromUrlHash({
          urlHash: getHashFromString(statuses.primary.post),
          actorId: primaryActorId
        })
        expect(status?.id).toBe(statuses.primary.post)
      })

      it('returns null for unknown URL hash', async () => {
        const status = await database.getStatusFromUrlHash({
          urlHash: getHashFromString(
            'https://example.test/statuses/does-not-exist'
          )
        })
        expect(status).toBeNull()
      })

      it('returns null for actor mismatch', async () => {
        const status = await database.getStatusFromUrlHash({
          urlHash: getHashFromString(statuses.primary.post),
          actorId: replyAuthorId
        })
        expect(status).toBeNull()
      })
    })

    describe('publicId', () => {
      // A dedicated actor, isolated from the shared seed fixtures, so these
      // notes never bump a status count another describe block asserts on.
      const publicIdActorId = 'https://public-id-status.test/users/author'

      beforeAll(async () => {
        await database.createActor({
          actorId: publicIdActorId,
          username: 'author',
          domain: 'public-id-status.test',
          followersUrl: `${publicIdActorId}/followers`,
          inboxUrl: `${publicIdActorId}/inbox`,
          sharedInboxUrl: 'https://public-id-status.test/inbox',
          publicKey: 'public-id-status-public-key',
          createdAt: Date.now()
        })
      })

      it('mints a v7 publicId at createNote whose timestamp matches a backdated createdAt', async () => {
        const backdatedAt = Date.UTC(2024, 0, 2, 3, 4, 5, 0)
        const statusId = `${publicIdActorId}/statuses/public-id-backdated`
        const status = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Backdated post',
          createdAt: backdatedAt
        })) as StatusNote

        expect(status.publicId).toBeTruthy()
        expect(isPublicId(status.publicId as string)).toBe(true)
        expect(getPublicIdTimestamp(status.publicId as string)).toBe(
          backdatedAt
        )
      })

      it('stores an explicitly passed publicId verbatim', async () => {
        const statusId = `${publicIdActorId}/statuses/public-id-explicit`
        const explicitPublicId = generatePublicId()
        const status = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Explicit publicId post',
          publicId: explicitPublicId
        })) as StatusNote

        expect(status.publicId).toBe(explicitPublicId)
      })

      it('round-trips getStatusIdByPublicId and returns null for an id that was never stored', async () => {
        const statusId = `${publicIdActorId}/statuses/public-id-roundtrip`
        const status = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Round trip post'
        })) as StatusNote

        expect(
          await database.getStatusIdByPublicId({
            publicId: status.publicId as string
          })
        ).toBe(statusId)
        expect(
          await database.getStatusIdByPublicId({
            publicId: generatePublicId()
          })
        ).toBeNull()
      })

      it('getStatusIdsByPublicIds maps every known publicId back and omits unknown ones', async () => {
        const firstId = `${publicIdActorId}/statuses/public-ids-batch-1`
        const secondId = `${publicIdActorId}/statuses/public-ids-batch-2`
        const first = (await database.createNote({
          id: firstId,
          url: firstId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Batch post one'
        })) as StatusNote
        const second = (await database.createNote({
          id: secondId,
          url: secondId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Batch post two'
        })) as StatusNote
        const unknownPublicId = generatePublicId()

        const map = await database.getStatusIdsByPublicIds({
          publicIds: [
            first.publicId as string,
            second.publicId as string,
            unknownPublicId
          ]
        })

        expect(map.size).toBe(2)
        expect(map.get(first.publicId as string)).toBe(firstId)
        expect(map.get(second.publicId as string)).toBe(secondId)
        expect(map.has(unknownPublicId)).toBe(false)
      })

      it('getStatusIdsByPublicIds returns an empty map for an empty request', async () => {
        const map = await database.getStatusIdsByPublicIds({ publicIds: [] })
        expect(map.size).toBe(0)
      })

      it('resolves an uppercased publicId and keys the batch map by the requested form', async () => {
        // publicIds are stored lowercase and SQLite/PostgreSQL compare them case
        // sensitively, so the case fold has to happen on the lookup PARAMETER —
        // in the database layer, where every resolution site shares it. The
        // batch map is keyed by what the caller asked with, not by what the row
        // holds, so a caller can zip it back against its own input.
        const statusId = `${publicIdActorId}/statuses/public-id-uppercase`
        const status = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Uppercase lookup post'
        })) as StatusNote
        const uppercasePublicId = (status.publicId as string).toUpperCase()

        expect(
          await database.getStatusIdByPublicId({ publicId: uppercasePublicId })
        ).toBe(statusId)

        const map = await database.getStatusIdsByPublicIds({
          publicIds: [uppercasePublicId]
        })
        expect(map.get(uppercasePublicId)).toBe(statusId)
      })

      it('getStatusFromPublicId hydrates the same status as getStatus', async () => {
        const statusId = `${publicIdActorId}/statuses/public-id-hydrate`
        const created = (await database.createNote({
          id: statusId,
          url: statusId,
          actorId: publicIdActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Hydrate post'
        })) as StatusNote

        const [byPublicId, byId] = await Promise.all([
          database.getStatusFromPublicId({
            publicId: created.publicId as string
          }),
          database.getStatus({ statusId })
        ])

        expect(byPublicId).toEqual(byId)
      })

      it('getStatusPublicIds returns a map covering only requested ids that have publicIds', async () => {
        const { database: freshDatabase, instance } =
          getTestSQLDatabaseWithInstance()
        await freshDatabase.migrate()
        try {
          await freshDatabase.createAccount({
            email: `public-id-map@${TEST_DOMAIN}`,
            username: 'public-id-map-actor',
            passwordHash: TEST_PASSWORD_HASH,
            domain: TEST_DOMAIN,
            privateKey: 'private-public-id-map',
            publicKey: 'public-public-id-map'
          })
          const actor = await freshDatabase.getActorFromEmail({
            email: `public-id-map@${TEST_DOMAIN}`
          })
          if (!actor) throw new Error('failed to seed actor')
          const localActorId = actor.id

          const withId = `${localActorId}/statuses/with-public-id`
          const withoutId = `${localActorId}/statuses/legacy-without-public-id`

          const created = (await freshDatabase.createNote({
            id: withId,
            url: withId,
            actorId: localActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Has a publicId'
          })) as StatusNote

          await freshDatabase.createNote({
            id: withoutId,
            url: withoutId,
            actorId: localActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Simulated pre-backfill legacy status'
          })
          // Simulate a legacy row that predates the backfill migration.
          await instance('statuses')
            .where('id', withoutId)
            .update({ publicId: null })

          const map = await freshDatabase.getStatusPublicIds({
            statusIds: [withId, withoutId, `${localActorId}/statuses/missing`]
          })

          expect(map.size).toBe(1)
          expect(map.get(withId)).toBe(created.publicId)
          expect(map.has(withoutId)).toBe(false)
        } finally {
          await freshDatabase.destroy()
        }
      })

      it('getStatusPublicIds chunks a request wider than the SQLite bind limit', async () => {
        // A full timeline page can carry more ids than SQLITE_MAX_BINDINGS
        // allows in one statement, so the lookup has to chunk like its
        // getStatusIdsByPublicIds counterpart does.
        const { database: freshDatabase, instance } =
          getTestSQLDatabaseWithInstance()
        await freshDatabase.migrate()
        const queries: { bindings: unknown[]; sql: string }[] = []
        const handleQuery = ({
          bindings,
          sql
        }: {
          bindings?: unknown[]
          sql: string
        }) => {
          queries.push({ bindings: bindings ?? [], sql: sql.toLowerCase() })
        }
        try {
          const actorId = 'https://public-id-chunk.test/users/author'
          await freshDatabase.createActor({
            actorId,
            username: 'author',
            domain: 'public-id-chunk.test',
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://public-id-chunk.test/inbox',
            publicKey: 'public-id-chunk-public-key',
            createdAt: Date.now()
          })
          const statusId = `${actorId}/statuses/public-ids-chunked`
          const status = (await freshDatabase.createNote({
            id: statusId,
            url: statusId,
            actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            text: 'Chunked lookup post'
          })) as StatusNote
          const statusIds = [
            ...Array.from(
              { length: SQLITE_MAX_BINDINGS + 10 },
              (_unused, index) =>
                `${actorId}/statuses/public-ids-chunk-missing-${index}`
            ),
            statusId
          ]

          instance.on('query', handleQuery)
          const map = await freshDatabase.getStatusPublicIds({ statusIds })
          instance.off('query', handleQuery)

          const bindingCounts = queries
            .filter(
              ({ sql }) =>
                sql.includes('from `statuses`') && sql.includes('`id` in')
            )
            .map(({ bindings }) => bindings.length)
          expect(bindingCounts.length).toBeGreaterThan(1)
          expect(Math.max(...bindingCounts)).toBeLessThanOrEqual(
            SQLITE_MAX_BINDINGS
          )
          expect(map.size).toBe(1)
          expect(map.get(statusId)).toBe(status.publicId)
        } finally {
          instance.off('query', handleQuery)
          await freshDatabase.destroy()
        }
      })
    })

    describe('getActorStatusFromPathSegment', () => {
      // Dedicated actors, isolated from the shared seed fixtures, so these
      // notes never bump a status count another describe block asserts on.
      const authorId = 'https://path-segment-status.test/users/author'
      const otherAuthorId = 'https://path-segment-status.test/users/other'
      // A status created before publicIds existed keeps its original URI tail
      // and only gained a publicId in the backfill, so the two differ.
      const legacyTail = 'path-segment-legacy-tail'
      const legacyStatusId = `${authorId}/statuses/${legacyTail}`
      const otherAuthorStatusId = `${otherAuthorId}/statuses/${legacyTail}`
      let legacyStatus: StatusNote
      let otherAuthorStatus: StatusNote

      const createAuthor = (actorId: string, username: string) =>
        database.createActor({
          actorId,
          username,
          domain: 'path-segment-status.test',
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: 'https://path-segment-status.test/inbox',
          publicKey: `${username}-public-key`,
          createdAt: Date.now()
        })

      beforeAll(async () => {
        await createAuthor(authorId, 'path-segment-author')
        await createAuthor(otherAuthorId, 'path-segment-other')
        legacyStatus = (await database.createNote({
          id: legacyStatusId,
          url: legacyStatusId,
          actorId: authorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Legacy tail post'
        })) as StatusNote
        otherAuthorStatus = (await database.createNote({
          id: otherAuthorStatusId,
          url: otherAuthorStatusId,
          actorId: otherAuthorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Another actor post'
        })) as StatusNote
      })

      it('resolves a status from its URI tail', async () => {
        const status = await database.getActorStatusFromPathSegment({
          actorId: authorId,
          pathSegment: legacyTail
        })
        expect(status?.id).toBe(legacyStatusId)
      })

      it('resolves a backfilled status from its publicId when the URI tail differs', async () => {
        const publicId = legacyStatus.publicId as string
        expect(publicId).not.toBe(legacyTail)

        const status = await database.getActorStatusFromPathSegment({
          actorId: authorId,
          pathSegment: publicId
        })
        expect(status?.id).toBe(legacyStatusId)
      })

      it('returns null for a publicId that belongs to another actor', async () => {
        const publicId = otherAuthorStatus.publicId as string
        const underOwnActor = await database.getActorStatusFromPathSegment({
          actorId: otherAuthorId,
          pathSegment: publicId
        })
        expect(underOwnActor?.id).toBe(otherAuthorStatusId)

        expect(
          await database.getActorStatusFromPathSegment({
            actorId: authorId,
            pathSegment: publicId
          })
        ).toBeNull()
      })

      it.each([
        {
          description: 'an unknown URI tail',
          pathSegment: 'path-segment-never-created'
        },
        { description: 'an unknown publicId', pathSegment: generatePublicId() }
      ])('returns null for $description', async ({ pathSegment }) => {
        expect(
          await database.getActorStatusFromPathSegment({
            actorId: authorId,
            pathSegment
          })
        ).toBeNull()
      })
    })

    describe('getStatusesByIds', () => {
      const createVisibilityActor = async ({
        name,
        suffix,
        local = false
      }: {
        name: string
        suffix: string
        local?: boolean
      }) => {
        const actorId = `https://status-visibility.test/users/${name}-${suffix}`
        await database.createActor({
          actorId,
          username: `${name}-${suffix}`,
          domain: 'status-visibility.test',
          followersUrl: `${actorId}/followers`,
          inboxUrl: `${actorId}/inbox`,
          sharedInboxUrl: 'https://status-visibility.test/inbox',
          publicKey: `public-key-${name}-${suffix}`,
          privateKey: local ? `private-key-${name}-${suffix}` : undefined,
          createdAt: Date.now()
        })
        return actorId
      }

      it('hydrates actor flags for the current actor', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const bookmarkedStatusId = `${emptyActorId}/statuses/bookmarked-${suffix}`
        const unbookmarkedStatusId = `${emptyActorId}/statuses/unbookmarked-${suffix}`

        await database.createNote({
          id: bookmarkedStatusId,
          url: bookmarkedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Bookmarked status'
        })
        await database.createNote({
          id: unbookmarkedStatusId,
          url: unbookmarkedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Unbookmarked status'
        })
        await database.createBookmark({
          actorId: primaryActorId,
          statusId: bookmarkedStatusId
        })
        await database.createLike({
          actorId: primaryActorId,
          statusId: unbookmarkedStatusId
        })

        const results = await database.getStatusesByIds({
          statusIds: [unbookmarkedStatusId, bookmarkedStatusId],
          currentActorId: primaryActorId
        })

        expect(results.map((status) => status.id)).toEqual([
          unbookmarkedStatusId,
          bookmarkedStatusId
        ])
        expect((results[0] as StatusNote).isActorBookmarked).toBe(false)
        expect((results[0] as StatusNote).isActorLiked).toBe(true)
        expect((results[1] as StatusNote).isActorBookmarked).toBe(true)
        expect((results[1] as StatusNote).isActorLiked).toBe(false)
      })

      it('batch-hydrates detected language regardless of whether a viewer is signed in', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const detectedStatusId = `${emptyActorId}/statuses/detected-${suffix}`
        const undetectedStatusId = `${emptyActorId}/statuses/undetected-${suffix}`

        await database.createNote({
          id: detectedStatusId,
          url: detectedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Status with a detected language'
        })
        await database.createNote({
          id: undetectedStatusId,
          url: undetectedStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Status without a detected language'
        })
        await database.setDetectedLanguage({
          statusId: detectedStatusId,
          language: 'th'
        })

        const signedInResults = await database.getStatusesByIds({
          statusIds: [detectedStatusId, undetectedStatusId],
          currentActorId: primaryActorId
        })
        expect((signedInResults[0] as StatusNote).detectedLanguage).toBe('th')
        expect((signedInResults[1] as StatusNote).detectedLanguage).toBeNull()

        const anonymousResults = await database.getStatusesByIds({
          statusIds: [detectedStatusId, undetectedStatusId]
        })
        expect((anonymousResults[0] as StatusNote).detectedLanguage).toBe('th')
        expect((anonymousResults[1] as StatusNote).detectedLanguage).toBeNull()
      })

      it('hydrates actor flags for nested announce originals', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const originalActorId = `${emptyActorId}/announce-original-${suffix}`
        const firstAnnounceActorId = `${replyAuthorId}/announce-first-${suffix}`
        const secondAnnounceActorId = `${extraActorId}/announce-second-${suffix}`
        const originalStatusId = `${originalActorId}/statuses/original`
        const firstAnnounceId = `${firstAnnounceActorId}/statuses/first`
        const secondAnnounceId = `${secondAnnounceActorId}/statuses/second`

        await database.createNote({
          id: originalStatusId,
          url: originalStatusId,
          actorId: originalActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Nested announce original'
        })
        await database.createAnnounce({
          id: firstAnnounceId,
          actorId: firstAnnounceActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId
        })
        await database.createAnnounce({
          id: secondAnnounceId,
          actorId: secondAnnounceActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: firstAnnounceId
        })
        await database.createBookmark({
          actorId: primaryActorId,
          statusId: secondAnnounceId
        })
        await database.createLike({
          actorId: primaryActorId,
          statusId: originalStatusId
        })

        const results = await database.getStatusesByIds({
          statusIds: [secondAnnounceId],
          currentActorId: primaryActorId
        })

        expect(results).toHaveLength(1)
        const secondAnnounce = results[0] as StatusAnnounce
        expect(secondAnnounce.type).toBe(StatusType.enum.Announce)
        const firstAnnounce = secondAnnounce.originalStatus as StatusAnnounce
        expect(firstAnnounce.type).toBe(StatusType.enum.Announce)
        const originalStatus = firstAnnounce.originalStatus as StatusNote
        expect(originalStatus.id).toBe(originalStatusId)
        expect(originalStatus.isActorBookmarked).toBe(true)
        expect(originalStatus.isActorLiked).toBe(true)
      })

      it('filters statuses by visible actor while preserving requested order', async () => {
        const suffix = `${Date.now()}-${Math.random()}`
        const hiddenStatusId = `${emptyActorId}/statuses/hidden-${suffix}`
        const directStatusId = `${emptyActorId}/statuses/direct-${suffix}`
        const publicStatusId = `${emptyActorId}/statuses/public-${suffix}`

        await database.createNote({
          id: hiddenStatusId,
          url: hiddenStatusId,
          actorId: emptyActorId,
          to: [extraActorId],
          cc: [],
          text: 'Hidden status'
        })
        await database.createNote({
          id: directStatusId,
          url: directStatusId,
          actorId: emptyActorId,
          to: [primaryActorId],
          cc: [],
          text: 'Direct status'
        })
        await database.createNote({
          id: publicStatusId,
          url: publicStatusId,
          actorId: emptyActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Public status'
        })

        const results = await database.getStatusesByIds({
          statusIds: [hiddenStatusId, directStatusId, publicStatusId],
          visibleToActorId: primaryActorId
        })

        expect(results.map((status) => status.id)).toEqual([
          directStatusId,
          publicStatusId
        ])
      })

      it('includes recipientless replies to statuses authored by the visible actor', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const visibleActorId = await createVisibilityActor({
          name: 'visible-parent',
          suffix
        })
        const replyActorId = await createVisibilityActor({
          name: 'visible-reply',
          suffix
        })
        const parentStatusId = `${visibleActorId}/statuses/recipientless-visible-parent`
        const replyStatusId = `${replyActorId}/statuses/recipientless-visible-reply`

        const parent = await database.createNote({
          id: parentStatusId,
          url: `${parentStatusId}/canonical`,
          actorId: visibleActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${visibleActorId}/followers`],
          text: 'Recipientless reply parent'
        })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          to: [],
          cc: [],
          reply: (parent as StatusNote).url,
          text: 'Recipientless reply to visible actor'
        })

        const results = await database.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: visibleActorId
        })

        expect(results.map((status) => status.id)).toEqual([replyStatusId])
      })

      it('includes recipientless replies for inherited direct conversation participants', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const rootActorId = await createVisibilityActor({
          name: 'dm-root',
          suffix,
          local: true
        })
        const replyActorId = await createVisibilityActor({
          name: 'dm-reply',
          suffix,
          local: true
        })
        const participantActorId = await createVisibilityActor({
          name: 'dm-participant',
          suffix,
          local: true
        })
        const rootStatusId = `${rootActorId}/statuses/recipientless-dm-root`
        const replyStatusId = `${replyActorId}/statuses/recipientless-dm-reply`

        const root = await database.createNote({
          id: rootStatusId,
          url: `${rootStatusId}/canonical`,
          actorId: rootActorId,
          to: [replyActorId, participantActorId],
          cc: [],
          text: 'Direct conversation root'
        })
        await database.syncDirectConversationForStatus({ status: root })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          to: [],
          cc: [],
          reply: (root as StatusNote).url,
          text: 'Recipientless reply in synced direct conversation'
        })

        const results = await database.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: participantActorId
        })

        expect(results.map((status) => status.id)).toEqual([replyStatusId])
      })

      it('excludes recipientless replies for unrelated visible actors', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const parentActorId = await createVisibilityActor({
          name: 'hidden-parent',
          suffix
        })
        const replyActorId = await createVisibilityActor({
          name: 'hidden-reply',
          suffix
        })
        const visibleActorId = await createVisibilityActor({
          name: 'unrelated-visible',
          suffix
        })
        const parentStatusId = `${parentActorId}/statuses/recipientless-hidden-parent`
        const replyStatusId = `${replyActorId}/statuses/recipientless-hidden-reply`

        const parent = await database.createNote({
          id: parentStatusId,
          url: parentStatusId,
          actorId: parentActorId,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          text: 'Unrelated recipientless parent'
        })
        await database.createNote({
          id: replyStatusId,
          url: replyStatusId,
          actorId: replyActorId,
          to: [],
          cc: [],
          reply: parent.id,
          text: 'Recipientless reply hidden from unrelated actors'
        })

        const results = await database.getStatusesByIds({
          statusIds: [replyStatusId],
          visibleToActorId: visibleActorId
        })

        expect(results).toEqual([])
      })

      it('includes followers-only statuses from followed actors when filtering by visible actor', async () => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const followerActorId = `${emptyActorId}/followers-only-follower-${suffix}`
        const followedActorId = `${emptyActorId}/followers-only-followed-${suffix}`
        const followersUrl = `${followedActorId}/followers`
        const statusId = `${followedActorId}/statuses/followers-only-${suffix}`

        await database.createActor({
          actorId: followerActorId,
          username: `followers-only-follower-${suffix}`,
          domain: 'remote.test',
          followersUrl: `${followerActorId}/followers`,
          inboxUrl: `${followerActorId}/inbox`,
          sharedInboxUrl: 'https://remote.test/inbox',
          publicKey: `follower-public-key-${suffix}`,
          createdAt: Date.now()
        })
        await database.createActor({
          actorId: followedActorId,
          username: `followers-only-followed-${suffix}`,
          domain: 'remote.test',
          followersUrl,
          inboxUrl: `${followedActorId}/inbox`,
          sharedInboxUrl: 'https://remote.test/inbox',
          publicKey: `followed-public-key-${suffix}`,
          createdAt: Date.now()
        })
        await database.createFollow({
          actorId: followerActorId,
          targetActorId: followedActorId,
          inbox: `${followerActorId}/inbox`,
          sharedInbox: `${followerActorId}/inbox`,
          status: FollowStatus.enum.Accepted
        })
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: followedActorId,
          to: [followersUrl],
          cc: [],
          text: 'Followers-only status from followed actor'
        })

        const results = await database.getStatusesByIds({
          statusIds: [statusId],
          visibleToActorId: followerActorId
        })

        expect(results.map((status) => status.id)).toEqual([statusId])
      })
    })
  })
})
