import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('FitnessFileDatabase', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    describe('createFitnessFile', () => {
      it('creates a fitness file record', async () => {
        const fitnessFile = await database.createFitnessFile({
          id: 'test-fitness-file-1',
          actorId: actors.primary.id,
          provider: 'strava',
          providerId: 'prov-12345',
          activityType: 'Run',
          filePath: 'fitness/test/activity.json',
          iconPath: 'fitness/test/activity.png',
          fileBytes: 1024,
          iconBytes: 512
        })

        expect(fitnessFile).toBeDefined()
        expect(fitnessFile?.id).toBeDefined()
        expect(fitnessFile?.actorId).toBe(actors.primary.id)
        expect(fitnessFile?.provider).toBe('strava')
        expect(fitnessFile?.providerId).toBe('prov-12345')
        expect(fitnessFile?.activityType).toBe('Run')
        expect(fitnessFile?.filePath).toBe('fitness/test/activity.json')
        expect(fitnessFile?.iconPath).toBe('fitness/test/activity.png')
        expect(fitnessFile?.fileBytes).toBe(1024)
        expect(fitnessFile?.iconBytes).toBe(512)
      })

      it('creates fitness file with statusId', async () => {
        // Get an existing status
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 1
        })
        expect(statuses.length).toBeGreaterThan(0)

        const fitnessFile = await database.createFitnessFile({
          id: 'test-fitness-file-with-status',
          actorId: actors.primary.id,
          statusId: statuses[0].id,
          provider: 'strava',
          providerId: 'prov-67890',
          activityType: 'Ride',
          filePath: 'fitness/test/ride.json',
          iconPath: 'fitness/test/ride.png',
          fileBytes: 2048,
          iconBytes: 768
        })

        expect(fitnessFile).toBeDefined()
        expect(fitnessFile?.statusId).toBe(statuses[0].id)
      })
    })

    describe('getFitnessFile', () => {
      it('retrieves fitness file by provider and providerId', async () => {
        const created = await database.createFitnessFile({
          id: 'test-get-fitness-file',
          actorId: actors.primary.id,
          provider: 'strava',
          providerId: 'test-get-123',
          activityType: 'Swim',
          filePath: 'fitness/test/swim.json',
          iconPath: 'fitness/test/swim.png',
          fileBytes: 512,
          iconBytes: 256
        })

        const retrieved = await database.getFitnessFile({
          provider: 'strava',
          providerId: 'test-get-123',
          actorId: actors.primary.id
        })

        expect(retrieved).toBeDefined()
        expect(retrieved?.id).toBe(created!.id)
        expect(retrieved?.activityType).toBe('Swim')
      })

      it('returns null for non-existent fitness file', async () => {
        const nonExistent = await database.getFitnessFile({
          provider: 'strava',
          providerId: 'does-not-exist-unique',
          actorId: actors.primary.id
        })

        expect(nonExistent).toBeNull()
      })
    })

    describe('getFitnessFilesForActor', () => {
      it('returns all fitness files for an actor', async () => {
        // Create multiple fitness files
        await database.createFitnessFile({
          id: 'test-multi-file-1',
          actorId: actors.replyAuthor.id,
          provider: 'strava',
          providerId: 'multi-file-1',
          activityType: 'Run',
          filePath: 'fitness/test/run1.json',
          iconPath: 'fitness/test/run1.png',
          fileBytes: 1024,
          iconBytes: 512
        })

        await database.createFitnessFile({
          id: 'test-multi-file-2',
          actorId: actors.replyAuthor.id,
          provider: 'strava',
          providerId: 'multi-file-2',
          activityType: 'Ride',
          filePath: 'fitness/test/ride1.json',
          iconPath: 'fitness/test/ride1.png',
          fileBytes: 2048,
          iconBytes: 768
        })

        const files = await database.getFitnessFilesForActor({
          actorId: actors.replyAuthor.id
        })

        expect(files.length).toBeGreaterThanOrEqual(2)
        expect(files.some((f) => f.providerId === 'multi-file-1')).toBe(true)
        expect(files.some((f) => f.providerId === 'multi-file-2')).toBe(true)
      })

      it('returns empty array for actor with no fitness files', async () => {
        const files = await database.getFitnessFilesForActor({
          actorId: actors.empty.id
        })

        expect(files).toBeArray()
      })

      it('respects limit parameter', async () => {
        // Create 5 fitness files
        for (let i = 0; i < 5; i++) {
          await database.createFitnessFile({
            id: `test-limit-${i}`,
            actorId: actors.pollAuthor.id,
            provider: 'strava',
            providerId: `limit-test-${i}`,
            activityType: 'Run',
            filePath: `fitness/test/run-${i}.json`,
            iconPath: `fitness/test/run-${i}.png`,
            fileBytes: 1024,
            iconBytes: 512
          })
        }

        const files = await database.getFitnessFilesForActor({
          actorId: actors.pollAuthor.id,
          limit: 3
        })

        expect(files.length).toBeLessThanOrEqual(3)
      })
    })

    describe('getFitnessStorageUsage', () => {
      it('calculates total fitness storage usage for actor', async () => {
        // Create fitness files with known sizes
        await database.createFitnessFile({
          id: 'usage-test-1',
          actorId: actors.extra.id,
          provider: 'strava',
          providerId: 'usage-prov-1',
          activityType: 'Run',
          filePath: 'fitness/test/usage1.json',
          iconPath: 'fitness/test/usage1.png',
          fileBytes: 1000,
          iconBytes: 500
        })

        await database.createFitnessFile({
          id: 'usage-test-2',
          actorId: actors.extra.id,
          provider: 'strava',
          providerId: 'usage-prov-2',
          activityType: 'Ride',
          filePath: 'fitness/test/usage2.json',
          iconPath: 'fitness/test/usage2.png',
          fileBytes: 2000,
          iconBytes: 800
        })

        const usage = await database.getFitnessStorageUsage({
          actorId: actors.extra.id
        })

        // Total should be at least 1000 + 500 + 2000 + 800 = 4300
        expect(usage).toBeGreaterThanOrEqual(4300)
      })

      it('returns 0 for actor with no fitness files', async () => {
        const usage = await database.getFitnessStorageUsage({
          actorId: actors.followRequester.id
        })

        expect(usage).toBe(0)
      })
    })

    describe('deleteFitnessFile', () => {
      it('deletes fitness file record', async () => {
        const created = await database.createFitnessFile({
          id: 'test-delete-file',
          actorId: actors.primary.id,
          provider: 'strava',
          providerId: 'delete-test-prov',
          activityType: 'Run',
          filePath: 'fitness/test/delete.json',
          iconPath: 'fitness/test/delete.png',
          fileBytes: 1024,
          iconBytes: 512
        })

        expect(created).toBeDefined()

        await database.deleteFitnessFile({
          id: created!.id,
          actorId: actors.primary.id
        })

        const retrieved = await database.getFitnessFile({
          provider: 'strava',
          providerId: 'delete-test-prov',
          actorId: actors.primary.id
        })

        expect(retrieved).toBeNull()
      })
    })

    describe('cascade deletion with status', () => {
      it('deletes fitness file when associated status is deleted', async () => {
        // Get an existing status from the seed data
        const statuses = await database.getActorStatuses({
          actorId: actors.primary.id,
          limit: 1
        })
        expect(statuses.length).toBeGreaterThan(0)
        const status = statuses[0]

        // Create fitness file linked to status
        const fitnessFile = await database.createFitnessFile({
          id: 'test-cascade-delete',
          actorId: actors.primary.id,
          statusId: status.id,
          provider: 'strava',
          providerId: 'cascade-test-prov',
          activityType: 'Run',
          filePath: 'fitness/test/cascade.json',
          iconPath: 'fitness/test/cascade.png',
          fileBytes: 1024,
          iconBytes: 512
        })

        expect(fitnessFile).toBeDefined()

        // Delete the status
        await database.deleteStatus({
          statusId: status.id
        })

        // Verify fitness file is also deleted due to cascade
        const retrievedFile = await database.getFitnessFile({
          provider: 'strava',
          providerId: 'cascade-test-prov',
          actorId: actors.primary.id
        })

        expect(retrievedFile).toBeNull()
      })
    })
  })
})
