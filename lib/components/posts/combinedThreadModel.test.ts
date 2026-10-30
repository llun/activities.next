import { describe, expect, it } from 'vitest'

import {
  BASE_TIME,
  createMockNote,
  createMockPhoto,
  createMockPoll,
  mockAlice,
  mockBob,
  mockCarol
} from '@/lib/components/posts/__fixtures__/timeline-context'
import {
  COMBINE_MAX_GAP_MS,
  CombinedBlock,
  buildCombinedBlocks,
  hasCombinedRun
} from '@/lib/components/posts/combinedThreadModel'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'

const MINUTE = 60 * 1000

const note = (
  name: string,
  options: {
    actor?: ActorProfile
    at: number
    reply?: string
    to?: string[]
    cc?: string[]
  } & Partial<StatusNote>
) => {
  const { actor = mockAlice, at, reply, ...rest } = options
  return createMockNote({
    id: `https://activities.local/users/${actor.username}/statuses/${name}`,
    actor,
    createdAt: BASE_TIME + at,
    reply: reply ?? '',
    text: name,
    ...rest
  })
}

// A compact shape for assertions: "a1+b1" is a run part with an inset.
const shape = (blocks: CombinedBlock[]) =>
  blocks.map((block) =>
    block.kind === 'post'
      ? block.status.id.split('/').pop()
      : block.parts
          .map((part) =>
            [part.status, ...part.insets]
              .map((status) => status.id.split('/').pop())
              .join('+')
          )
          .join(' > ')
  )

