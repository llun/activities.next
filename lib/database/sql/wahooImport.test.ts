import { Knex } from 'knex'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('Wahoo import database operations', () => {
  let database: Database
  let instance: Knex
  const actorId = DatabaseSeed.actors.primary.id
  const providerUserId = 'wahoo-import-user'

  beforeAll(async () => {
    const testDatabase = getTestSQLDatabaseWithInstance()
    database = testDatabase.database
    instance = testDatabase.instance
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('upserts a workout for its actor and provider user', async () => {
    const first = await database.upsertWahooImport({
      actorId,
      providerUserId,
      workoutId: 'workout-1',
      summaryId: 'summary-1',
      summaryUpdatedAt: Date.parse('2026-09-20T12:00:00.000Z')
    })
    const duplicate = await database.upsertWahooImport({
      actorId,
      providerUserId,
      workoutId: 'workout-1',
      summaryId: 'summary-2'
    })
    const otherProviderUser = await database.upsertWahooImport({
      actorId,
      providerUserId: 'another-wahoo-user',
      workoutId: 'workout-1'
    })

    expect(duplicate.id).toBe(first.id)
    expect(duplicate.summaryId).toBe('summary-1')
    expect(otherProviderUser.id).not.toBe(first.id)

    await database.updateWahooImport(first.id, {
      status: 'running',
      attempts: 1
    })
    expect(await database.getWahooImport(first.id)).toMatchObject({
      status: 'running',
      attempts: 1
    })

    await database.markWahooImportFailed(
      first.id,
      'failed',
      'temporary failure'
    )
    expect(await database.markWahooImportPending(first.id)).toBe(true)
    expect(await database.getWahooImport(first.id)).toMatchObject({
      status: 'pending',
      lastError: undefined
    })
    expect(await database.markWahooImportPending(first.id)).toBe(false)

    await database.updateWahooImport(first.id, { status: 'completed' })
    await database.markWahooImportFailed(first.id, 'failed', 'late failure')
    expect(await database.getWahooImport(first.id)).toMatchObject({
      status: 'completed',
      lastError: undefined
    })
  })

  it('tracks history scan progress and item counts', async () => {
    const history = await database.createWahooHistoryImport({
      actorId,
      providerUserId,
      fromDate: '2026-01-01',
      toDate: '2026-01-31'
    })
    await database.upsertWahooImport({
      actorId,
      providerUserId,
      workoutId: 'history-workout-1',
      historyImportId: history.id
    })
    const failed = await database.upsertWahooImport({
      actorId,
      providerUserId,
      workoutId: 'history-workout-2',
      historyImportId: history.id
    })
    const completed = await database.upsertWahooImport({
      actorId,
      providerUserId,
      workoutId: 'history-workout-3',
      historyImportId: history.id
    })

    await database.markWahooImportFailed(
      failed.id,
      'unsupported',
      'unsupported'
    )
    await database.updateWahooImport(completed.id, { status: 'completed' })
    await database.updateWahooHistoryImport(history.id, {
      nextPage: 4,
      scanComplete: true,
      total: 3,
      completed: 1,
      failed: 1,
      status: 'running'
    })

    expect(await database.getLatestWahooHistoryImport(actorId)).toMatchObject({
      id: history.id,
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
      nextPage: 4,
      scanComplete: true,
      total: 3,
      completed: 1,
      failed: 1,
      status: 'running'
    })
    expect(
      await database.getWahooImportsByHistory(history.id, ['completed'])
    ).toHaveLength(1)
    expect(await database.countWahooHistoryItems(history.id)).toEqual({
      total: 3,
      completed: 1,
      failed: 1,
      pending: 1
    })
  })

  it('clears fitness file and status references when their rows are deleted', async () => {
    const statusId = DatabaseSeed.statuses.primary.post
    const file = await database.createFitnessFile({
      actorId,
      statusId,
      path: 'fitness/wahoo-import-tombstone.fit',
      fileName: 'wahoo-import-tombstone.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 512
    })
    const imported = await database.upsertWahooImport({
      actorId,
      providerUserId,
      workoutId: 'tombstone-workout'
    })
    await database.updateWahooImport(imported.id, {
      fitnessFileId: file!.id,
      statusId
    })

    expect(await database.deleteFitnessFile({ id: file!.id })).toBe(true)
    await instance('fitness_files').where({ id: file!.id }).delete()
    expect(await database.getWahooImport(imported.id)).toMatchObject({
      fitnessFileId: undefined,
      statusId
    })

    await database.deleteStatus({ actorId, statusId })
    expect(await database.getWahooImport(imported.id)).toMatchObject({
      fitnessFileId: undefined,
      statusId: undefined
    })
  })
})
