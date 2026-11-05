import type { FitnessPersonalRecord } from '@/lib/database/domains/fitnessBestEffort/types'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import {
  getFitnessRecords,
  getPersonalRecordDurations,
  getRecordsRangeStart
} from './personalRecords'

const OTHER_ACTOR_ID = 'https://llun.test/users/other'
const STATUS_ID = `${ACTOR1_ID}/statuses/ride`

const note = (overrides: Partial<StatusNote> = {}): StatusNote =>
  ({
    id: STATUS_ID,
    publicId: '0190d8a6-7a3e-7cc1-8f2a-00000000000b',
    actorId: ACTOR1_ID,
    actor: {
      id: ACTOR1_ID,
      username: 'test1',
      domain: 'llun.test',
      followersUrl: `${ACTOR1_ID}/followers`,
      inboxUrl: `${ACTOR1_ID}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      followingCount: 0,
      followersCount: 0,
      statusCount: 0,
      lastStatusAt: null,
      createdAt: 1000
    },
    to: [],
    cc: [],
    edits: [],
    isLocalActor: true,
    createdAt: 1000,
    updatedAt: 1000,
    type: StatusType.enum.Note,
    url: STATUS_ID,
    text: '<p>Hill repeats</p>',
    summary: null,
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    ...overrides
  }) as StatusNote

const record = (
  overrides: Partial<FitnessPersonalRecord> = {}
): FitnessPersonalRecord => ({
  fitnessFileId: 'file-1',
  kind: 'power',
  key: 5,
  value: 950,
  statusId: STATUS_ID,
  activityDate: Date.UTC(2026, 5, 1),
  activityType: 'ride',
  description: null,
  fileName: 'ride.fit',
  ...overrides
})

describe('getRecordsRangeStart', () => {
  const now = Date.UTC(2026, 10, 5, 12)

  it('starts all time nowhere, a year on 1 January, 90 days back', () => {
    expect(getRecordsRangeStart('all', now)).toBeNull()
    expect(getRecordsRangeStart('year', now)).toBe(Date.UTC(2026, 0, 1))
    expect(getRecordsRangeStart('90d', now)).toBe(now - 90 * 86_400_000)
  })
})

describe('getFitnessRecords', () => {
  const database = {
    getFitnessPersonalRecords: vi.fn(),
    getStatusesByIds: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists every key with its activity, and nulls where nothing holds one', async () => {
    database.getFitnessPersonalRecords.mockResolvedValue([
      record(),
      record({ kind: 'distance', key: 5000, value: 1234.5 })
    ])
    database.getStatusesByIds.mockResolvedValue([note()])
    const now = Date.UTC(2026, 10, 5)

    const records = await getFitnessRecords(database, {
      actorId: ACTOR1_ID,
      range: 'year',
      now
    })

    expect(database.getFitnessPersonalRecords).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      since: Date.UTC(2026, 0, 1)
    })
    expect(records.range).toBe('year')
    expect(records.power.map((entry) => entry.key)).toEqual([
      5, 60, 300, 1200, 3600
    ])
    expect(records.power[0]).toEqual({
      key: 5,
      value: 950,
      activity: {
        statusId: STATUS_ID,
        statusPath: '/@test1@llun.test/0190d8a6-7a3e-7cc1-8f2a-00000000000b',
        title: 'Hill repeats',
        activityDate: Date.UTC(2026, 5, 1)
      }
    })
    expect(records.power[1]).toEqual({ key: 60, value: null, activity: null })
    expect(records.distance.map((entry) => entry.value)).toEqual([
      null,
      1234.5,
      null,
      null,
      null
    ])
  })

  it('never links a post that is not the actor’s own', async () => {
    database.getFitnessPersonalRecords.mockResolvedValue([record()])
    database.getStatusesByIds.mockResolvedValue([
      note({ actorId: OTHER_ACTOR_ID })
    ])

    const records = await getFitnessRecords(database, {
      actorId: ACTOR1_ID,
      range: 'all'
    })

    expect(database.getFitnessPersonalRecords).toHaveBeenCalledWith({
      actorId: ACTOR1_ID,
      since: null
    })
    expect(records.power[0]).toEqual({ key: 5, value: null, activity: null })
  })
})

describe('getPersonalRecordDurations', () => {
  const database = {
    getFitnessPersonalRecords: vi.fn(),
    getFitnessBestEfforts: vi.fn()
  }

  it('marks the durations where the file equals the all-time best', async () => {
    database.getFitnessPersonalRecords.mockResolvedValue([
      record({ key: 5, value: 950 }),
      record({ key: 60, value: 500, fitnessFileId: 'file-old' }),
      record({ kind: 'distance', key: 1000, value: 200 })
    ])
    database.getFitnessBestEfforts.mockResolvedValue([
      { fitnessFileId: 'file-1', kind: 'power', key: 5, value: 950 },
      { fitnessFileId: 'file-1', kind: 'power', key: 60, value: 480 },
      { fitnessFileId: 'file-2', kind: 'power', key: 60, value: 500 },
      { fitnessFileId: 'file-1', kind: 'distance', key: 1000, value: 200 }
    ])

    expect(
      await getPersonalRecordDurations(database, {
        actorId: ACTOR1_ID,
        fitnessFileIds: ['file-1', 'file-2']
      })
    ).toEqual({ 'file-1': [5], 'file-2': [60] })
    expect(database.getFitnessPersonalRecords).toHaveBeenCalledWith({
      actorId: ACTOR1_ID
    })
  })

  it('reads nothing for a post without files', async () => {
    database.getFitnessPersonalRecords.mockClear()
    expect(
      await getPersonalRecordDurations(database, {
        actorId: ACTOR1_ID,
        fitnessFileIds: []
      })
    ).toEqual({})
    expect(database.getFitnessPersonalRecords).not.toHaveBeenCalled()
  })
})