describe('buildCombinedBlocks', () => {
  it('combines quick self-replies into one run', () => {
    const a1 = note('a1', { at: 0 })
    const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })
    const a3 = note('a3', { at: 4 * MINUTE, reply: a2.id })

    const blocks = buildCombinedBlocks([a1, a2, a3])

    expect(shape(blocks)).toEqual(['a1 > a2 > a3'])
    expect(hasCombinedRun(blocks)).toBe(true)
    expect(blocks[0]).toMatchObject({ kind: 'run', key: `combined:${a1.id}` })
  })

  it('keeps a lone author post as a normal post', () => {
    const a1 = note('a1', { at: 0 })
    const blocks = buildCombinedBlocks([a1])

    expect(shape(blocks)).toEqual(['a1'])
    expect(hasCombinedRun(blocks)).toBe(false)
  })

  it('leaves a conversation without a self-reply uncombined', () => {
    const a1 = note('a1', { at: 0 })
    const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
    const c1 = note('c1', { actor: mockCarol, at: 2 * MINUTE, reply: b1.id })

    expect(shape(buildCombinedBlocks([a1, b1, c1]))).toEqual(['a1', 'b1', 'c1'])
  })

  describe('gap between neighbouring posts', () => {
    it.each([
      {
        description: 'exactly ten minutes combines',
        gap: COMBINE_MAX_GAP_MS,
        expected: ['a1 > a2']
      },
      {
        description: 'ten minutes and one millisecond splits',
        gap: COMBINE_MAX_GAP_MS + 1,
        expected: ['a1', 'a2']
      }
    ])('$description', ({ gap, expected }) => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: gap, reply: a1.id })

      expect(shape(buildCombinedBlocks([a1, a2]))).toEqual(expected)
    })

    it('measures each gap from the post before it, not from the first', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: 9 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 18 * MINUTE, reply: a2.id })

      expect(shape(buildCombinedBlocks([a1, a2, a3]))).toEqual(['a1 > a2 > a3'])
    })

    it('splits a run where one gap is too long and recombines the rest', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 30 * MINUTE, reply: a2.id })
      const a4 = note('a4', { at: 31 * MINUTE, reply: a3.id })

      expect(shape(buildCombinedBlocks([a1, a2, a3, a4]))).toEqual([
        'a1 > a2',
        'a3 > a4'
      ])
    })
  })

  it('splits where the visibility changes', () => {
    const unlisted = {
      to: [],
      cc: ['https://www.w3.org/ns/activitystreams#Public']
    }
    const a1 = note('a1', { at: 0 })
    const a2 = note('a2', { at: MINUTE, reply: a1.id, ...unlisted })
    const a3 = note('a3', { at: 2 * MINUTE, reply: a2.id, ...unlisted })

    expect(shape(buildCombinedBlocks([a1, a2, a3]))).toEqual(['a1', 'a2 > a3'])
  })

  it('splits where a post does not reply to the one before it', () => {
    const a1 = note('a1', { at: 0 })
    const a2 = note('a2', { at: MINUTE, reply: a1.id })
    const a3 = note('a3', { at: 2 * MINUTE, reply: a1.id })

    expect(shape(buildCombinedBlocks([a1, a2, a3]))).toEqual(['a1 > a2', 'a3'])
  })

  describe('replies by other people', () => {
    it('tucks one reply into the run, under the post it answers', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })

      const blocks = buildCombinedBlocks([a1, b1, a2])

      expect(shape(blocks)).toEqual(['a1+b1 > a2'])
      const run = blocks[0]
      expect(run.kind === 'run' && run.parts[0].insets).toEqual([b1])
    })

    it('keeps a reply listed in neverTuckIds a plain post instead of an inset', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })

      // Without the option the timeline tucks the reply into the run.
      expect(shape(buildCombinedBlocks([a1, b1, a2]))).toEqual(['a1+b1 > a2'])
      // With it, the reply stays a full row of its own.
      expect(
        shape(
          buildCombinedBlocks([a1, b1, a2], { neverTuckIds: new Set([b1.id]) })
        )
      ).toEqual(['a1', 'b1', 'a2'])
    })

    it('lets the author reply to the tucked-in reply', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const a2 = note('a2', { at: 2 * MINUTE, reply: b1.id })

      expect(shape(buildCombinedBlocks([a1, b1, a2]))).toEqual(['a1+b1 > a2'])
    })

    it('lets the author reply to a reply already committed to the run', () => {
      const a1 = note('a1', { at: 0 })
      const b = note('b', { actor: mockBob, at: MINUTE, reply: a1.id })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 3 * MINUTE, reply: b.id })

      expect(shape(buildCombinedBlocks([a1, b, a2, a3]))).toEqual([
        'a1+b > a2 > a3'
      ])
    })

    it("measures the author's next post from the post it answers, not from a waiting reply", () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: 5 * MINUTE, reply: a1.id })
      const b1 = note('b1', { actor: mockBob, at: 14 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 23 * MINUTE, reply: a2.id })

      // a3 is 9 minutes after b1 but 18 after a2, the post it answers.
      expect(shape(buildCombinedBlocks([a1, a2, b1, a3]))).toEqual([
        'a1 > a2',
        'b1',
        'a3'
      ])
    })

    it('still combines an author reply to a tucked-in reply within the gap', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: 9 * MINUTE, reply: a1.id })
      const a2 = note('a2', { at: 18 * MINUTE, reply: b1.id })

      expect(shape(buildCombinedBlocks([a1, b1, a2]))).toEqual(['a1+b1 > a2'])
    })

    it('tucks up to two replies', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const c1 = note('c1', { actor: mockCarol, at: 2 * MINUTE, reply: a1.id })
      const a2 = note('a2', { at: 3 * MINUTE, reply: a1.id })

      expect(shape(buildCombinedBlocks([a1, b1, c1, a2]))).toEqual([
        'a1+b1+c1 > a2'
      ])
    })

    it('splits the run when a third reply comes in', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const c1 = note('c1', { actor: mockCarol, at: 2 * MINUTE, reply: a1.id })
      const b2 = note('b2', { actor: mockBob, at: 3 * MINUTE, reply: a1.id })
      const a2 = note('a2', { at: 4 * MINUTE, reply: a1.id })

      const blocks = buildCombinedBlocks([a1, b1, c1, b2, a2])

      expect(hasCombinedRun(blocks)).toBe(false)
      expect(shape(blocks)).toEqual(['a1', 'b1', 'c1', 'b2', 'a2'])
    })

    it('splits the run around a reply with media', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const withPhoto = {
        ...b1,
        attachments: [createMockPhoto(b1, 'photo')]
      } as StatusNote
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 3 * MINUTE, reply: a2.id })

      expect(shape(buildCombinedBlocks([a1, withPhoto, a2, a3]))).toEqual([
        'a1',
        'b1',
        'a2 > a3'
      ])
    })

    it('splits the run around a reply that is a poll', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = createMockPoll({
        id: 'https://activities.local/users/bob/statuses/b1',
        actor: mockBob,
        createdAt: BASE_TIME + MINUTE,
        reply: a1.id
      })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })

      expect(shape(buildCombinedBlocks([a1, b1, a2]))).toEqual([
        'a1',
        'b1',
        'a2'
      ])
    })

    it('does not tuck a reply to someone other than the run', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const c1 = note('c1', { actor: mockCarol, at: 2 * MINUTE, reply: b1.id })
      const a2 = note('a2', { at: 3 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 4 * MINUTE, reply: a2.id })

      expect(shape(buildCombinedBlocks([a1, b1, c1, a2, a3]))).toEqual([
        'a1',
        'b1',
        'c1',
        'a2 > a3'
      ])
    })

    it('keeps a reply the author never followed up on as a normal post', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: MINUTE, reply: a1.id })
      const b1 = note('b1', { actor: mockBob, at: 2 * MINUTE, reply: a2.id })

      expect(shape(buildCombinedBlocks([a1, a2, b1]))).toEqual([
        'a1 > a2',
        'b1'
      ])
    })

    it('lets a reply that was waiting start a run of its own', () => {
      const c0 = note('c0', { actor: mockBob, at: 0 })
      const c1 = note('c1', { at: MINUTE, reply: c0.id })
      const c2 = note('c2', { at: 2 * MINUTE, reply: c1.id })
      const c3 = note('c3', { at: 3 * MINUTE, reply: c2.id })

      expect(shape(buildCombinedBlocks([c0, c1, c2, c3]))).toEqual([
        'c0',
        'c1 > c2 > c3'
      ])
    })

    it('lets a waiting reply start a run with the next reply to it', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const b2 = note('b2', { actor: mockBob, at: 2 * MINUTE, reply: b1.id })

      expect(shape(buildCombinedBlocks([a1, b1, b2]))).toEqual([
        'a1',
        'b1 > b2'
      ])
    })

    it('rescans two waiting replies after a split', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const b2 = note('b2', { actor: mockBob, at: 2 * MINUTE, reply: b1.id })
      const b3 = note('b3', { actor: mockBob, at: 3 * MINUTE, reply: b2.id })

      expect(shape(buildCombinedBlocks([a1, b1, b2, b3]))).toEqual([
        'a1',
        'b1 > b2 > b3'
      ])
    })

    it('does not tuck a reply that comes long after the post it answers', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', {
        actor: mockBob,
        at: COMBINE_MAX_GAP_MS + 1,
        reply: a1.id
      })
      const a2 = note('a2', { at: COMBINE_MAX_GAP_MS + 2, reply: a1.id })

      expect(shape(buildCombinedBlocks([a1, b1, a2]))).toEqual([
        'a1',
        'b1',
        'a2'
      ])
    })
  })

  describe('reply targets by alias', () => {
    it('matches a reply that names its parent by url', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: MINUTE, reply: a1.url })

      expect(shape(buildCombinedBlocks([a1, a2]))).toEqual(['a1 > a2'])
    })

    it('matches a reply that names its parent by public id', () => {
      const a1 = note('a1', { at: 0, publicId: 'public-a1' })
      const a2 = note('a2', { at: MINUTE, reply: 'public-a1' })

      expect(shape(buildCombinedBlocks([a1, a2]))).toEqual(['a1 > a2'])
    })

    it('does not combine a post whose parent is outside the row', () => {
      const a1 = note('a1', { at: 0, reply: 'https://elsewhere.test/other' })
      const a2 = note('a2', { at: MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 2 * MINUTE, reply: 'unknown' })

      expect(shape(buildCombinedBlocks([a1, a2, a3]))).toEqual([
        'a1 > a2',
        'a3'
      ])
    })
  })
})
