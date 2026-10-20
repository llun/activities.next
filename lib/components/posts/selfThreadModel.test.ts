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
import { COMBINE_MAX_GAP_MS } from '@/lib/components/posts/combinedThreadModel'
import {
  LONG_RUN_MAX_PARTS,
  buildSelfThreadModel,
  collapseLongRun,
  extractSelfReplyChain
} from '@/lib/components/posts/selfThreadModel'
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
    actorId: actor.id,
    createdAt: BASE_TIME + at,
    reply: reply ?? '',
    text: name,
    ...rest
  })
}

describe('selfThreadModel', () => {
  describe('extractSelfReplyChain', () => {
    it('extracts a direct chronological self-reply chain', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 2 * MINUTE, reply: a2.id })

      expect(extractSelfReplyChain(a1, [a3, a2]).map((s) => s.id)).toEqual([
        a2.id,
        a3.id
      ])
    })

    it('picks the earliest self-reply when the author replied multiple times to the same post', () => {
      const a1 = note('a1', { at: 0 })
      const a2Later = note('a2-later', { at: 3 * MINUTE, reply: a1.id })
      const a2First = note('a2-first', { at: MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 2 * MINUTE, reply: a2First.id })

      expect(
        extractSelfReplyChain(a1, [a2Later, a2First, a3]).map((s) => s.id)
      ).toEqual([a2First.id, a3.id])
    })

    it('ignores replies by other authors', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })

      expect(extractSelfReplyChain(a1, [b1, a2]).map((s) => s.id)).toEqual([
        a2.id
      ])
    })

    it('matches reply targets by url and publicId aliases', () => {
      const a1 = note('a1', { at: 0, publicId: 'pub-a1' })
      const a2 = note('a2', { at: MINUTE, reply: 'pub-a1' })
      const a3 = note('a3', { at: 2 * MINUTE, reply: a2.url })

      expect(extractSelfReplyChain(a1, [a2, a3]).map((s) => s.id)).toEqual([
        a2.id,
        a3.id
      ])
    })

    it('stops at a reply that points back into the chain', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 2 * MINUTE, reply: a2.id })
      // The root itself, replying to the last post: a malformed loop.
      const loopBack = { ...a1, reply: a3.id }

      expect(
        extractSelfReplyChain(a1, [a2, a3, loopBack]).map((s) => s.id)
      ).toEqual([a2.id, a3.id])
    })
  })

  describe('buildSelfThreadModel', () => {
    it('marks openedPartIndex for the first, middle, and last part of a run', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 2 * MINUTE, reply: a2.id })

      const fromFirst = buildSelfThreadModel({
        focusedStatus: a1,
        ancestors: [],
        descendants: [a2, a3]
      })
      expect(fromFirst.openedPartIndex).toBe(0)
      expect(fromFirst.parts.map((p) => p.status.id)).toEqual([
        a1.id,
        a2.id,
        a3.id
      ])

      const fromMiddle = buildSelfThreadModel({
        focusedStatus: a2,
        ancestors: [a1],
        descendants: [a3]
      })
      expect(fromMiddle.openedPartIndex).toBe(1)
      expect(fromMiddle.parts.map((p) => p.status.id)).toEqual([
        a1.id,
        a2.id,
        a3.id
      ])

      const fromLast = buildSelfThreadModel({
        focusedStatus: a3,
        ancestors: [a1, a2],
        descendants: []
      })
      expect(fromLast.openedPartIndex).toBe(2)
      expect(fromLast.parts.map((p) => p.status.id)).toEqual([
        a1.id,
        a2.id,
        a3.id
      ])
    })

    it('excludes merged self-replies and tucked insets from repliesOutsideRun and ancestorsOutsideRun', () => {
      const rootByBob = note('root-bob', { actor: mockBob, at: 0 })
      const a1 = note('a1', { at: MINUTE, reply: rootByBob.id })
      const bInset = note('b-inset', {
        actor: mockBob,
        at: 2 * MINUTE,
        reply: a1.id
      })
      const a2 = note('a2', { at: 3 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 4 * MINUTE, reply: a2.id })
      const cReply = note('c-reply', {
        actor: mockCarol,
        at: 5 * MINUTE,
        reply: a3.id
      })

      const model = buildSelfThreadModel({
        focusedStatus: a2,
        ancestors: [rootByBob, a1],
        descendants: [bInset, a3, cReply]
      })

      expect(model.ancestorsOutsideRun.map((s) => s.id)).toEqual([rootByBob.id])
      expect(model.parts[0].insets.map((s) => s.id)).toEqual([bInset.id])
      expect(model.repliesOutsideRun.map((s) => s.id)).toEqual([cReply.id])
      expect(model.mergedIds.has(a1.id)).toBe(true)
      expect(model.mergedIds.has(bInset.id)).toBe(true)
      expect(model.mergedIds.has(a2.id)).toBe(true)
      expect(model.mergedIds.has(a3.id)).toBe(true)
      expect(model.mergedIds.has(cReply.id)).toBe(false)
    })

    it('never splits the run for untuckable replies to earlier parts and maps them to "Replying to i of n"', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 4 * MINUTE, reply: a2.id })

      const bPhotoBase = note('b-photo', {
        actor: mockBob,
        at: MINUTE,
        reply: a1.id
      })
      const bPhoto: StatusNote = {
        ...bPhotoBase,
        attachments: [createMockPhoto(bPhotoBase, 'photo')]
      }

      const cPoll = createMockPoll({
        id: 'https://activities.local/users/carol/statuses/c-poll',
        actor: mockCarol,
        actorId: mockCarol.id,
        createdAt: BASE_TIME + 3 * MINUTE,
        reply: a2.id
      })

      const dQuote = note('d-quote', {
        actor: mockBob,
        at: 3.5 * MINUTE,
        reply: a2.id,
        quote: { quotedStatusId: a1.id, state: 'accepted' }
      })
      const eFitness = note('e-fitness', {
        actor: mockCarol,
        at: 3.6 * MINUTE,
        reply: a1.id,
        fitness: {
          id: 'fit-e',
          fileName: 'ride.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 1,
          url: 'https://activities.local/fit/e.fit',
          processingStatus: 'completed'
        }
      })

      const replyToLast = note('reply-last', {
        actor: mockBob,
        at: 5 * MINUTE,
        reply: a3.id
      })

      const model = buildSelfThreadModel({
        focusedStatus: a1,
        ancestors: [],
        descendants: [bPhoto, a2, cPoll, dQuote, eFitness, a3, replyToLast]
      })

      // All 3 author parts stay in one combined run without splitting
      expect(model.parts.map((p) => p.status.id)).toEqual([a1.id, a2.id, a3.id])
      expect(model.repliesOutsideRun.map((r) => r.id)).toEqual([
        bPhoto.id,
        cPoll.id,
        dQuote.id,
        eFitness.id,
        replyToLast.id
      ])
      expect(model.replyingToByReplyId.get(bPhoto.id)).toBe(
        'Replying to 1 of 3'
      )
      expect(model.replyingToByReplyId.get(cPoll.id)).toBe('Replying to 2 of 3')
      expect(model.replyingToByReplyId.get(dQuote.id)).toBe(
        'Replying to 2 of 3'
      )
      expect(model.replyingToByReplyId.get(eFitness.id)).toBe(
        'Replying to 1 of 3'
      )
      // Replies to the last part (3 of 3) need no "Replying to" label
      expect(model.replyingToByReplyId.has(replyToLast.id)).toBe(false)
    })

    it('tucks the first two plain replies to an earlier part and leaves a third in repliesOutsideRun with "Replying to i of n"', () => {
      const a1 = note('a1', { at: 0 })
      const b1 = note('b1', { actor: mockBob, at: MINUTE, reply: a1.id })
      const c1 = note('c1', { actor: mockCarol, at: 2 * MINUTE, reply: a1.id })
      const b2 = note('b2', { actor: mockBob, at: 3 * MINUTE, reply: a1.id })
      const a2 = note('a2', { at: 4 * MINUTE, reply: a1.id })

      const model = buildSelfThreadModel({
        focusedStatus: a1,
        ancestors: [],
        descendants: [b1, c1, b2, a2]
      })

      expect(model.parts.map((p) => p.status.id)).toEqual([a1.id, a2.id])
      expect(model.parts[0].insets.map((s) => s.id)).toEqual([b1.id, c1.id])
      expect(model.repliesOutsideRun.map((s) => s.id)).toEqual([b2.id])
      expect(model.replyingToByReplyId.get(b2.id)).toBe('Replying to 1 of 2')
    })

    it('returns run: null when the focused status is a standalone post or exceeds the time gap', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', {
        at: COMBINE_MAX_GAP_MS + 1000,
        reply: a1.id
      })

      const model = buildSelfThreadModel({
        focusedStatus: a1,
        ancestors: [],
        descendants: [a2]
      })

      expect(model.run).toBeNull()
      expect(model.parts).toEqual([])
      expect(model.openedPartIndex).toBe(-1)
      expect(model.repliesOutsideRun).toEqual([a2])
    })

    it('returns empty repliesOutsideRun when all descendants are merged self-replies and tucked insets', () => {
      const a1 = note('a1', { at: 0 })
      const bInset = note('b-inset', {
        actor: mockBob,
        at: MINUTE,
        reply: a1.id
      })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 3 * MINUTE, reply: a2.id })

      const model = buildSelfThreadModel({
        focusedStatus: a1,
        ancestors: [],
        descendants: [bInset, a2, a3]
      })

      expect(model.parts.map((p) => p.status.id)).toEqual([a1.id, a2.id, a3.id])
      expect(model.parts[0].insets.map((s) => s.id)).toEqual([bInset.id])
      expect(model.repliesOutsideRun).toEqual([])
    })

    it("tucks a reply that arrived after the author's next part, as the timeline does", () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })
      const bLate = note('b-late', {
        actor: mockBob,
        at: 3 * MINUTE,
        reply: a1.id
      })
      const a3 = note('a3', { at: 4 * MINUTE, reply: a2.id })

      const model = buildSelfThreadModel({
        focusedStatus: a1,
        ancestors: [],
        descendants: [a2, bLate, a3]
      })

      expect(model.parts.map((p) => p.status.id)).toEqual([a1.id, a2.id, a3.id])
      expect(model.parts[0].insets.map((s) => s.id)).toEqual([bLate.id])
      expect(model.repliesOutsideRun).toEqual([])
    })

    it('leaves a reply more than 10 minutes after the post it answers under Replies without splitting the run', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 4 * MINUTE, reply: a2.id })
      const bLate = note('b-late', {
        actor: mockBob,
        at: COMBINE_MAX_GAP_MS + MINUTE,
        reply: a1.id
      })

      const model = buildSelfThreadModel({
        focusedStatus: a1,
        ancestors: [],
        descendants: [a2, a3, bLate]
      })

      expect(model.parts.map((p) => p.status.id)).toEqual([a1.id, a2.id, a3.id])
      expect(model.parts[0].insets).toEqual([])
      expect(model.repliesOutsideRun.map((s) => s.id)).toEqual([bLate.id])
      expect(model.replyingToByReplyId.get(bLate.id)).toBe('Replying to 1 of 3')
    })

    it('keeps a tuckable reply that has its own replies under Replies so its sub-thread renders', () => {
      const a1 = note('a1', { at: 0 })
      const bob = note('bob', { actor: mockBob, at: MINUTE, reply: a1.id })
      const carol = note('carol', {
        actor: mockCarol,
        at: 2 * MINUTE,
        reply: bob.id
      })
      const a2 = note('a2', { at: 3 * MINUTE, reply: a1.id })

      const model = buildSelfThreadModel({
        focusedStatus: a1,
        ancestors: [],
        descendants: [bob, carol, a2]
      })

      expect(model.parts.map((p) => p.status.id)).toEqual([a1.id, a2.id])
      expect(model.parts[0].insets).toEqual([])
      expect(model.repliesOutsideRun.map((s) => s.id)).toEqual([
        bob.id,
        carol.id
      ])
    })

    it('keeps two self-reply blocks separated by > 10 minutes as distinct runs around focusedStatus', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 20 * MINUTE, reply: a2.id })
      const a4 = note('a4', { at: 22 * MINUTE, reply: a3.id })

      const focusedInFirstBlock = buildSelfThreadModel({
        focusedStatus: a1,
        ancestors: [],
        descendants: [a2, a3, a4]
      })

      expect(focusedInFirstBlock.parts.map((p) => p.status.id)).toEqual([
        a1.id,
        a2.id
      ])
      expect(focusedInFirstBlock.ancestorsOutsideRun).toEqual([])
      expect(focusedInFirstBlock.repliesOutsideRun.map((s) => s.id)).toEqual([
        a3.id,
        a4.id
      ])

      const focusedInSecondBlock = buildSelfThreadModel({
        focusedStatus: a3,
        ancestors: [a1, a2],
        descendants: [a4]
      })

      expect(focusedInSecondBlock.parts.map((p) => p.status.id)).toEqual([
        a3.id,
        a4.id
      ])
      expect(focusedInSecondBlock.ancestorsOutsideRun.map((s) => s.id)).toEqual(
        [a1.id, a2.id]
      )
      expect(focusedInSecondBlock.repliesOutsideRun).toEqual([])
    })
  })

  describe('collapseLongRun', () => {
    const makeParts = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        status: note(`a${index + 1}`, { at: index * MINUTE }),
        insets: []
      }))

    it('does not collapse runs with at most 6 parts', () => {
      const parts = makeParts(LONG_RUN_MAX_PARTS)
      const result = collapseLongRun(parts, 0)

      expect(result.isCollapsed).toBe(false)
      expect(result.visiblePartIndices).toEqual([0, 1, 2, 3, 4, 5])
    })

    it('collapses runs with > 6 parts keeping first two, opened middle part, and last part', () => {
      const parts = makeParts(8)
      const fromFirst = collapseLongRun(parts, 0)
      expect(fromFirst.isCollapsed).toBe(true)
      expect(fromFirst.visiblePartIndices).toEqual([0, 1, 7])

      const fromMiddle = collapseLongRun(parts, 4)
      expect(fromMiddle.isCollapsed).toBe(true)
      expect(fromMiddle.visiblePartIndices).toEqual([0, 1, 4, 7])
    })
  })

  describe('fitness activity page (tuckIntoFirstPart: false)', () => {
    it('extracts followUpParts after the root fitness activity status, tucks plain replies, and labels untuckable replies', () => {
      const activity = note('activity', { at: 0 })
      const followUp1 = note('follow-1', { at: MINUTE, reply: activity.id })
      const bobInset = note('bob-inset', {
        actor: mockBob,
        at: 2 * MINUTE,
        reply: followUp1.id
      })
      const carolPhotoBase = note('carol-photo', {
        actor: mockCarol,
        at: 2 * MINUTE,
        reply: followUp1.id
      })
      const carolPhoto: StatusNote = {
        ...carolPhotoBase,
        attachments: [createMockPhoto(carolPhotoBase, 'photo')]
      }
      const followUp2 = note('follow-2', {
        at: 3 * MINUTE,
        reply: followUp1.id
      })
      const bobReply = note('bob-reply', {
        actor: mockBob,
        at: 4 * MINUTE,
        reply: activity.id
      })

      const model = buildSelfThreadModel({
        focusedStatus: activity,
        descendants: [followUp1, bobInset, carolPhoto, followUp2, bobReply],
        tuckIntoFirstPart: false
      })

      expect(model.parts.map((p) => p.status.id)).toEqual([
        activity.id,
        followUp1.id,
        followUp2.id
      ])
      expect(model.parts[1].insets.map((s) => s.id)).toEqual([bobInset.id])
      expect(model.repliesOutsideRun.map((s) => s.id)).toEqual([
        carolPhoto.id,
        bobReply.id
      ])
      expect(model.replyingToByReplyId.get(carolPhoto.id)).toBe(
        'Replying to 2 of 3'
      )
    })

    it('keeps a short reply from someone else to the activity under Replies instead of tucking it into the hidden first part', () => {
      const activity = note('activity', { at: 0 })
      const bobShort = note('bob-short', {
        actor: mockBob,
        at: 30 * 1000,
        reply: activity.id
      })
      const followUp1 = note('follow-1', { at: MINUTE, reply: activity.id })
      const followUp2 = note('follow-2', {
        at: 3 * MINUTE,
        reply: followUp1.id
      })
      const descendants = [bobShort, followUp1, followUp2]

      const fitness = buildSelfThreadModel({
        focusedStatus: activity,
        descendants,
        tuckIntoFirstPart: false
      })
      expect(fitness.parts[0].insets).toEqual([])
      expect(fitness.repliesOutsideRun.map((s) => s.id)).toEqual([bobShort.id])
      expect(fitness.replyingToByReplyId.get(bobShort.id)).toBe(
        'Replying to 1 of 3'
      )

      // The post page, where part 1 is a normal row, still tucks it.
      const postPage = buildSelfThreadModel({
        focusedStatus: activity,
        descendants
      })
      expect(postPage.parts[0].insets.map((s) => s.id)).toEqual([bobShort.id])
    })

    it('includes the fitness activity as part 1 when opening a follow-up URL on the post page', () => {
      const activity = note('activity', {
        at: 0,
        fitness: {
          id: 'fit-1',
          fileName: 'ride.fit',
          fileType: 'fit',
          mimeType: 'application/octet-stream',
          bytes: 2048,
          url: 'https://activities.local/fit/ride.fit',
          processingStatus: 'completed'
        }
      })
      const followUp1 = note('follow-1', { at: MINUTE, reply: activity.id })
      const followUp2 = note('follow-2', {
        at: 2 * MINUTE,
        reply: followUp1.id
      })

      const model = buildSelfThreadModel({
        focusedStatus: followUp1,
        ancestors: [activity],
        descendants: [followUp2]
      })

      expect(model.parts.map((p) => p.status.id)).toEqual([
        activity.id,
        followUp1.id,
        followUp2.id
      ])
      expect(model.openedPartIndex).toBe(1)
      expect(model.ancestorsOutsideRun).toEqual([])
      expect(model.repliesOutsideRun).toEqual([])
    })
  })
})
