import { getNote } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusPoll, StatusType } from '@/lib/types/domain/status'

import {
  resetSyncRemotePollStateForTesting,
  syncRemotePoll
} from './syncRemotePoll'

vi.mock('@/lib/activities', () => ({
  getNote: vi.fn()
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi
    .fn()
    .mockResolvedValue({ id: 'https://local.test/actor' })
}))

const mockDatabase = {
  updatePoll: vi.fn()
} as unknown as Database

const remotePollStatus: StatusPoll = {
  id: 'https://remote.test/polls/1',
  url: 'https://remote.test/polls/1',
  actorId: 'https://remote.test/actors/user',
  actor: null,
  isLocalActor: false,
  type: StatusType.enum.Poll,
  text: '<p>Favorite color?</p>',
  summary: '',
  language: 'en',
  detectedLanguage: null,
  to: ['https://www.w3.org/ns/activitystreams#Public'],
  cc: [],
  edits: [],
  reply: '',
  replies: [],
  attachments: [],
  tags: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  choices: [
    {
      statusId: 'https://remote.test/polls/1',
      title: 'Red',
      totalVotes: 0,
      createdAt: 1000,
      updatedAt: 1000
    },
    {
      statusId: 'https://remote.test/polls/1',
      title: 'Blue',
      totalVotes: 0,
      createdAt: 1000,
      updatedAt: 1000
    }
  ],
  endAt: 200000,
  pollType: 'oneOf',
  hideTotals: false,
  votersCount: 0,
  voted: false,
  ownVotes: [],
  createdAt: 1000,
  updatedAt: 1000
}

