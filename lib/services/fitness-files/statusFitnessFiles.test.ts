import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getStatusFitnessFiles } from './statusFitnessFiles'

describe('getStatusFitnessFiles', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('returns empty array when no fitness files exist', async () => {
    const files = await getStatusFitnessFiles(database, 'non-existent-status')
    expect(files).toEqual([])
  })

  it('returns and sorts fitness files with resolved gear names and summary metrics', async () => {
    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/test-multi-fitness-files`,
      url: `${ACTOR1_ID}/statuses/test-multi-fitness-files`,
      actorId: ACTOR1_ID,
      text: 'Multi-fitness file status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const file1 = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/part2.fit',
      fileName: 'part2.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    const file2 = await database.createFitnessFile({
      actorId: ACTOR1_ID,
      statusId: status.id,
      path: 'fitness/part1.fit',
      fileName: 'part1.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1_024
    })

    await database.updateFitnessFileActivityData(file1!.id, {
      activityStartTime: new Date('2026-05-01T10:00:00Z'),
      avgPower: 220,
      maxPower: 600,
      avgHeartRate: 150,
      maxHeartRate: 175,
      totalWorkKj: 500,
      elevationSeries: [100, 110]
    })

    await database.updateFitnessFileActivityData(file2!.id, {
      activityStartTime: new Date('2026-05-01T09:00:00Z'),
      avgPower: 200,
      maxPower: 550,
      avgHeartRate: 140,
      maxHeartRate: 165,
      totalWorkKj: 450,
      elevationSeries: [90, 100]
    })

    const items = await getStatusFitnessFiles(database, status.id)
    expect(items).toHaveLength(2)
    // Sorted by activityStartTime asc: part1 first, part2 second
    expect(items[0].id).toBe(file2!.id)
    expect(items[0].fileName).toBe('part1.fit')
    expect(items[0].avgPower).toBe(200)
    expect(items[0].elevationSeries).toEqual([90, 100])

    expect(items[1].id).toBe(file1!.id)
    expect(items[1].fileName).toBe('part2.fit')
    expect(items[1].avgPower).toBe(220)
    expect(items[1].elevationSeries).toEqual([100, 110])
  })
})
