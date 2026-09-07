import { describe, expect, it } from 'vitest'

import {
  Status,
  StatusAnnounce,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'

import { removeOriginalStatus, updateMatchingStatus } from './statusArray'

const now = new Date('2026-04-30T10:00:00.000Z').getTime()

const createNoteStatus = (
  id: string,
  overrides: Partial<StatusNote> = {}
): StatusNote => ({
  id,
  actorId: 'https://remote.example/users/actor',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: now,
  updatedAt: now,
  type: StatusType.enum.Note,
  url: id,
  text: `Content for ${id}`,
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
})

const createPollStatus = (
  id: string,
  overrides: Partial<StatusPoll> = {}
): StatusPoll => ({
  ...createNoteStatus(id),
  type: StatusType.enum.Poll,
  choices: [
    {
      statusId: id,
      title: 'Option 1',
      totalVotes: 0,
      createdAt: now,
      updatedAt: now
    },
    {
      statusId: id,
      title: 'Option 2',
      totalVotes: 0,
      createdAt: now,
      updatedAt: now
    }
  ],
  endAt: now + 86400000,
  pollType: 'oneOf',
  ...overrides
})

const createAnnounceStatus = (
  id: string,
  originalStatus: Status,
  overrides: Partial<StatusAnnounce> = {}
): StatusAnnounce => ({
  id,
  actorId: 'https://remote.example/users/booster',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: now + 1000,
  updatedAt: now + 1000,
  type: StatusType.enum.Announce,
  originalStatus,
  ...overrides
})

describe('updateMatchingStatus', () => {
  it('updates a direct Note match and preserves untouched row references', () => {
    const note1 = createNoteStatus('https://example.com/notes/1')
    const note2 = createNoteStatus('https://example.com/notes/2')
    const note3 = createNoteStatus('https://example.com/notes/3')
    const statuses: Status[] = [note1, note2, note3]

    const result = updateMatchingStatus(
      statuses,
      'https://example.com/notes/2',
      (target) => ({
        ...target,
        isActorLiked: true,
        totalLikes: target.totalLikes + 1
      })
    )

    expect(result).toHaveLength(3)
    expect(result[0]).toBe(note1)
    expect(result[2]).toBe(note3)
    expect(result[1]).not.toBe(note2)
    expect((result[1] as StatusNote).isActorLiked).toBe(true)
    expect((result[1] as StatusNote).totalLikes).toBe(1)
  })

  it('updates a direct Poll match', () => {
    const poll = createPollStatus('https://example.com/polls/1')
    const statuses: Status[] = [poll]

    const result = updateMatchingStatus(
      statuses,
      'https://example.com/polls/1',
      (target) => ({
        ...target,
        isActorBookmarked: true
      })
    )

    expect((result[0] as StatusPoll).isActorBookmarked).toBe(true)
    expect(result[0].id).toBe('https://example.com/polls/1')
  })

  it('updates a wrapped original in an Announce status while preserving wrapper metadata', () => {
    const original = createNoteStatus('https://example.com/notes/1')
    const boost = createAnnounceStatus(
      'https://example.com/boosts/1',
      original,
      {
        actorId: 'https://remote.example/users/booster-unique',
        createdAt: now + 5000,
        updatedAt: now + 6000
      }
    )
    const unrelated = createNoteStatus('https://example.com/notes/2')
    const statuses: Status[] = [boost, unrelated]

    const result = updateMatchingStatus(
      statuses,
      'https://example.com/notes/1',
      (target) => ({
        ...target,
        isActorLiked: true
      })
    )

    expect(result).toHaveLength(2)
    expect(result[1]).toBe(unrelated)

    const updatedBoost = result[0] as StatusAnnounce
    expect(updatedBoost.id).toBe('https://example.com/boosts/1')
    expect(updatedBoost.actorId).toBe(
      'https://remote.example/users/booster-unique'
    )
    expect(updatedBoost.createdAt).toBe(now + 5000)
    expect(updatedBoost.updatedAt).toBe(now + 6000)
    expect(updatedBoost.type).toBe(StatusType.enum.Announce)
    expect((updatedBoost.originalStatus as StatusNote).isActorLiked).toBe(true)
  })

  it('updates repeated representations of one original (direct note and multiple boosts)', () => {
    const original = createNoteStatus('https://example.com/notes/shared')
    const boost1 = createAnnounceStatus(
      'https://example.com/boosts/1',
      original
    )
    const boost2 = createAnnounceStatus(
      'https://example.com/boosts/2',
      original
    )
    const other = createNoteStatus('https://example.com/notes/other')
    const statuses: Status[] = [boost1, other, original, boost2]

    const result = updateMatchingStatus(
      statuses,
      'https://example.com/notes/shared',
      (target) => ({
        ...target,
        isActorBookmarked: true
      })
    )

    expect(result).toHaveLength(4)
    expect(result[1]).toBe(other)
    expect(
      ((result[0] as StatusAnnounce).originalStatus as StatusNote)
        .isActorBookmarked
    ).toBe(true)
    expect((result[2] as StatusNote).isActorBookmarked).toBe(true)
    expect(
      ((result[3] as StatusAnnounce).originalStatus as StatusNote)
        .isActorBookmarked
    ).toBe(true)
  })

  it('returns untouched array reference when no status matches', () => {
    const note = createNoteStatus('https://example.com/notes/1')
    const boost = createAnnounceStatus(
      'https://example.com/boosts/1',
      createNoteStatus('https://example.com/notes/2')
    )
    const statuses: Status[] = [note, boost]

    const result = updateMatchingStatus(
      statuses,
      'https://example.com/notes/nonexistent',
      (target) => ({ ...target, isActorLiked: true })
    )

    expect(result).toBe(statuses)
  })

  it('preserves input immutability when input array and statuses are frozen', () => {
    const original = Object.freeze(
      createNoteStatus('https://example.com/notes/1')
    )
    const boost = Object.freeze(
      createAnnounceStatus('https://example.com/boosts/1', original)
    )
    const statuses = Object.freeze([boost, original]) as unknown as Status[]

    expect(() => {
      const result = updateMatchingStatus(
        statuses,
        'https://example.com/notes/1',
        (target) => ({ ...target, isActorLiked: true })
      )
      expect(result).toHaveLength(2)
      expect(
        ((result[0] as StatusAnnounce).originalStatus as StatusNote)
          .isActorLiked
      ).toBe(true)
      expect((result[1] as StatusNote).isActorLiked).toBe(true)
    }).not.toThrow()
  })
})

describe('removeOriginalStatus', () => {
  it('removes a direct Note by status id string', () => {
    const note1 = createNoteStatus('https://example.com/notes/1')
    const note2 = createNoteStatus('https://example.com/notes/2')
    const statuses: Status[] = [note1, note2]

    const result = removeOriginalStatus(statuses, 'https://example.com/notes/1')

    expect(result).toHaveLength(1)
    expect(result[0]).toBe(note2)
  })

  it('removes a direct Note by object with id property', () => {
    const note1 = createNoteStatus('https://example.com/notes/1')
    const note2 = createNoteStatus('https://example.com/notes/2')
    const statuses: Status[] = [note1, note2]

    const result = removeOriginalStatus(statuses, note1)

    expect(result).toHaveLength(1)
    expect(result[0]).toBe(note2)
  })

  it('removes a wrapped Announce status when deleting by original status identity', () => {
    const original = createNoteStatus('https://example.com/notes/target')
    const boost = createAnnounceStatus('https://example.com/boosts/1', original)
    const other = createNoteStatus('https://example.com/notes/other')
    const statuses: Status[] = [boost, other]

    const result = removeOriginalStatus(
      statuses,
      'https://example.com/notes/target'
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toBe(other)
  })

  it('removes repeated representations of one original (direct post and multiple boosts)', () => {
    const original = createNoteStatus('https://example.com/notes/target')
    const boost1 = createAnnounceStatus(
      'https://example.com/boosts/1',
      original
    )
    const boost2 = createAnnounceStatus(
      'https://example.com/boosts/2',
      original
    )
    const remaining1 = createNoteStatus('https://example.com/notes/rem-1')
    const remaining2 = createNoteStatus('https://example.com/notes/rem-2')
    const statuses: Status[] = [
      remaining1,
      boost1,
      original,
      remaining2,
      boost2
    ]

    const result = removeOriginalStatus(
      statuses,
      'https://example.com/notes/target'
    )

    expect(result).toEqual([remaining1, remaining2])
    expect(result[0]).toBe(remaining1)
    expect(result[1]).toBe(remaining2)
  })

  it('removes an Announce status directly by its own boost id', () => {
    const original = createNoteStatus('https://example.com/notes/target')
    const boost = createAnnounceStatus('https://example.com/boosts/1', original)
    const statuses: Status[] = [boost, original]

    const result = removeOriginalStatus(
      statuses,
      'https://example.com/boosts/1'
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toBe(original)
  })

  it('returns untouched array reference when no status matches', () => {
    const note = createNoteStatus('https://example.com/notes/1')
    const statuses: Status[] = [note]

    const result = removeOriginalStatus(
      statuses,
      'https://example.com/notes/nonexistent'
    )

    expect(result).toBe(statuses)
  })

  it('preserves input immutability when input array is frozen', () => {
    const note1 = Object.freeze(createNoteStatus('https://example.com/notes/1'))
    const note2 = Object.freeze(createNoteStatus('https://example.com/notes/2'))
    const statuses = Object.freeze([note1, note2]) as unknown as Status[]

    expect(() => {
      const result = removeOriginalStatus(
        statuses,
        'https://example.com/notes/1'
      )
      expect(result).toEqual([note2])
    }).not.toThrow()
  })
})
