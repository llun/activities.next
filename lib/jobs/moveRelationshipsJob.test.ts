import { applyBlock } from '@/lib/actions/applyBlock'
import { applyMute } from '@/lib/actions/applyMute'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import {
  getMoveRelationshipsJobId,
  moveRelationshipsJob,
  publishMoveRelationshipsJobs
} from '@/lib/jobs/moveRelationshipsJob'
import {
  MOVE_RELATIONSHIPS_JOB_NAME,
  SEND_BLOCK_JOB_NAME,
  SEND_UNDO_FOLLOW_JOB_NAME
} from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

const mockPublish = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

const ORIGIN = EXTERNAL_ACTOR1
const TARGET = 'https://newhome.test/users/test1'

describe('moveRelationshipsJob', () => {
  let database: Database
  let db: ReturnType<typeof createTestDatabase>['db']

  beforeEach(async () => {
    const created = createTestDatabase()
    database = created.database
    db = created.db
    await created.prepare()
    await database.migrate()
    await seedDatabase(database)

    mockPublish.mockReset()

    await database.createActor({
      actorId: TARGET,
      username: 'test1',
      domain: 'newhome.test',
      inboxUrl: `${TARGET}/inbox`,
      sharedInboxUrl: 'https://newhome.test/inbox',
      followersUrl: `${TARGET}/followers`,
      publicKey: 'publicKey',
      createdAt: Date.now()
    })
    await database.updateActor({ actorId: ORIGIN, movedTo: TARGET })
  })

  afterEach(async () => {
    await database.destroy()
  })

  describe('publishMoveRelationshipsJobs', () => {
    it('unions and dedupes local blockers, muters, and note authors on origin', async () => {
      // ACTOR1_ID blocks ORIGIN
      await database.createBlock({
        actorId: ACTOR1_ID,
        targetActorId: ORIGIN,
        uri: `${ACTOR1_ID}#blocks/1`
      })
      // ACTOR1_ID also mutes ORIGIN
      await applyMute({
        database,
        actorId: ACTOR1_ID,
        targetActorId: ORIGIN,
        notifications: true,
        endsAt: null
      })
      // ACTOR2_ID has an account note on ORIGIN
      await database.upsertAccountNote({
        actorId: ACTOR2_ID,
        targetActorId: ORIGIN,
        comment: 'important person'
      })

      const failures = await publishMoveRelationshipsJobs({
        database,
        originActorId: ORIGIN,
        targetActorId: TARGET
      })

      expect(failures).toBe(0)
      // Exactly 2 jobs published (ACTOR1_ID deduped, plus ACTOR2_ID)
      expect(mockPublish).toHaveBeenCalledTimes(2)

      const publishedActorIds = mockPublish.mock.calls.map(
        (call) => call[0].data.actorId
      )
      expect(publishedActorIds).toContain(ACTOR1_ID)
      expect(publishedActorIds).toContain(ACTOR2_ID)

      for (const call of mockPublish.mock.calls) {
        const payload = call[0]
        expect(payload.id).toBe(
          getMoveRelationshipsJobId(payload.data.actorId, ORIGIN, TARGET)
        )
        expect(payload.name).toBe(MOVE_RELATIONSHIPS_JOB_NAME)
        expect(payload.data).toEqual({
          actorId: payload.data.actorId,
          originActorId: ORIGIN,
          targetActorId: TARGET
        })
      }
    })

    it('returns failure count and logs error when queue publish throws', async () => {
      await database.upsertAccountNote({
        actorId: ACTOR1_ID,
        targetActorId: ORIGIN,
        comment: 'note'
      })

      mockPublish.mockRejectedValueOnce(new Error('Queue unavailable'))
      const loggerErrorSpy = vi
        .spyOn(logger, 'error')
        .mockImplementation(() => {})

      const failures = await publishMoveRelationshipsJobs({
        database,
        originActorId: ORIGIN,
        targetActorId: TARGET
      })

      expect(failures).toBe(1)
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Move: failed to queue relationships carryover',
          actorId: ACTOR1_ID,
          originActorId: ORIGIN,
          targetActorId: TARGET
        })
      )
    })

    it('does not publish jobs for the target itself if target has relationships on origin', async () => {
      // ACTOR2_ID is target, and ACTOR2_ID blocks, mutes, and has an account note on ORIGIN
      await database.createBlock({
        actorId: ACTOR2_ID,
        targetActorId: ORIGIN,
        uri: `${ACTOR2_ID}#blocks/1`
      })
      await applyMute({
        database,
        actorId: ACTOR2_ID,
        targetActorId: ORIGIN,
        notifications: true,
        endsAt: null
      })
      await database.upsertAccountNote({
        actorId: ACTOR2_ID,
        targetActorId: ORIGIN,
        comment: 'Target note on origin'
      })

      const failures = await publishMoveRelationshipsJobs({
        database,
        originActorId: ORIGIN,
        targetActorId: ACTOR2_ID
      })

      expect(failures).toBe(0)
      expect(mockPublish).not.toHaveBeenCalled()
    })
  })

  describe('moveRelationshipsJob execution', () => {
    const runJob = async (
      actorId = ACTOR1_ID,
      originActorId = ORIGIN,
      targetActorId = TARGET,
      migrationId?: string
    ) =>
      moveRelationshipsJob(database, {
        id: getMoveRelationshipsJobId(actorId, originActorId, targetActorId),
        name: MOVE_RELATIONSHIPS_JOB_NAME,
        data: { actorId, originActorId, targetActorId, migrationId }
      })

    describe('account notes', () => {
      it('copies note when target has no note (exact text)', async () => {
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'Met at conference'
        })

        await runJob()

        const origin = await database.getActorFromId({ id: ORIGIN })
        const acct = `${origin?.username}@${origin?.domain}`
        const expectedNote = `This user moved from ${acct}, here were your previous notes about them:\nMet at conference`

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe(expectedNote)
      })

      it('merges with blank line when target already has a note', async () => {
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'Old notes'
        })
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          comment: 'Existing note on target'
        })

        await runJob()

        const origin = await database.getActorFromId({ id: ORIGIN })
        const acct = `${origin?.username}@${origin?.domain}`
        const copyText = `This user moved from ${acct}, here were your previous notes about them:`
        const expected = [
          copyText,
          'Old notes',
          '\n',
          'Existing note on target'
        ].join('\n')

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe(expected)
      })

      it('is idempotent on rerun and does not duplicate the note', async () => {
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'Met at conference'
        })

        await runJob()
        const noteAfterFirst = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })

        await runJob()
        const noteAfterSecond = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })

        expect(noteAfterSecond).toBe(noteAfterFirst)
      })

      it('falls back to origin note alone when target has none and combined exceeds 2000 chars', async () => {
        // copyText length ~ 85 chars. We make originNote 1950 chars so combined > 2000 but originNote <= 2000.
        const longNote = 'a'.repeat(1950)
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: longNote
        })

        await runJob()

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe(longNote)
      })

      it('skips note copy when target already has a note and combined exceeds 2000 chars', async () => {
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'a'.repeat(1000)
        })
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          comment: 'b'.repeat(1000)
        })

        await runJob()

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        // Target note untouched
        expect(note).toBe('b'.repeat(1000))
      })
    })

    describe('blocks', () => {
      it('carries block over, publishes SEND_BLOCK_JOB_NAME, and adds note', async () => {
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })

        await runJob()

        const origin = await database.getActorFromId({ id: ORIGIN })
        const acct = `${origin?.username}@${origin?.domain}`
        const expectedUri = `${ACTOR1_ID}#blocks/${getHashFromString(`${ACTOR1_ID}/move-block/${ORIGIN}/${TARGET}`)}`

        const block = await database.getBlock({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(block).not.toBeNull()
        expect(block?.uri).toBe(expectedUri)

        expect(mockPublish).toHaveBeenCalledWith({
          id: getHashFromString(expectedUri),
          name: SEND_BLOCK_JOB_NAME,
          data: {
            actorId: ACTOR1_ID,
            targetActorId: TARGET,
            uri: expectedUri
          }
        })

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe(
          `This user moved from ${acct}, which you had blocked.`
        )
      })

      it('skips block when already blocking target', async () => {
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          uri: `${ACTOR1_ID}#blocks/custom-existing`
        })

        mockPublish.mockClear()
        await runJob()

        expect(mockPublish).not.toHaveBeenCalled()
        const block = await database.getBlock({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(block?.uri).toBe(`${ACTOR1_ID}#blocks/custom-existing`)
      })

      it('skips block when following target', async () => {
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        await database.createFollow({
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          status: FollowStatus.enum.Accepted,
          inbox: `${ACTOR1_ID}/inbox`,
          sharedInbox: 'https://llun.test/inbox'
        })

        mockPublish.mockClear()
        await runJob()

        expect(mockPublish).not.toHaveBeenCalled()
        const block = await database.getBlock({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(block).toBeNull()
      })

      it('creates block in DB and adds note for a local target without publishing SEND_BLOCK_JOB_NAME', async () => {
        await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })

        mockPublish.mockClear()
        await runJob(ACTOR1_ID, ORIGIN, ACTOR2_ID)

        const block = await database.getBlock({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID
        })
        expect(block).not.toBeNull()

        expect(mockPublish).not.toHaveBeenCalled()

        const origin = await database.getActorFromId({ id: ORIGIN })
        const acct = `${origin?.username}@${origin?.domain}`
        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID
        })
        expect(note).toBe(
          `This user moved from ${acct}, which you had blocked.`
        )

        // On resume (second run), local target still never publishes SEND_BLOCK_JOB_NAME
        mockPublish.mockClear()
        await runJob(ACTOR1_ID, ORIGIN, ACTOR2_ID)
        expect(mockPublish).not.toHaveBeenCalled()
      })

      it('re-publishes SEND_BLOCK_JOB_NAME on retry when already blocked with deterministic uri', async () => {
        const deterministicUri = `${ACTOR1_ID}#blocks/${getHashFromString(`${ACTOR1_ID}/move-block/${ORIGIN}/${TARGET}`)}`
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        await database.createBlock({
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          uri: deterministicUri
        })

        mockPublish.mockClear()
        await runJob()

        expect(mockPublish).toHaveBeenCalledWith({
          id: getHashFromString(deterministicUri),
          name: SEND_BLOCK_JOB_NAME,
          data: {
            actorId: ACTOR1_ID,
            targetActorId: TARGET,
            uri: deterministicUri
          }
        })
      })

      it('ends a local target follow on resume when only the block row was inserted', async () => {
        const deterministicUri = `${ACTOR1_ID}#blocks/${getHashFromString(`${ACTOR1_ID}/move-block/${ORIGIN}/${ACTOR2_ID}`)}`
        await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        const follow = await database.createFollow({
          actorId: ACTOR2_ID,
          targetActorId: ACTOR1_ID,
          status: FollowStatus.enum.Accepted,
          inbox: `${ACTOR2_ID}/inbox`,
          sharedInbox: 'https://llun.test/inbox'
        })
        await new Promise((resolve) => setTimeout(resolve, 5))
        await database.createBlock({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID,
          uri: deterministicUri
        })

        mockPublish.mockClear()
        await runJob(ACTOR1_ID, ORIGIN, ACTOR2_ID)

        const updated = await database.getFollowFromId({ followId: follow.id })
        expect(updated?.status).toBe(FollowStatus.enum.Undo)
        expect(mockPublish).not.toHaveBeenCalledWith(
          expect.objectContaining({ name: SEND_BLOCK_JOB_NAME })
        )
      })

      it('ends a crash-left requested follow to a local target on resume', async () => {
        const deterministicUri = `${ACTOR1_ID}#blocks/${getHashFromString(`${ACTOR1_ID}/move-block/${ORIGIN}/${ACTOR2_ID}`)}`
        await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        const follow = await database.createFollow({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID,
          status: FollowStatus.enum.Requested,
          inbox: `${ACTOR2_ID}/inbox`,
          sharedInbox: 'https://llun.test/inbox'
        })
        await new Promise((resolve) => setTimeout(resolve, 5))
        await database.createBlock({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID,
          uri: deterministicUri
        })

        await runJob(ACTOR1_ID, ORIGIN, ACTOR2_ID)

        const updated = await database.getFollowFromId({ followId: follow.id })
        expect(updated?.status).toBe(FollowStatus.enum.Undo)
      })

      it('ends a target follow made after the carried block on re-run', async () => {
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        await runJob()
        await new Promise((resolve) => setTimeout(resolve, 5))
        const follow = await database.createFollow({
          actorId: TARGET,
          targetActorId: ACTOR1_ID,
          status: FollowStatus.enum.Accepted,
          inbox: `${TARGET}/inbox`,
          sharedInbox: 'https://llun.test/inbox'
        })

        await runJob()

        const updated = await database.getFollowFromId({ followId: follow.id })
        expect(updated?.status).toBe(FollowStatus.enum.Undo)
      })

      it("ends the target's follow on re-run even when the user followed the target after the block", async () => {
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        await runJob()
        await new Promise((resolve) => setTimeout(resolve, 5))
        const follow = await database.createFollow({
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          status: FollowStatus.enum.Accepted,
          inbox: `${TARGET}/inbox`,
          sharedInbox: 'https://llun.test/inbox'
        })
        const reverseFollow = await database.createFollow({
          actorId: TARGET,
          targetActorId: ACTOR1_ID,
          status: FollowStatus.enum.Accepted,
          inbox: `${TARGET}/inbox`,
          sharedInbox: 'https://llun.test/inbox'
        })

        await runJob()

        expect(
          (await database.getFollowFromId({ followId: reverseFollow.id }))
            ?.status
        ).toBe(FollowStatus.enum.Undo)
        expect(
          (await database.getFollowFromId({ followId: follow.id }))?.status
        ).toBe(FollowStatus.enum.Accepted)
      })

      it('leaves a follow made after the carried block alone on re-run', async () => {
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        await runJob()
        await new Promise((resolve) => setTimeout(resolve, 5))
        const follow = await database.createFollow({
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          status: FollowStatus.enum.Accepted,
          inbox: `${TARGET}/inbox`,
          sharedInbox: 'https://llun.test/inbox'
        })

        mockPublish.mockClear()
        await runJob()

        const updated = await database.getFollowFromId({ followId: follow.id })
        expect(updated?.status).toBe(FollowStatus.enum.Accepted)
        expect(mockPublish).not.toHaveBeenCalledWith(
          expect.objectContaining({ name: SEND_UNDO_FOLLOW_JOB_NAME })
        )
      })

      it('re-publishes SEND_BLOCK_JOB_NAME with deterministic id on second run (resume)', async () => {
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        mockPublish.mockClear()

        await runJob()
        const deterministicUri = `${ACTOR1_ID}#blocks/${getHashFromString(`${ACTOR1_ID}/move-block/${ORIGIN}/${TARGET}`)}`
        const deterministicId = getHashFromString(deterministicUri)
        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledWith({
          id: deterministicId,
          name: SEND_BLOCK_JOB_NAME,
          data: {
            actorId: ACTOR1_ID,
            targetActorId: TARGET,
            uri: deterministicUri
          }
        })

        mockPublish.mockClear()
        await runJob()
        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledWith({
          id: deterministicId,
          name: SEND_BLOCK_JOB_NAME,
          data: {
            actorId: ACTOR1_ID,
            targetActorId: TARGET,
            uri: deterministicUri
          }
        })
      })

      it('does not overwrite existing note with block note', async () => {
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'My note about them'
        })
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })

        await runJob()

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        // Note is the copied note, not "you had blocked"
        expect(note).toContain('here were your previous notes about them')
        expect(note).not.toContain('which you had blocked')
      })
    })

    describe('mutes', () => {
      it('carries mute over, preserving notifications and endsAt', async () => {
        const future = Date.now() + 100000
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: future
        })

        await runJob()

        const mute = await database.getMute({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(mute).not.toBeNull()
        expect(mute?.notifications).toBe(false)
        expect(mute?.endsAt).toBe(future)

        const origin = await database.getActorFromId({ id: ORIGIN })
        const acct = `${origin?.username}@${origin?.domain}`
        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe(`This user moved from ${acct}, which you had muted.`)
      })

      it('skips mute when already muting target', async () => {
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: null
        })
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          notifications: true,
          endsAt: null
        })

        await runJob()

        const mute = await database.getMute({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        // Untouched
        expect(mute?.notifications).toBe(true)
      })

      it('skips mute when following target', async () => {
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: null
        })
        await database.createFollow({
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          status: FollowStatus.enum.Accepted,
          inbox: `${ACTOR1_ID}/inbox`,
          sharedInbox: 'https://llun.test/inbox'
        })

        await runJob()

        const mute = await database.getMute({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(mute).toBeNull()
      })

      it('does not carry over expired mute', async () => {
        const past = Date.now() - 100000
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: past
        })

        await runJob()

        const mute = await database.getMute({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(mute).toBeNull()
      })

      it('does not overwrite existing note with muted note', async () => {
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'Met at conference'
        })
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: null
        })

        await runJob()

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toContain('here were your previous notes about them')
        expect(note).not.toContain('which you had muted')
      })

      it('does not add note on resume when target mute was created before move claim time', async () => {
        const future = Date.now() + 100000
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: future
        })
        const targetMute = await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          notifications: false,
          endsAt: future
        })

        const claimAt = targetMute.createdAt + 1000
        await database.claimActorMove({
          actorId: ORIGIN,
          activityId: 'inbox-move-1',
          target: TARGET,
          now: claimAt,
          windowMs: 7 * 86400000
        })

        await runJob()

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe('')
      })

      it('adds note on resume when target mute was created at or after move claim time', async () => {
        const future = Date.now() + 100000
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: future
        })
        const targetMute = await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          notifications: false,
          endsAt: future
        })

        const claimAt = targetMute.createdAt
        await database.claimActorMove({
          actorId: ORIGIN,
          activityId: 'inbox-move-1',
          target: TARGET,
          now: claimAt,
          windowMs: 7 * 86400000
        })

        await runJob()

        const origin = await database.getActorFromId({ id: ORIGIN })
        const acct = `${origin?.username}@${origin?.domain}`
        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe(`This user moved from ${acct}, which you had muted.`)
      })

      it('adds note on resume when an expired target mute was re-activated after the move claim', async () => {
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          notifications: false,
          endsAt: Date.now() - 100000
        })
        await new Promise((resolve) => setTimeout(resolve, 5))

        const future = Date.now() + 100000
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: future
        })
        await database.claimActorMove({
          actorId: ORIGIN,
          activityId: 'inbox-move-1',
          target: TARGET,
          now: Date.now(),
          windowMs: 7 * 86400000
        })
        // The crashed first run re-muted the target and stopped before the note
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          notifications: false,
          endsAt: future
        })

        await runJob()

        const origin = await database.getActorFromId({ id: ORIGIN })
        const acct = `${origin?.username}@${origin?.domain}`
        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe(`This user moved from ${acct}, which you had muted.`)
      })

      it('does not add note on resume when origin has no move claim time', async () => {
        const future = Date.now() + 100000
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: future
        })
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          notifications: false,
          endsAt: future
        })

        await runJob()

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe('')
      })

      it('leaves target mute untouched and adds no note when notifications setting differs', async () => {
        const future = Date.now() + 100000
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: future
        })
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          notifications: true,
          endsAt: future
        })

        await runJob()

        const mute = await database.getMute({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(mute?.notifications).toBe(true)
        expect(mute?.endsAt).toBe(future)

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe('')
      })

      it('leaves target mute untouched and adds no note when endsAt setting differs', async () => {
        const future1 = Date.now() + 100000
        const future2 = Date.now() + 200000
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: future1
        })
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: TARGET,
          notifications: false,
          endsAt: future2
        })

        await runJob()

        const mute = await database.getMute({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(mute?.notifications).toBe(false)
        expect(mute?.endsAt).toBe(future2)

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe('')
      })
    })

    describe('guard conditions (no-op)', () => {
      it('does nothing if actorId matches targetActorId (self relationship)', async () => {
        await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR1_ID })
        await database.createBlock({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/1`
        })
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: true,
          endsAt: null
        })
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'self note'
        })

        mockPublish.mockClear()
        await runJob(ACTOR1_ID, ORIGIN, ACTOR1_ID)

        expect(mockPublish).not.toHaveBeenCalled()
        expect(
          await database.getBlock({
            actorId: ACTOR1_ID,
            targetActorId: ACTOR1_ID
          })
        ).toBeNull()
        expect(
          await database.getMute({
            actorId: ACTOR1_ID,
            targetActorId: ACTOR1_ID
          })
        ).toBeNull()
        expect(
          await database.getAccountNote({
            actorId: ACTOR1_ID,
            targetActorId: ACTOR1_ID
          })
        ).toBe('')
      })
      it('does nothing if localActor is not local', async () => {
        // ORIGIN is remote, not local
        await database.upsertAccountNote({
          actorId: ORIGIN,
          targetActorId: TARGET,
          comment: 'existing remote note'
        })
        await database.upsertAccountNote({
          actorId: ORIGIN,
          targetActorId: ORIGIN,
          comment: 'origin note'
        })

        await runJob(ORIGIN, ORIGIN, TARGET)

        const note = await database.getAccountNote({
          actorId: ORIGIN,
          targetActorId: TARGET
        })
        // Note on target was not updated with copied note
        expect(note).toBe('existing remote note')
      })

      it('does nothing if origin.movedTo does not match target', async () => {
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'some note'
        })

        await runJob(ACTOR1_ID, ORIGIN, 'https://another.test/actor')

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: 'https://another.test/actor'
        })
        expect(note).toBe('')
      })

      const recordLocalMove = async () => {
        await database.updateActor({ actorId: ACTOR2_ID, movedTo: TARGET })
        await database.createActorMigration({
          id: 'local-move',
          actorId: ACTOR2_ID,
          targetActorId: TARGET,
          targetAcct: 'test1@newhome.test',
          kind: 'move',
          followersCount: 0
        })
      }

      it('does nothing for a local origin when the job carries no migration id', async () => {
        await recordLocalMove()
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID,
          comment: 'some note'
        })

        await runJob(ACTOR1_ID, ACTOR2_ID, TARGET)

        expect(
          await database.getAccountNote({
            actorId: ACTOR1_ID,
            targetActorId: TARGET
          })
        ).toBe('')
      })

      it('does not let an older started move to the same target authorize a newer move cancelled before it started', async () => {
        await recordLocalMove()
        await database.markActorMigrationStarted({ id: 'local-move' })
        await database.updateActor({ actorId: ACTOR2_ID, movedTo: null })
        await database.createActorMigration({
          id: 'newer-cancelled-move',
          actorId: ACTOR2_ID,
          targetActorId: TARGET,
          targetAcct: 'test1@newhome.test',
          kind: 'move',
          followersCount: 0
        })
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID,
          comment: 'some note'
        })

        await runJob(ACTOR1_ID, ACTOR2_ID, TARGET, 'newer-cancelled-move')

        expect(
          await database.getAccountNote({
            actorId: ACTOR1_ID,
            targetActorId: TARGET
          })
        ).toBe('')
      })

      describe('mute note on resume after an outgoing move', () => {
        const MIGRATION_AT = new Date('2026-03-01T00:00:00Z')
        // The same end time on both mutes, or the resume branch is not taken.
        const endsAt = Date.now() + 100000
        const muteAt = async (targetActorId: string, at: Date) => {
          const mute = await applyMute({
            database,
            actorId: ACTOR1_ID,
            targetActorId,
            notifications: false,
            endsAt
          })
          await db
            .updateTable('mutes')
            .set({ createdAt: at, updatedAt: at })
            .where('id', '=', mute.id)
            .execute()
        }
        const pinMigration = () =>
          db
            .updateTable('actor_migrations')
            .set({ createdAt: MIGRATION_AT })
            .where('id', '=', 'local-move')
            .execute()

        it('writes the note when the target mute was applied after the migration and the run died before the note', async () => {
          await recordLocalMove()
          await pinMigration()
          await muteAt(ACTOR2_ID, new Date('2026-02-01T00:00:00Z'))
          // The crashed first run: applyMute done, note not yet written.
          await muteAt(TARGET, new Date('2026-03-02T00:00:00Z'))

          await runJob(ACTOR1_ID, ACTOR2_ID, TARGET, 'local-move')

          const origin = await database.getActorFromId({ id: ACTOR2_ID })
          expect(
            await database.getAccountNote({
              actorId: ACTOR1_ID,
              targetActorId: TARGET
            })
          ).toBe(
            `This user moved from ${origin?.username}@${origin?.domain}, which you had muted.`
          )
        })

        it('writes no note when the target mute predates the migration', async () => {
          await recordLocalMove()
          await pinMigration()
          await muteAt(ACTOR2_ID, new Date('2026-02-01T00:00:00Z'))
          await muteAt(TARGET, new Date('2026-02-15T00:00:00Z'))

          await runJob(ACTOR1_ID, ACTOR2_ID, TARGET, 'local-move')

          expect(
            await database.getAccountNote({
              actorId: ACTOR1_ID,
              targetActorId: TARGET
            })
          ).toBe('')
        })
      })

      it('copies the note from a local origin that moved (outgoing move)', async () => {
        await recordLocalMove()
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID,
          comment: 'some note'
        })

        await runJob(ACTOR1_ID, ACTOR2_ID, TARGET, 'local-move')

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toContain('some note')
      })

      it('still copies the note when the local move was deleted after it started', async () => {
        await recordLocalMove()
        await database.markActorMigrationStarted({ id: 'local-move' })
        await database.updateActor({ actorId: ACTOR2_ID, movedTo: null })
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID,
          comment: 'some note'
        })

        await runJob(ACTOR1_ID, ACTOR2_ID, TARGET, 'local-move')

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toContain('some note')
      })

      it('does nothing when the local move was deleted before it started', async () => {
        await recordLocalMove()
        await database.updateActor({ actorId: ACTOR2_ID, movedTo: null })
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID,
          comment: 'some note'
        })

        await runJob(ACTOR1_ID, ACTOR2_ID, TARGET, 'local-move')

        expect(
          await database.getAccountNote({
            actorId: ACTOR1_ID,
            targetActorId: TARGET
          })
        ).toBe('')
      })

      it('does nothing if local origin has not moved to the target', async () => {
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR2_ID,
          comment: 'some note'
        })

        await runJob(ACTOR1_ID, ACTOR2_ID, TARGET, 'local-move')

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe('')
      })

      it('does nothing if target is deleted', async () => {
        await database.scheduleActorDeletion({
          actorId: TARGET,
          scheduledAt: null
        })
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'some note'
        })

        await runJob()

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe('')
      })

      it('does nothing if target is suspended', async () => {
        vi.spyOn(database, 'getModerationStatesForActors').mockResolvedValue(
          new Map([
            [
              TARGET,
              { suspendedAt: Date.now(), silencedAt: null, sensitizedAt: null }
            ]
          ])
        )
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'some note'
        })

        await runJob()

        const note = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        expect(note).toBe('')
      })
    })

    describe('idempotency of entire job', () => {
      it('rerun produces no duplicates and preserves state', async () => {
        await database.upsertAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          comment: 'Note on origin'
        })
        await applyBlock({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          uri: `${ACTOR1_ID}#blocks/origin`
        })
        await applyMute({
          database,
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN,
          notifications: false,
          endsAt: null
        })

        await runJob()
        const note1 = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        const block1 = await database.getBlock({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        const mute1 = await database.getMute({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })

        mockPublish.mockClear()
        await runJob()

        const note2 = await database.getAccountNote({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        const block2 = await database.getBlock({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
        const mute2 = await database.getMute({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })

        expect(note2).toBe(note1)
        expect(block2?.uri).toBe(block1?.uri)
        expect(mute2?.notifications).toBe(mute1?.notifications)
      })
    })
  })
})
