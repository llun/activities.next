import {
  actors,
  emptyActorId,
  extraActorId,
  pollAuthorId,
  primaryActorId,
  replyAuthorId,
  statuses
} from '@/lib/database/sql/statusTestHelpers'
import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { STUCK_PROCESSING_THRESHOLD_MS } from '@/lib/services/fitness-files/processingState'
import { seedDatabase } from '@/lib/stub/database'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { generatePublicId } from '@/lib/utils/publicId'

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
  })
})
