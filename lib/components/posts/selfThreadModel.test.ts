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
  buildCombinedBlocks
} from '@/lib/components/posts/combinedThreadModel'
import {
  LONG_RUN_MAX_PARTS,
  SelfThreadModel,
  buildSelfThreadModel,
  collapseLongRun,
  extractSelfReplyChain
} from '@/lib/components/posts/selfThreadModel'
import { groupTimelinePage } from '@/lib/components/posts/timelineModel'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote } from '@/lib/types/domain/status'

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

    it('labels a reply to the last part of a separate ancestor run', () => {
      const a1 = note('a1', { at: 0 })
      const a2 = note('a2', { at: 2 * MINUTE, reply: a1.id })
      const a3 = note('a3', { at: 20 * MINUTE, reply: a2.id })
      const a4 = note('a4', { at: 22 * MINUTE, reply: a3.id })
      const replyToA2 = note('reply-a2', {
        actor: mockBob,
        at: 23 * MINUTE,
        reply: a2.id
      })
      const replyToA4 = note('reply-a4', {
        actor: mockBob,
        at: 24 * MINUTE,
        reply: a4.id
      })

      const model = buildSelfThreadModel({
        focusedStatus: a3,
        ancestors: [a1, a2],
        descendants: [a4, replyToA2, replyToA4]
      })

      expect(model.ancestorRuns.map((run) => run.key)).toEqual([
        `combined:${a1.id}`
      ])
      expect(model.replyingToByReplyId.get(replyToA2.id)).toBe(
        'Replying to 2 of 2'
      )
      // The opened run keeps its rule: its last part needs no label.
      expect(model.replyingToByReplyId.has(replyToA4.id)).toBe(false)
    })

    describe('matches the timeline tuck decision', () => {
      const insetIds = (model: SelfThreadModel) =>
        model.parts.flatMap((part) => part.insets.map((inset) => inset.id))

      it("tucks a reply measured from the run's latest post, not the part it answers", () => {
        const a1 = note('a1', { at: 0 })
        const a2 = note('a2', { at: 9 * MINUTE, reply: a1.id })
        const bob = note('bob', {
          actor: mockBob,
          at: 11 * MINUTE,
          reply: a1.id
        })
        const a3 = note('a3', { at: 12 * MINUTE, reply: a2.id })

        const model = buildSelfThreadModel({
          focusedStatus: a1,
          descendants: [a2, bob, a3]
        })

        expect(model.parts.map((p) => p.status.id)).toEqual([
          a1.id,
          a2.id,
          a3.id
        ])
        expect(insetIds(model)).toEqual([bob.id])
        expect(model.repliesOutsideRun).toEqual([])
      })

      it('tucks a reply exactly ten minutes before the next part', () => {
        const a1 = note('a1', { at: 0 })
        const a2 = note('a2', { at: 8 * MINUTE, reply: a1.id })
        const bob = note('bob', {
          actor: mockBob,
          at: 17 * MINUTE,
          reply: a1.id
        })
        const a3 = note('a3', { at: 18 * MINUTE, reply: a2.id })

        const model = buildSelfThreadModel({
          focusedStatus: a1,
          descendants: [a2, bob, a3]
        })

        expect(insetIds(model)).toEqual([bob.id])
        expect(model.repliesOutsideRun).toEqual([])
      })

      it("leaves a reply under Replies when the author's next post does not follow it", () => {
        const a1 = note('a1', { at: 0 })
        const a2 = note('a2', { at: MINUTE, reply: a1.id })
        const bob = note('bob', {
          actor: mockBob,
          at: 8 * MINUTE,
          reply: a1.id
        })

        const model = buildSelfThreadModel({
          focusedStatus: a1,
          descendants: [a2, bob]
        })

        expect(model.parts.map((p) => p.status.id)).toEqual([a1.id, a2.id])
        expect(insetIds(model)).toEqual([])
        expect(model.repliesOutsideRun.map((s) => s.id)).toEqual([bob.id])
        expect(model.replyingToByReplyId.get(bob.id)).toBe('Replying to 1 of 2')
      })

      it('leaves a reply to a middle part under Replies when it comes after the last part', () => {
        const a1 = note('a1', { at: 0 })
        const a2 = note('a2', { at: MINUTE, reply: a1.id })
        const a3 = note('a3', { at: 2 * MINUTE, reply: a2.id })
        const bob = note('bob', {
          actor: mockBob,
          at: 5 * MINUTE,
          reply: a2.id
        })

        const model = buildSelfThreadModel({
          focusedStatus: a1,
          descendants: [a2, a3, bob]
        })

        expect(model.parts.map((p) => p.status.id)).toEqual([
          a1.id,
          a2.id,
          a3.id
        ])
        expect(insetIds(model)).toEqual([])
        expect(model.replyingToByReplyId.get(bob.id)).toBe('Replying to 2 of 3')
      })

      it('keeps the two oldest replies when the cap forces a choice, whatever the input order', () => {
        const a1 = note('a1', { at: 0 })
        const a2 = note('a2', { at: 6 * MINUTE, reply: a1.id })
        const early = note('early', {
          actor: mockBob,
          at: MINUTE,
          reply: a1.id
        })
        const mid = note('mid', {
          actor: mockBob,
          at: 2 * MINUTE,
          reply: a1.id
        })
        const late = note('late', {
          actor: mockBob,
          at: 3 * MINUTE,
          reply: a1.id
        })

        const model = buildSelfThreadModel({
          focusedStatus: a1,
          descendants: [a2, late, mid, early]
        })

        expect(insetIds(model)).toEqual([early.id, mid.id])
        expect(model.repliesOutsideRun.map((s) => s.id)).toEqual([late.id])
      })

      it('keeps the whole run when the data holds a reply loop', () => {
        const a1 = note('a1', { at: 0 })
        const a2 = note('a2', { at: MINUTE, reply: a1.id })

        const model = buildSelfThreadModel({
          focusedStatus: { ...a1, reply: a2.id },
          descendants: [a2]
        })

        expect(model.parts.map((p) => p.status.id)).toEqual([a1.id, a2.id])
      })

      // Deterministic generator so failures reproduce: mulberry32.
      const random = (seed: number) => () => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      const partIdsOf = (blocks: readonly CombinedBlock[]) =>
        blocks.flatMap((block) =>
          block.kind === 'run'
            ? [block.parts.map((part) => part.status.id)]
            : []
        )
      const tuckedIdsOf = (blocks: readonly CombinedBlock[]) =>
        blocks
          .flatMap((block) =>
            block.kind === 'run'
              ? block.parts.flatMap((part) => part.insets.map((i) => i.id))
              : []
          )
          .sort()
      // The timeline's own order for a thread row of these statuses.
      const timelineBlocks = (statuses: Status[]) => {
        const byId = new Map(statuses.map((status) => [status.id, status]))
        const row = groupTimelinePage(statuses).find(
          (r) => r.kind === 'thread' || r.kind === 'conversation'
        )
        if (!row || !('entryIds' in row)) throw new Error('no thread row')
        return buildCombinedBlocks(row.entryIds.map((id) => byId.get(id)!))
      }

      it('tucks what the timeline tucks for generated threads without splitting the run', () => {
        const next = random(2560)
        const pick = (n: number) => Math.floor(next() * n)
        let comparedWithFullTimeline = 0
        let tuckedCount = 0
        let leftOutCount = 0

        for (let caseIndex = 0; caseIndex < 200; caseIndex++) {
          const chain: Status[] = []
          let at = 0
          for (let i = 0; i < 2 + pick(4); i++) {
            at += pick(12) * MINUTE
            chain.push(
              note(`c${caseIndex}-a${i}`, { at, reply: chain[i - 1]?.id })
            )
          }
          const replies: Status[] = []
          for (let i = 0; i < pick(5); i++) {
            const target = chain[pick(chain.length)]
            const base = note(`c${caseIndex}-r${i}`, {
              actor: i % 2 ? mockCarol : mockBob,
              at: target.createdAt - BASE_TIME + pick(14) * MINUTE,
              reply: target.id
            })
            replies.push(
              pick(5) === 0
                ? { ...base, attachments: [createMockPhoto(base, 'photo')] }
                : base
            )
          }

          const [root, ...rest] = chain
          const model = buildSelfThreadModel({
            focusedStatus: root,
            descendants: [...rest, ...replies]
          })
          const postPageBlocks = [
            ...(model.run ? [model.run] : []),
            ...model.descendantRuns
          ]
          const tucked = tuckedIdsOf(postPageBlocks)
          tuckedCount += tucked.length
          leftOutCount += replies.length - tucked.length

          // The post page never splits the author's run.
          expect(partIdsOf(postPageBlocks)).toEqual(
            partIdsOf(buildCombinedBlocks(chain))
          )
          // What it tucks is exactly what the timeline tucks for the run plus
          // those replies...
          const tuckedSet = new Set(tucked)
          const kept = replies.filter((reply) => tuckedSet.has(reply.id))
          expect(tuckedIdsOf(timelineBlocks([...chain, ...kept]))).toEqual(
            tucked
          )
          // ...and no reply left out could join without one falling out.
          for (const reply of replies) {
            if (tuckedSet.has(reply.id)) continue
            const ids = tuckedIdsOf(timelineBlocks([...chain, ...kept, reply]))
            expect([...tucked, reply.id].every((id) => ids.includes(id))).toBe(
              false
            )
          }
          // When the timeline keeps the same runs with every reply, it tucks
          // the same replies the post page does.
          const full = timelineBlocks([...chain, ...replies])
          if (
            JSON.stringify(partIdsOf(full)) ===
            JSON.stringify(partIdsOf(postPageBlocks))
          ) {
            comparedWithFullTimeline += 1
            expect(tuckedIdsOf(full)).toEqual(tucked)
          }
        }
        // Guard against a generator that stops exercising either side.
        expect(comparedWithFullTimeline).toBeGreaterThan(50)
        expect(tuckedCount).toBeGreaterThan(20)
        expect(leftOutCount).toBeGreaterThan(20)
      })
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