describe('syncRemotePoll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSyncRemotePollStateForTesting()
  })

  it('skips non-poll statuses', async () => {
    const nonPoll = {
      ...remotePollStatus,
      type: StatusType.enum.Note
    } as unknown as Status
    const result = await syncRemotePoll({
      database: mockDatabase,
      status: nonPoll
    })
    expect(result).toBe(nonPoll)
    expect(getNote).not.toHaveBeenCalled()
  })

  it('skips local poll statuses', async () => {
    const localPoll = { ...remotePollStatus, isLocalActor: true }
    const result = await syncRemotePoll({
      database: mockDatabase,
      status: localPoll
    })
    expect(result).toBe(localPoll)
    expect(getNote).not.toHaveBeenCalled()
  })

  it('fetches remote Question and updates choices and vote counts', async () => {
    const remoteQuestion = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: remotePollStatus.id,
      type: 'Question',
      attributedTo: remotePollStatus.actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      content: '<p>Favorite color?</p>',
      published: '2026-08-31T00:00:00Z',
      endTime: '2026-09-05T00:00:00Z',
      oneOf: [
        {
          type: 'Note',
          name: 'Red',
          replies: { type: 'Collection', totalItems: 42 }
        },
        {
          type: 'Note',
          name: 'Blue',
          replies: { type: 'Collection', totalItems: 58 }
        }
      ]
    }
    ;(getNote as jest.Mock).mockResolvedValue(remoteQuestion)

    const updatedStatus = {
      ...remotePollStatus,
      choices: [
        { ...remotePollStatus.choices[0], totalVotes: 42 },
        { ...remotePollStatus.choices[1], totalVotes: 58 }
      ]
    }
    ;(mockDatabase.updatePoll as jest.Mock).mockResolvedValue(updatedStatus)

    const result = await syncRemotePoll({
      database: mockDatabase,
      status: remotePollStatus
    })

    expect(getNote).toHaveBeenCalledWith({
      statusId: remotePollStatus.id,
      signingActor: { id: 'https://local.test/actor' }
    })
    expect(mockDatabase.updatePoll).toHaveBeenCalledWith({
      statusId: remotePollStatus.id,
      summary: '',
      text: '<p>Favorite color?</p>',
      choices: [
        { title: 'Red', totalVotes: 42 },
        { title: 'Blue', totalVotes: 58 }
      ],
      endAt: new Date('2026-09-05T00:00:00Z').getTime()
    })
    expect(result).toEqual(updatedStatus)
  })

  it('handles multiple-choice anyOf polls correctly', async () => {
    const remoteQuestion = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: remotePollStatus.id,
      type: 'Question',
      attributedTo: remotePollStatus.actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      content: '<p>Select features</p>',
      published: '2026-08-31T00:00:00Z',
      endTime: '2026-09-05T00:00:00Z',
      anyOf: [
        {
          type: 'Note',
          name: 'Feature A',
          replies: { type: 'Collection', totalItems: 10 }
        },
        {
          type: 'Note',
          name: 'Feature B',
          replies: { type: 'Collection', totalItems: 20 }
        }
      ]
    }
    ;(getNote as jest.Mock).mockResolvedValue(remoteQuestion)

    const updatedStatus = {
      ...remotePollStatus,
      pollType: 'anyOf',
      choices: [
        { ...remotePollStatus.choices[0], title: 'Feature A', totalVotes: 10 },
        { ...remotePollStatus.choices[1], title: 'Feature B', totalVotes: 20 }
      ]
    }
    ;(mockDatabase.updatePoll as jest.Mock).mockResolvedValue(updatedStatus)

    const result = await syncRemotePoll({
      database: mockDatabase,
      status: remotePollStatus
    })

    expect(mockDatabase.updatePoll).toHaveBeenCalledWith({
      statusId: remotePollStatus.id,
      summary: '',
      text: '<p>Select features</p>',
      choices: [
        { title: 'Feature A', totalVotes: 10 },
        { title: 'Feature B', totalVotes: 20 }
      ],
      endAt: new Date('2026-09-05T00:00:00Z').getTime()
    })
    expect(result).toEqual(updatedStatus)
  })

  it('deduplicates concurrent sync requests for the same poll', async () => {
    let resolveRemoteFetch!: (value: unknown) => void
    const remoteFetchPromise = new Promise((resolve) => {
      resolveRemoteFetch = resolve
    })
    ;(getNote as jest.Mock).mockImplementation(() => remoteFetchPromise)

    const sync1 = syncRemotePoll({
      database: mockDatabase,
      status: remotePollStatus,
      signingActor: { id: 'https://local.test/actor' } as unknown as Actor
    })
    const sync2 = syncRemotePoll({
      database: mockDatabase,
      status: remotePollStatus,
      signingActor: { id: 'https://local.test/actor' } as unknown as Actor
    })

    expect(getNote).toHaveBeenCalledTimes(1)

    const remoteQuestion = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: remotePollStatus.id,
      type: 'Question',
      attributedTo: remotePollStatus.actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      content: '<p>Favorite color?</p>',
      published: '2026-08-31T00:00:00Z',
      oneOf: [
        {
          type: 'Note',
          name: 'Red',
          replies: { type: 'Collection', totalItems: 1 }
        },
        {
          type: 'Note',
          name: 'Blue',
          replies: { type: 'Collection', totalItems: 2 }
        }
      ]
    }
    ;(mockDatabase.updatePoll as jest.Mock).mockResolvedValue({
      ...remotePollStatus,
      choices: [
        { ...remotePollStatus.choices[0], totalVotes: 1 },
        { ...remotePollStatus.choices[1], totalVotes: 2 }
      ]
    })

    resolveRemoteFetch(remoteQuestion)
    const [res1, res2] = await Promise.all([sync1, sync2])
    expect(res1).toEqual(res2)
  })

  it('refuses a remote poll document that claims a different status id', async () => {
    // A hostile server answering this poll's own URL names a status it does
    // not own. `updatePoll` filters on nothing but `id`, so trusting the
    // document's self-reported id would rewrite that status's text, spoiler
    // and choice tallies and record a `status_history` revision for it.
    const victimStatusId = 'https://test.llun.dev/users/alice/statuses/1'
    ;(getNote as jest.Mock).mockResolvedValue({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: victimStatusId,
      type: 'Question',
      attributedTo: remotePollStatus.actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      content: '<p>Defaced</p>',
      published: '2026-08-31T00:00:00Z',
      oneOf: [
        {
          type: 'Note',
          name: 'Owned',
          replies: { type: 'Collection', totalItems: 99 }
        }
      ]
    })

    const result = await syncRemotePoll({
      database: mockDatabase,
      status: remotePollStatus
    })

    expect(mockDatabase.updatePoll).not.toHaveBeenCalled()
    expect(result).toBe(remotePollStatus)
  })

  it('cools down after refusing a mismatched remote poll document', async () => {
    ;(getNote as jest.Mock).mockResolvedValue({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://test.llun.dev/users/alice/statuses/2',
      type: 'Question',
      attributedTo: remotePollStatus.actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      content: '<p>Defaced</p>',
      published: '2026-08-31T00:00:00Z',
      oneOf: [
        {
          type: 'Note',
          name: 'Owned',
          replies: { type: 'Collection', totalItems: 99 }
        }
      ]
    })

    await syncRemotePoll({ database: mockDatabase, status: remotePollStatus })
    await syncRemotePoll({ database: mockDatabase, status: remotePollStatus })

    expect(getNote).toHaveBeenCalledTimes(1)
    expect(mockDatabase.updatePoll).not.toHaveBeenCalled()
  })

  it('accepts a remote poll document whose id differs only by host casing', async () => {
    // The guard normalizes both sides, so a benign serialization difference
    // must still sync — and must write to the row we asked about.
    ;(getNote as jest.Mock).mockResolvedValue({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://REMOTE.test/polls/1',
      type: 'Question',
      attributedTo: remotePollStatus.actorId,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [],
      content: '<p>Favorite color?</p>',
      published: '2026-08-31T00:00:00Z',
      oneOf: [
        {
          type: 'Note',
          name: 'Red',
          replies: { type: 'Collection', totalItems: 7 }
        }
      ]
    })
    ;(mockDatabase.updatePoll as jest.Mock).mockResolvedValue(remotePollStatus)

    await syncRemotePoll({ database: mockDatabase, status: remotePollStatus })

    expect(mockDatabase.updatePoll).toHaveBeenCalledWith(
      expect.objectContaining({ statusId: remotePollStatus.id })
    )
  })

  it('falls back to existing status on remote fetch failure and cools down', async () => {
    ;(getNote as jest.Mock).mockRejectedValueOnce(new Error('Network failure'))

    const res1 = await syncRemotePoll({
      database: mockDatabase,
      status: remotePollStatus
    })
    expect(res1).toBe(remotePollStatus)

    // Second call inside cooldown should not invoke getNote again
    const res2 = await syncRemotePoll({
      database: mockDatabase,
      status: remotePollStatus
    })
    expect(res2).toBe(remotePollStatus)
    expect(getNote).toHaveBeenCalledTimes(1)
  })
})
