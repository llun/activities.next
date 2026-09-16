import { describe, expect, it } from 'vitest'

import {
  BASE_TIME,
  boostOfOldPostScenario,
  boostOfReplyScenario,
  createMockAnnounce,
  createMockMastodonStatus,
  createMockNote,
  cyclicReferencesScenario,
  equalTimestampsScenario,
  lateParentScenario,
  missingParentScenario,
  mockAlice,
  mockBob,
  mockGroupActor,
  multiAuthorConversationScenario,
  nestedRepliesScenario,
  pollScenario,
  quotePostScenario,
  repeatedBoostsScenario,
  selfThreadScenario,
  singlePostScenario,
  timelineScenarios
} from '@/lib/components/posts/__fixtures__/timeline-context'
import {
  BOOSTS_LIMIT,
  getRowEntryIds,
  groupTimelinePage,
  groupTimelinePageWithTracking
} from '@/lib/components/posts/timelineModel'
import { Status } from '@/lib/types/domain/status'

describe('timelineModel', () => {
  describe('Required Specification Example', () => {
    it('Raw newest first: X(10:05), A2(10:04 -> A1), B(10:02), A1(10:00) => Display: X, Thread[A1, A2], B', () => {
      const a1 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/a1',
        actor: mockAlice,
        actorId: mockAlice.id,
        createdAt: BASE_TIME, // 10:00
        reply: ''
      })
      const b = createMockNote({
        id: 'https://activities.local/users/bob/statuses/b',
        actor: mockBob,
        actorId: mockBob.id,
        createdAt: BASE_TIME + 120000, // 10:02
        reply: ''
      })
      const a2 = createMockNote({
        id: 'https://activities.local/users/alice/statuses/a2',
        actor: mockAlice,
        actorId: mockAlice.id,
        createdAt: BASE_TIME + 240000, // 10:04
        reply: a1.id
      })
      const x = createMockNote({
        id: 'https://activities.local/users/alice/statuses/x',
        actor: mockAlice,
        actorId: mockAlice.id,
        createdAt: BASE_TIME + 300000, // 10:05
        reply: ''
      })

      const rawStatuses: Status[] = [x, a2, b, a1]
      const rows = groupTimelinePage(rawStatuses)

      expect(rows).toHaveLength(3)

      // Row 0: X (standalone)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${x.id}`,
        entryId: x.id
      })

      // Row 1: Thread[A1, A2] (emitted at A2's raw index 1, ordered parent-before-child [A1, A2])
      expect(rows[1]).toEqual({
        kind: 'thread',
        key: `thread:${a1.id}:${a2.id}`,
        entryIds: [a1.id, a2.id]
      })

      // Row 2: B (standalone)
      expect(rows[2]).toEqual({
        kind: 'status',
        key: `status:${b.id}`,
        entryId: b.id
      })
    })
  })

  describe('13 Authoritative Timeline Scenarios from Stage 1', () => {
    it('Scenario a: single post emits one standalone status row', () => {
      const rows = groupTimelinePage(singlePostScenario.statuses)
      expect(rows).toEqual([
        {
          kind: 'status',
          key: `status:${singlePostScenario.post.id}`,
          entryId: singlePostScenario.post.id
        }
      ])
      expect(getRowEntryIds(rows[0])).toEqual([singlePostScenario.post.id])
    })

    it('Scenario b: self-thread groups consecutive same-author posts in parent-before-child order', () => {
      const { root, reply1, reply2, rawFeedStatuses } = selfThreadScenario
      const rows = groupTimelinePage(rawFeedStatuses)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({
        kind: 'thread',
        key: `thread:${root.id}:${reply1.id}:${reply2.id}`,
        entryIds: [root.id, reply1.id, reply2.id]
      })
      expect(getRowEntryIds(rows[0])).toEqual([root.id, reply1.id, reply2.id])
    })

    it('Scenario c: multi-author conversation groups posts across distinct authors', () => {
      const { postA, postB, postC, rawFeedStatuses } =
        multiAuthorConversationScenario
      const rows = groupTimelinePage(rawFeedStatuses)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({
        kind: 'conversation',
        key: `conversation:${postA.id}:${postB.id}:${postC.id}`,
        entryIds: [postA.id, postB.id, postC.id]
      })
    })

    it('Scenario d: nested replies branching tree groups topologically with oldest first among siblings', () => {
      const {
        root,
        childBob,
        childCarol,
        grandchildDave,
        grandchildEve,
        grandchildFrank,
        rawFeedStatuses
      } = nestedRepliesScenario
      const rows = groupTimelinePage(rawFeedStatuses)

      expect(rows).toHaveLength(1)
      expect(rows[0].kind).toBe('conversation')

      // Root (10:00) -> Bob (10:01) & Carol (10:02)
      // Bob -> Dave (10:03) & Eve (10:04)
      // Carol -> Frank (10:05)
      // Topological order: root, childBob, childCarol, grandchildDave, grandchildEve, grandchildFrank
      expect(rows[0]).toEqual({
        kind: 'conversation',
        key: `conversation:${root.id}:${childBob.id}:${childCarol.id}:${grandchildDave.id}:${grandchildEve.id}:${grandchildFrank.id}`,
        entryIds: [
          root.id,
          childBob.id,
          childCarol.id,
          grandchildDave.id,
          grandchildEve.id,
          grandchildFrank.id
        ]
      })
    })

    it('Scenario e: boost of old post emits standalone status row with boost identity', () => {
      const { boost, statuses } = boostOfOldPostScenario
      const rows = groupTimelinePage(statuses)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${boost.id}`,
        entryId: boost.id
      })
    })

    it('Scenario f: repeated boosts suppresses duplicate boost cards for the same original post in presentation', () => {
      const { boost1, boost2, boost3, statuses } = repeatedBoostsScenario
      // statuses = [boost3, boost2, boost1]
      const rows = groupTimelinePage(statuses)

      // Only boost3 is kept; boost2 and boost1 are suppressed because original is already boosted
      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${boost3.id}`,
        entryId: boost3.id
      })
      if (rows[0].kind === 'status') {
        expect(rows[0].entryId).not.toBe(boost2.id)
        expect(rows[0].entryId).not.toBe(boost1.id)
      }
    })

    it('Scenario g: boost of reply does not connect to unboosted parent', () => {
      const { boostOfReply, parentPost, statuses } = boostOfReplyScenario
      // statuses = [boostOfReply, parentPost]
      const rows = groupTimelinePage(statuses)

      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${boostOfReply.id}`,
        entryId: boostOfReply.id
      })
      expect(rows[1]).toEqual({
        kind: 'status',
        key: `status:${parentPost.id}`,
        entryId: parentPost.id
      })
    })

    it('Scenario h: quote post does not connect as reply thread', () => {
      const { quotingPost, quotedPost, statuses } = quotePostScenario
      const rows = groupTimelinePage(statuses)

      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${quotingPost.id}`,
        entryId: quotingPost.id
      })
      expect(rows[1]).toEqual({
        kind: 'status',
        key: `status:${quotedPost.id}`,
        entryId: quotedPost.id
      })
    })

    it('Scenario i: poll emits standalone status row', () => {
      const { pollPost, statuses } = pollScenario
      const rows = groupTimelinePage(statuses)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${pollPost.id}`,
        entryId: pollPost.id
      })
    })

    it('Scenario j: missing parent keeps orphan reply standalone', () => {
      const { orphanReply, statuses } = missingParentScenario
      const rows = groupTimelinePage(statuses)

      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${orphanReply.id}`,
        entryId: orphanReply.id
      })
    })

    it('Scenario k: late parent moves older parent next to recent reply at first raw index', () => {
      const { parent, unrelated, child, statuses } = lateParentScenario
      // statuses = [child (10:04), unrelated (10:02), parent (10:00)]
      const rows = groupTimelinePage(statuses)

      expect(rows).toHaveLength(2)

      // Conversation[parent, child] emitted at index 0 (child's first raw index)
      expect(rows[0]).toEqual({
        kind: 'conversation',
        key: `conversation:${parent.id}:${child.id}`,
        entryIds: [parent.id, child.id]
      })

      // Unrelated standalone post emitted at index 1
      expect(rows[1]).toEqual({
        kind: 'status',
        key: `status:${unrelated.id}`,
        entryId: unrelated.id
      })
    })

    it('Scenario l: equal timestamps handles millisecond ties preserving server order', () => {
      const {
        rootPost,
        siblingA,
        siblingB,
        parentSameTime,
        childSameTime,
        statuses
      } = equalTimestampsScenario
      // statuses: [childSameTime, parentSameTime, siblingB, siblingA, rootPost]
      const rows = groupTimelinePage(statuses)

      expect(rows).toHaveLength(2)

      // Component 1: parentSameTime & childSameTime (child was at raw index 0)
      // Parent must precede child
      expect(rows[0]).toEqual({
        kind: 'conversation',
        key: `conversation:${parentSameTime.id}:${childSameTime.id}`,
        entryIds: [parentSameTime.id, childSameTime.id]
      })

      // Component 2: rootPost & siblingB & siblingA (siblingB was at raw index 2, siblingA at raw index 3)
      // rootPost first (parent before child); siblingB before siblingA (server order tie-breaker)
      expect(rows[1]).toEqual({
        kind: 'conversation',
        key: `conversation:${rootPost.id}:${siblingB.id}:${siblingA.id}`,
        entryIds: [rootPost.id, siblingB.id, siblingA.id]
      })
    })

    it('Scenario m: cyclic references rejects cycles as grouping edges and preserves standalone rows', () => {
      const { cyclicPostA, cyclicPostB, statuses } = cyclicReferencesScenario
      // statuses: [cyclicPostB, cyclicPostA]
      const rows = groupTimelinePage(statuses)

      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${cyclicPostB.id}`,
        entryId: cyclicPostB.id
      })
      expect(rows[1]).toEqual({
        kind: 'status',
        key: `status:${cyclicPostA.id}`,
        entryId: cyclicPostA.id
      })
    })

    it('Three-node cycle also breaks and preserves standalone rows', () => {
      const { cyclicPostX, cyclicPostY, cyclicPostZ, threeNodeCycle } =
        cyclicReferencesScenario
      const rows = groupTimelinePage(threeNodeCycle)

      expect(rows).toHaveLength(3)
      expect(rows.map((r) => r.kind)).toEqual(['status', 'status', 'status'])
      expect(rows.map((r) => (r.kind === 'status' ? r.entryId : ''))).toEqual([
        cyclicPostX.id,
        cyclicPostY.id,
        cyclicPostZ.id
      ])
    })

    it('All 13 scenario fixtures produce valid non-empty timeline rows', () => {
      for (const [_key, scenario] of Object.entries(timelineScenarios)) {
        const rows = groupTimelinePage(scenario.statuses)
        expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
          expect(['status', 'thread', 'conversation', 'boosts']).toContain(
            row.kind
          )
          expect(row.key).toBeDefined()
          expect(getRowEntryIds(row).length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('Ordering Guarantees', () => {
    it('strictly enforces parent-before-child in direct chain regardless of input order', () => {
      const root = createMockNote({
        id: 'https://activities.local/statuses/chain-root',
        createdAt: BASE_TIME
      })
      const child1 = createMockNote({
        id: 'https://activities.local/statuses/chain-c1',
        createdAt: BASE_TIME + 1000,
        reply: root.id
      })
      const child2 = createMockNote({
        id: 'https://activities.local/statuses/chain-c2',
        createdAt: BASE_TIME + 2000,
        reply: child1.id
      })

      // Reversed input
      const rows = groupTimelinePage([child2, child1, root])
      expect(rows).toHaveLength(1)
      expect(rows[0].kind).toBe('thread')
      expect(getRowEntryIds(rows[0])).toEqual([root.id, child1.id, child2.id])
    })

    it('orders independent siblings oldest first', () => {
      const root = createMockNote({
        id: 'https://activities.local/statuses/sib-root',
        createdAt: BASE_TIME
      })
      const olderSibling = createMockNote({
        id: 'https://activities.local/statuses/sib-older',
        createdAt: BASE_TIME + 1000,
        reply: root.id
      })
      const newerSibling = createMockNote({
        id: 'https://activities.local/statuses/sib-newer',
        createdAt: BASE_TIME + 5000,
        reply: root.id
      })

      // In feed, newer arrived first
      const rows = groupTimelinePage([newerSibling, olderSibling, root])
      expect(rows).toHaveLength(1)
      expect(getRowEntryIds(rows[0])).toEqual([
        root.id,
        olderSibling.id,
        newerSibling.id
      ])
    })

    it('prefers parent-before-child when malformed timestamp has child older than parent', () => {
      const parent = createMockNote({
        id: 'https://activities.local/statuses/parent-later-time',
        createdAt: BASE_TIME + 10000, // 10:00:10
        reply: ''
      })
      const child = createMockNote({
        id: 'https://activities.local/statuses/child-earlier-time',
        createdAt: BASE_TIME, // 10:00:00 (timestamp says child is older!)
        reply: parent.id
      })

      const rows = groupTimelinePage([parent, child])
      expect(rows).toHaveLength(1)
      // Parent MUST precede child even though child has smaller timestamp
      expect(getRowEntryIds(rows[0])).toEqual([parent.id, child.id])
    })
  })

  describe('Deduplication & Boost Suppression', () => {
    it('deduplicates overlapping page entries by wrapper ID', () => {
      const noteA = createMockNote({
        id: 'https://activities.local/statuses/dup-a'
      })
      const noteB = createMockNote({
        id: 'https://activities.local/statuses/dup-b'
      })

      const rows = groupTimelinePage([noteA, noteB, noteA])
      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${noteA.id}`,
        entryId: noteA.id
      })
      expect(rows[1]).toEqual({
        kind: 'status',
        key: `status:${noteB.id}`,
        entryId: noteB.id
      })
    })

    it('keeps distinct identities for original post and boost of that post', () => {
      const original = createMockNote({
        id: 'https://activities.local/statuses/post-orig'
      })
      const boost = createMockAnnounce({
        id: 'https://activities.local/statuses/boost-wrapper-1',
        originalStatus: original
      })

      const rows = groupTimelinePage([boost, original])
      expect(rows).toHaveLength(2)
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${boost.id}`,
        entryId: boost.id
      })
      expect(rows[1]).toEqual({
        kind: 'status',
        key: `status:${original.id}`,
        entryId: original.id
      })
    })

    it('suppresses repeated boosts across pages via seenBoostTargetIds', () => {
      const original = createMockNote({
        id: 'https://activities.local/statuses/cross-orig'
      })
      const boostPage1 = createMockAnnounce({
        id: 'https://activities.local/statuses/boost-p1',
        originalStatus: original
      })
      const boostPage2 = createMockAnnounce({
        id: 'https://activities.local/statuses/boost-p2',
        originalStatus: original
      })

      const { rows: rows1, seenBoostTargetIds } = groupTimelinePageWithTracking(
        [boostPage1]
      )
      expect(rows1).toHaveLength(1)
      expect(rows1[0]).toEqual({
        kind: 'status',
        key: `status:${boostPage1.id}`,
        entryId: boostPage1.id
      })
      expect(seenBoostTargetIds.has(original.id)).toBe(true)

      // Second page with another boost of the same post
      const rows2 = groupTimelinePage([boostPage2], { seenBoostTargetIds })
      expect(rows2).toHaveLength(0) // Suppressed!
    })

    it('bounds boost suppression memory to 100 targets (FIFO eviction)', () => {
      const targets = Array.from({ length: 105 }, (_, i) =>
        createMockNote({ id: `https://activities.local/statuses/target-${i}` })
      )

      const boosts = targets.map((t, i) =>
        createMockAnnounce({
          id: `https://activities.local/statuses/boost-${i}`,
          originalStatus: t
        })
      )

      const { seenBoostTargetIds } = groupTimelinePageWithTracking(boosts, {
        maxSeenBoostTargets: BOOSTS_LIMIT
      })

      expect(seenBoostTargetIds.size).toBe(BOOSTS_LIMIT)
      // The first 5 targets should have been evicted
      for (let i = 0; i < 5; i++) {
        expect(seenBoostTargetIds.has(targets[i].id)).toBe(false)
      }
      // The last 100 targets should still be retained
      for (let i = 5; i < 105; i++) {
        expect(seenBoostTargetIds.has(targets[i].id)).toBe(true)
      }
    })
  })

  describe('Individual Boosts Timeline Rows (groupBoosts: false or omitted by default)', () => {
    const makeOrdinaryPost = (id: string) =>
      createMockNote({ id: `https://activities.local/statuses/ord-${id}` })

    const makeBoostPost = (id: string) =>
      createMockAnnounce({
        id: `https://activities.local/statuses/b-${id}`,
        originalStatus: createMockNote({
          id: `https://activities.local/statuses/target-${id}`
        })
      })

    it('emits boosts as individual status rows by default when groupBoosts is omitted', () => {
      // 20 entries with 6 boosts which would otherwise group when groupBoosts is true
      const boosts = Array.from({ length: 6 }, (_, i) => makeBoostPost(`b${i}`))
      const ordinary = Array.from({ length: 14 }, (_, i) =>
        makeOrdinaryPost(`o${i}`)
      )
      const statuses = [
        boosts[0],
        ordinary[0],
        boosts[1],
        ordinary[1],
        boosts[2],
        ordinary[2],
        boosts[3],
        ordinary[3],
        boosts[4],
        ordinary[4],
        boosts[5],
        ...ordinary.slice(5)
      ]

      const rows = groupTimelinePage(statuses)
      expect(rows.some((r) => r.kind === 'boosts')).toBe(false)
      expect(rows).toHaveLength(20)
      for (const row of rows) {
        expect(row.kind).toBe('status')
      }
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${boosts[0].id}`,
        entryId: boosts[0].id
      })
      expect(rows[2]).toEqual({
        kind: 'status',
        key: `status:${boosts[1].id}`,
        entryId: boosts[1].id
      })
    })

    it('emits consecutive boosts as individual status rows in sequence when groupBoosts: false', () => {
      const statuses = [
        makeOrdinaryPost('1'),
        makeBoostPost('1'),
        makeBoostPost('2'),
        makeBoostPost('3'),
        ...Array.from({ length: 16 }, (_, i) => makeOrdinaryPost(`rest${i}`))
      ]

      const rows = groupTimelinePage(statuses, { groupBoosts: false })
      expect(rows.some((r) => r.kind === 'boosts')).toBe(false)
      expect(rows[1]).toEqual({
        kind: 'status',
        key: `status:${statuses[1].id}`,
        entryId: statuses[1].id
      })
      expect(rows[2]).toEqual({
        kind: 'status',
        key: `status:${statuses[2].id}`,
        entryId: statuses[2].id
      })
      expect(rows[3]).toEqual({
        kind: 'status',
        key: `status:${statuses[3].id}`,
        entryId: statuses[3].id
      })
    })

    it('maintains deduplicateAndSuppress suppression while keeping remaining boosts as individual status rows', () => {
      const targetA = makeOrdinaryPost('target-a')
      const boostA1 = createMockAnnounce({
        id: 'https://activities.local/statuses/boost-a1',
        originalStatus: targetA
      })
      const boostA2 = createMockAnnounce({
        id: 'https://activities.local/statuses/boost-a2',
        originalStatus: targetA
      })
      const ordinary = makeOrdinaryPost('ord-1')
      const targetB = makeOrdinaryPost('target-b')
      const boostB1 = createMockAnnounce({
        id: 'https://activities.local/statuses/boost-b1',
        originalStatus: targetB
      })

      // boostA2 is duplicate of targetA and should be suppressed; boostA1 and boostB1 should be individual status rows
      const rows = groupTimelinePage([boostA1, ordinary, boostA2, boostB1])
      expect(rows).toHaveLength(3)
      expect(rows.map((r) => r.kind)).toEqual(['status', 'status', 'status'])
      expect(rows[0]).toEqual({
        kind: 'status',
        key: `status:${boostA1.id}`,
        entryId: boostA1.id
      })
      expect(rows[1]).toEqual({
        kind: 'status',
        key: `status:${ordinary.id}`,
        entryId: ordinary.id
      })
      expect(rows[2]).toEqual({
        kind: 'status',
        key: `status:${boostB1.id}`,
        entryId: boostB1.id
      })
    })
  })

  describe('Boost Carousel Grouping (Stage 7 threshold compliance)', () => {
    const makeOrdinaryPost = (id: string) =>
      createMockNote({ id: `https://activities.local/statuses/ord-${id}` })

    const makeBoostPost = (id: string) =>
      createMockAnnounce({
        id: `https://activities.local/statuses/b-${id}`,
        originalStatus: createMockNote({
          id: `https://activities.local/statuses/target-${id}`
        })
      })

    it('10 entries never group even with boosts', () => {
      const statuses = [
        ...Array.from({ length: 5 }, (_, i) => makeBoostPost(`b${i}`)),
        ...Array.from({ length: 5 }, (_, i) => makeOrdinaryPost(`o${i}`))
      ]
      const rows = groupTimelinePage(statuses, { groupBoosts: true })
      expect(rows.some((r) => r.kind === 'boosts')).toBe(false)
    })

    it('20 entries with 5 separated boosts do not group (5 <= 20/4)', () => {
      // 5 boosts interspersed: [b, o, o, b, o, o, b, o, o, b, o, o, b, o, o, o, o, o, o, o]
      const statuses = [
        makeBoostPost('1'),
        makeOrdinaryPost('1'),
        makeOrdinaryPost('2'),
        makeBoostPost('2'),
        makeOrdinaryPost('3'),
        makeOrdinaryPost('4'),
        makeBoostPost('3'),
        makeOrdinaryPost('5'),
        makeOrdinaryPost('6'),
        makeBoostPost('4'),
        makeOrdinaryPost('7'),
        makeOrdinaryPost('8'),
        makeBoostPost('5'),
        ...Array.from({ length: 7 }, (_, i) => makeOrdinaryPost(`extra${i}`))
      ]
      expect(statuses).toHaveLength(20)
      const rows = groupTimelinePage(statuses, { groupBoosts: true })
      expect(rows.some((r) => r.kind === 'boosts')).toBe(false)
    })

    it('20 entries with 6 boosts group in the middle (6 > 20/4)', () => {
      const boosts = Array.from({ length: 6 }, (_, i) => makeBoostPost(`b${i}`))
      const ordinary = Array.from({ length: 14 }, (_, i) =>
        makeOrdinaryPost(`o${i}`)
      )
      const statuses = [
        boosts[0],
        ordinary[0],
        boosts[1],
        ordinary[1],
        boosts[2],
        ordinary[2],
        boosts[3],
        ordinary[3],
        boosts[4],
        ordinary[4],
        boosts[5],
        ...ordinary.slice(5)
      ]
      expect(statuses).toHaveLength(20)
      const rows = groupTimelinePage(statuses, { groupBoosts: true })

      const boostRow = rows.find((r) => r.kind === 'boosts')
      expect(boostRow).toBeDefined()
      expect(boostRow?.kind).toBe('boosts')
      if (boostRow?.kind === 'boosts') {
        expect(boostRow.entryIds).toHaveLength(6)
      }
      // Placed around the middle (half of 14 non-boosts is index 7)
      const boostRowIdx = rows.findIndex((r) => r.kind === 'boosts')
      expect(boostRowIdx).toBe(7)
    })

    it('20 entries with exactly 3 consecutive boosts group', () => {
      const statuses = [
        makeOrdinaryPost('1'),
        makeBoostPost('1'),
        makeBoostPost('2'),
        makeBoostPost('3'), // 3 consecutive boosts
        ...Array.from({ length: 16 }, (_, i) => makeOrdinaryPost(`rest${i}`))
      ]
      expect(statuses).toHaveLength(20)
      const rows = groupTimelinePage(statuses, { groupBoosts: true })
      expect(rows.some((r) => r.kind === 'boosts')).toBe(true)
    })

    it('20 entries with 16 eligible boosts group at the end (16 > 15)', () => {
      const boosts = Array.from({ length: 16 }, (_, i) =>
        makeBoostPost(`b${i}`)
      )
      const ordinary = Array.from({ length: 4 }, (_, i) =>
        makeOrdinaryPost(`o${i}`)
      )
      const statuses = [...boosts, ...ordinary]
      expect(statuses).toHaveLength(20)

      const rows = groupTimelinePage(statuses, { groupBoosts: true })
      const lastRow = rows[rows.length - 1]
      expect(lastRow.kind).toBe('boosts')
      if (lastRow.kind === 'boosts') {
        expect(lastRow.entryIds).toHaveLength(16)
      }
    })

    it('20 entries with 15 eligible boosts group in the middle, NOT at the end (strict > 3/4)', () => {
      const boosts = Array.from({ length: 15 }, (_, i) =>
        makeBoostPost(`b${i}`)
      )
      const ordinary = Array.from({ length: 5 }, (_, i) =>
        makeOrdinaryPost(`o${i}`)
      )
      const statuses = [...boosts, ...ordinary]
      expect(statuses).toHaveLength(20)

      const rows = groupTimelinePage(statuses, { groupBoosts: true })
      const lastRow = rows[rows.length - 1]
      // 15 is not strictly > 15, so carousel is in the middle, not at the end
      expect(lastRow.kind).not.toBe('boosts')
      expect(rows.some((r) => r.kind === 'boosts')).toBe(true)
    })

    it('excludes Group-actor boosts from carousel eligibility', () => {
      const groupBoost = createMockAnnounce({
        id: 'https://activities.local/statuses/grp-boost',
        actor: mockGroupActor,
        actorId: mockGroupActor.id,
        originalStatus: makeOrdinaryPost('grp-target')
      })

      const ordinaryBoosts = Array.from({ length: 5 }, (_, i) =>
        makeBoostPost(`ob${i}`)
      )
      const ordinary = Array.from({ length: 14 }, (_, i) =>
        makeOrdinaryPost(`o${i}`)
      )
      // Total 20 statuses: 1 group boost + 5 ordinary boosts + 14 ordinary posts
      // Without group boost, there are only 5 ordinary boosts (5 <= 20/4) and not 3 in a row -> should not group!
      const statuses = [
        groupBoost,
        ordinary[0],
        ordinaryBoosts[0],
        ordinary[1],
        ordinaryBoosts[1],
        ordinary[2],
        ordinaryBoosts[2],
        ordinary[3],
        ordinaryBoosts[3],
        ordinary[4],
        ordinaryBoosts[4],
        ...ordinary.slice(5)
      ]
      expect(statuses).toHaveLength(20)

      const rows = groupTimelinePage(statuses, { groupBoosts: true })
      expect(rows.some((r) => r.kind === 'boosts')).toBe(false)
    })
  })

  describe('Alias Resolution & AP URLs', () => {
    it('connects replies when inReplyToId matches a parent url instead of its id', () => {
      const parent = createMockNote({
        id: 'https://activities.local/users/alice/statuses/parent-id',
        url: 'https://activities.local/@alice/parent-permalink'
      })
      const reply = createMockNote({
        id: 'https://activities.local/users/bob/statuses/reply-id',
        actor: mockBob,
        actorId: mockBob.id,
        reply: parent.url // referencing URL alias!
      })

      const rows = groupTimelinePage([reply, parent])
      expect(rows).toHaveLength(1)
      expect(rows[0].kind).toBe('conversation')
      expect(getRowEntryIds(rows[0])).toEqual([parent.id, reply.id])
    })

    it('connects replies when inReplyToId matches publicId alias', () => {
      const parent = createMockNote({
        id: 'https://activities.local/users/alice/statuses/p1',
        publicId: '0191eb7e-8c54-7243-b921-94efd7d5d345'
      })
      const reply = createMockNote({
        id: 'https://activities.local/users/alice/statuses/r1',
        reply: '0191eb7e-8c54-7243-b921-94efd7d5d345'
      })

      const rows = groupTimelinePage([reply, parent])
      expect(rows).toHaveLength(1)
      expect(rows[0].kind).toBe('thread')
      expect(getRowEntryIds(rows[0])).toEqual([parent.id, reply.id])
    })
  })

  describe('Mastodon Status Compatibility', () => {
    it('correctly processes MastodonStatus arrays into threads and conversations', () => {
      const mParent = createMockMastodonStatus({
        id: '1001',
        in_reply_to_id: null
      })
      const mChild = createMockMastodonStatus({
        id: '1002',
        in_reply_to_id: '1001'
      })

      const rows = groupTimelinePage([mChild, mParent])
      expect(rows).toHaveLength(1)
      expect(rows[0].kind).toBe('thread')
      expect(getRowEntryIds(rows[0])).toEqual(['1001', '1002'])
    })
  })

  describe('Stability of Keys & Immutability Guarantees', () => {
    it('produces deterministic and stable keys across multiple calls', () => {
      const note1 = createMockNote({
        id: 'https://activities.local/statuses/stable-1'
      })
      const note2 = createMockNote({
        id: 'https://activities.local/statuses/stable-2',
        reply: note1.id
      })

      const run1 = groupTimelinePage([note2, note1])
      const run2 = groupTimelinePage([note2, note1])

      expect(run1[0].key).toBe(run2[0].key)
      expect(run1[0].key).toBe(`thread:${note1.id}:${note2.id}`)
    })

    it('preserves immutability when input array and status objects are frozen', () => {
      const s1 = Object.freeze(
        createMockNote({ id: 'https://activities.local/statuses/f1' })
      )
      const s2 = Object.freeze(
        createMockNote({
          id: 'https://activities.local/statuses/f2',
          reply: s1.id
        })
      )
      const frozenArray = Object.freeze([s2, s1])

      expect(() => {
        const rows = groupTimelinePage(frozenArray)
        expect(rows).toHaveLength(1)
        expect(rows[0].kind).toBe('thread')
      }).not.toThrow()
    })
  })
})
