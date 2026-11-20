import { describe, expect, it } from 'vitest'

import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob,
  mockCarol,
  mockDave,
  mockEve,
  mockFrank
} from '@/lib/components/posts/__fixtures__/timeline-context'
import {
  CONVERSATION_VISIBLE_POSTS,
  THREAD_FOLD_THRESHOLD,
  buildThreadConversations,
  buildThreadTree,
  countThreadNodes,
  getConversationFoldKey,
  getFoldKeysRevealing,
  getOthersFoldKey
} from '@/lib/components/posts/threadModel'

describe('threadModel', () => {
  it('implements author promotion and nesting: A2 by Alice, B1 by Bob, C1 by Carol beneath B1', () => {
    // Focused A1 by Alice
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME,
      text: 'A1: Focused root'
    })

    // A2 by Alice -> A1, 10:04
    const a2 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a2',
      actor: mockAlice,
      actorId: mockAlice.id,
      reply: a1.id,
      createdAt: BASE_TIME + 240000, // 10:04
      text: 'A2: Author continuation'
    })

    // B1 by Bob -> A1, 10:01
    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 60000, // 10:01
      text: 'B1: Bob reply to root'
    })

    // C1 by Carol -> B1, 10:02
    const c1 = createMockNote({
      id: 'https://activities.local/users/carol/statuses/c1',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: b1.id,
      createdAt: BASE_TIME + 120000, // 10:02
      text: 'C1: Carol reply to Bob'
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [c1, b1, a2]
    })

    expect(tree.totalDescendants).toBe(3)
    // Expected top-level order: A2, B1
    expect(tree.descendants.map((d) => d.status.id)).toEqual([a2.id, b1.id])

    // A2 has no replies
    expect(tree.descendants[0].replies).toEqual([])
    expect(tree.descendants[0].totalDescendantCount).toBe(0)

    // C1 stays beneath B1
    const b1Node = tree.descendants[1]
    expect(b1Node.replies.map((r) => r.status.id)).toEqual([c1.id])
    expect(b1Node.totalDescendantCount).toBe(1)
    expect(b1Node.replies[0].depth).toBe(1)
  })

  it('marks orphan descendants with parentUnavailable flag', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })

    const orphan = createMockNote({
      id: 'https://activities.local/users/dave/statuses/orphan',
      actor: mockDave,
      actorId: mockDave.id,
      reply: 'https://activities.local/users/deleted/statuses/missing',
      createdAt: BASE_TIME + 60000,
      text: 'Reply to deleted post'
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [orphan]
    })

    expect(tree.descendants).toHaveLength(1)
    expect(tree.descendants[0].status.id).toBe(orphan.id)
    expect(tree.descendants[0].parentUnavailable).toBe(true)
  })

  it('shows a reply whose parent the context left out (hidden mid-thread) as a reply to an unavailable post, with its own replies nested', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })
    // Bob's reply to A1 is hidden from this viewer (muted, followers-only, …),
    // so the context returns Carol's reply to it and Dave's reply to Carol
    // without it.
    const hiddenBobReplyId = 'https://activities.local/users/bob/statuses/b1'
    const c1 = createMockNote({
      id: 'https://activities.local/users/carol/statuses/c1',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: hiddenBobReplyId,
      createdAt: BASE_TIME + 120000
    })
    const d1 = createMockNote({
      id: 'https://activities.local/users/dave/statuses/d1',
      actor: mockDave,
      actorId: mockDave.id,
      reply: c1.id,
      createdAt: BASE_TIME + 180000
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [c1, d1]
    })

    expect(tree.totalDescendants).toBe(2)
    expect(tree.descendants).toHaveLength(1)
    const c1Node = tree.descendants[0]
    expect(c1Node.status.id).toBe(c1.id)
    expect(c1Node.parentUnavailable).toBe(true)
    expect(c1Node.replies.map((node) => node.status.id)).toEqual([d1.id])
    expect(c1Node.replies[0].parentUnavailable).toBeUndefined()
  })

  it('shows no fold rows while the loaded replies stay under the fold threshold', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })

    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })

    const c1 = createMockNote({
      id: 'https://activities.local/users/carol/statuses/c1',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: b1.id,
      createdAt: BASE_TIME + 2000
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [b1, c1]
    })

    expect(tree.totalDescendants).toBeLessThan(THREAD_FOLD_THRESHOLD)
    const [conversation] = buildThreadConversations(tree.descendants)
    expect(conversation.rows.map((row) => row.kind)).toEqual(['post', 'post'])
  })

  it('folds a chain after three posts once the loaded replies reach the threshold', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })

    // 10 descendants: 1 top-level node with 9 replies
    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })

    const replies = Array.from({ length: THREAD_FOLD_THRESHOLD - 1 }, (_, i) =>
      createMockNote({
        id: `https://activities.local/users/bob/statuses/sub-${i}`,
        actor: mockBob,
        actorId: mockBob.id,
        reply:
          i === 0
            ? b1.id
            : `https://activities.local/users/bob/statuses/sub-${i - 1}`,
        createdAt: BASE_TIME + 2000 + i * 1000
      })
    )

    const allDescendants = [b1, ...replies]
    expect(allDescendants.length).toBe(THREAD_FOLD_THRESHOLD)

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: allDescendants
    })

    expect(tree.totalDescendants).toBe(THREAD_FOLD_THRESHOLD)
    expect(tree.descendants[0].totalDescendantCount).toBe(
      THREAD_FOLD_THRESHOLD - 1
    )

    const [conversation] = buildThreadConversations(tree.descendants)
    expect(conversation.rows.map((row) => row.kind)).toEqual([
      'post',
      'post',
      'post',
      'fold'
    ])
    // The chain's first three posts stay on the line.
    expect(conversation.rows[0]).toMatchObject({
      kind: 'post',
      key: b1.id,
      lineAbove: false,
      lineBelow: true
    })
    expect(conversation.rows[1]).toMatchObject({
      kind: 'post',
      lineAbove: true,
      lineBelow: true
    })
    expect(conversation.rows[2]).toMatchObject({
      kind: 'post',
      lineAbove: true,
      lineBelow: true
    })
    expect(conversation.rows[3]).toMatchObject({
      kind: 'fold',
      fold: 'conversation',
      key: getConversationFoldKey(b1.id),
      hiddenCount: THREAD_FOLD_THRESHOLD - CONVERSATION_VISIBLE_POSTS,
      expanded: false,
      lineAbove: true,
      lineBelow: false
    })
  })

  it('keeps an expanded chain fold between the third and fourth posts, the line running on', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })
    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })
    const replies = Array.from({ length: THREAD_FOLD_THRESHOLD - 1 }, (_, i) =>
      createMockNote({
        id: `https://activities.local/users/bob/statuses/sub-${i}`,
        actor: mockBob,
        actorId: mockBob.id,
        reply:
          i === 0
            ? b1.id
            : `https://activities.local/users/bob/statuses/sub-${i - 1}`,
        createdAt: BASE_TIME + 2000 + i * 1000
      })
    )
    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [b1, ...replies]
    })

    const [conversation] = buildThreadConversations(
      tree.descendants,
      new Set([getConversationFoldKey(b1.id)])
    )

    expect(conversation.rows).toHaveLength(THREAD_FOLD_THRESHOLD + 1)
    expect(conversation.rows[3]).toMatchObject({
      kind: 'fold',
      fold: 'conversation',
      expanded: true,
      lineAbove: true,
      lineBelow: true
    })
    expect(conversation.rows[4]).toMatchObject({
      kind: 'post',
      key: replies[2].id,
      lineAbove: true
    })
  })

  it('folds a shown post’s other replies into one fold after its chain', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })
    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })
    const c1 = createMockNote({
      id: 'https://activities.local/users/carol/statuses/c1',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: b1.id,
      createdAt: BASE_TIME + 2000
    })
    const d1 = createMockNote({
      id: 'https://activities.local/users/dave/statuses/d1',
      actor: mockDave,
      actorId: mockDave.id,
      reply: b1.id,
      createdAt: BASE_TIME + 3000
    })
    const e1 = createMockNote({
      id: 'https://activities.local/users/eve/statuses/e1',
      actor: mockEve,
      actorId: mockEve.id,
      reply: d1.id,
      createdAt: BASE_TIME + 4000
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [b1, c1, d1, e1]
    })
    expect(countThreadNodes(tree.descendants)).toBe(4)

    // Forced on: the count alone would leave these four replies unfolded.
    const [conversation] = buildThreadConversations(
      tree.descendants,
      new Set(),
      true
    )

    expect(conversation.rows.map((row) => row.kind)).toEqual([
      'post',
      'post',
      'fold'
    ])
    expect(conversation.rows[2]).toMatchObject({
      kind: 'fold',
      fold: 'others',
      key: getOthersFoldKey(b1.id),
      parent: b1,
      hiddenCount: 2,
      expanded: false
    })
  })

  it('opens a post’s other replies in place when its fold is expanded', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })
    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })
    const c1 = createMockNote({
      id: 'https://activities.local/users/carol/statuses/c1',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: b1.id,
      createdAt: BASE_TIME + 2000
    })
    const d1 = createMockNote({
      id: 'https://activities.local/users/dave/statuses/d1',
      actor: mockDave,
      actorId: mockDave.id,
      reply: b1.id,
      createdAt: BASE_TIME + 3000
    })
    const e1 = createMockNote({
      id: 'https://activities.local/users/eve/statuses/e1',
      actor: mockEve,
      actorId: mockEve.id,
      reply: d1.id,
      createdAt: BASE_TIME + 4000
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [b1, c1, d1, e1]
    })
    const [conversation] = buildThreadConversations(
      tree.descendants,
      new Set([getOthersFoldKey(b1.id)]),
      true
    )

    expect(conversation.rows.map((row) => row.kind)).toEqual([
      'post',
      'post',
      'fold',
      'post',
      'post'
    ])
    expect(conversation.rows[2]).toMatchObject({
      kind: 'fold',
      fold: 'others',
      expanded: true
    })
    expect(conversation.rows[3]).toMatchObject({ kind: 'post', key: d1.id })
    expect(conversation.rows[4]).toMatchObject({ kind: 'post', key: e1.id })
  })

  it('puts a deeper post’s other replies before a shallower post’s', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })
    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })
    const c1 = createMockNote({
      id: 'https://activities.local/users/carol/statuses/c1',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: b1.id,
      createdAt: BASE_TIME + 2000
    })
    const d1 = createMockNote({
      id: 'https://activities.local/users/dave/statuses/d1',
      actor: mockDave,
      actorId: mockDave.id,
      reply: b1.id,
      createdAt: BASE_TIME + 3000
    })
    const e1 = createMockNote({
      id: 'https://activities.local/users/eve/statuses/e1',
      actor: mockEve,
      actorId: mockEve.id,
      reply: c1.id,
      createdAt: BASE_TIME + 4000
    })
    const f1 = createMockNote({
      id: 'https://activities.local/users/frank/statuses/f1',
      actor: mockFrank,
      actorId: mockFrank.id,
      reply: c1.id,
      createdAt: BASE_TIME + 5000
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [b1, c1, d1, e1, f1]
    })
    const [conversation] = buildThreadConversations(tree.descendants)

    // The chain is b1 → c1 → e1; f1 (c1's other reply) comes before d1
    // (b1's other reply), depth-first.
    expect(conversation.rows.map((row) => row.key)).toEqual([
      b1.id,
      c1.id,
      e1.id,
      f1.id,
      d1.id
    ])
  })

  it('keeps a fold open when more replies arrive under the same key', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })
    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })
    const replies = Array.from({ length: THREAD_FOLD_THRESHOLD - 1 }, (_, i) =>
      createMockNote({
        id: `https://activities.local/users/bob/statuses/sub-${i}`,
        actor: mockBob,
        actorId: mockBob.id,
        reply:
          i === 0
            ? b1.id
            : `https://activities.local/users/bob/statuses/sub-${i - 1}`,
        createdAt: BASE_TIME + 2000 + i * 1000
      })
    )
    const expandedFolds = new Set([getConversationFoldKey(b1.id)])

    const before = buildThreadTree({
      focusedStatus: a1,
      descendants: [b1, ...replies]
    })
    const [beforeConversation] = buildThreadConversations(
      before.descendants,
      expandedFolds
    )
    expect(beforeConversation.rows[3]).toMatchObject({
      kind: 'fold',
      expanded: true,
      hiddenCount: THREAD_FOLD_THRESHOLD - CONVERSATION_VISIBLE_POSTS
    })

    const extra = createMockNote({
      id: 'https://activities.local/users/bob/statuses/sub-9',
      actor: mockBob,
      actorId: mockBob.id,
      reply: replies[replies.length - 1].id,
      createdAt: BASE_TIME + 20000
    })
    const after = buildThreadTree({
      focusedStatus: a1,
      descendants: [b1, ...replies, extra]
    })
    const [afterConversation] = buildThreadConversations(
      after.descendants,
      expandedFolds
    )
    expect(afterConversation.rows[3]).toMatchObject({
      kind: 'fold',
      expanded: true,
      hiddenCount: THREAD_FOLD_THRESHOLD + 1 - CONVERSATION_VISIBLE_POSTS
    })
  })

  it('folds on the caller’s word, whatever the loaded count', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })
    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })
    const c1 = createMockNote({
      id: 'https://activities.local/users/carol/statuses/c1',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: b1.id,
      createdAt: BASE_TIME + 2000
    })
    const d1 = createMockNote({
      id: 'https://activities.local/users/dave/statuses/d1',
      actor: mockDave,
      actorId: mockDave.id,
      reply: c1.id,
      createdAt: BASE_TIME + 3000
    })
    const e1 = createMockNote({
      id: 'https://activities.local/users/eve/statuses/e1',
      actor: mockEve,
      actorId: mockEve.id,
      reply: d1.id,
      createdAt: BASE_TIME + 4000
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [b1, c1, d1, e1]
    })

    const [unfolded] = buildThreadConversations(tree.descendants)
    expect(unfolded.rows.map((row) => row.kind)).toEqual([
      'post',
      'post',
      'post',
      'post'
    ])

    const [folded] = buildThreadConversations(tree.descendants, new Set(), true)
    expect(folded.rows.map((row) => row.kind)).toEqual([
      'post',
      'post',
      'post',
      'fold'
    ])
    expect(folded.rows[3]).toMatchObject({
      kind: 'fold',
      fold: 'conversation',
      hiddenCount: 1
    })
  })

  it('handles cyclic descendant references gracefully', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })

    const cycleX = createMockNote({
      id: 'https://activities.local/users/bob/statuses/cycle-x',
      actor: mockBob,
      actorId: mockBob.id,
      reply: 'https://activities.local/users/carol/statuses/cycle-y',
      createdAt: BASE_TIME + 1000
    })

    const cycleY = createMockNote({
      id: 'https://activities.local/users/carol/statuses/cycle-y',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: cycleX.id,
      createdAt: BASE_TIME + 2000
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [cycleX, cycleY]
    })

    expect(tree.descendants.length).toBeGreaterThan(0)
    // Both should be handled without throwing or infinite looping
  })

  it('is pure and does not mutate input arrays', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })

    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })

    const descendants = Object.freeze([b1])
    expect(() =>
      buildThreadTree({
        focusedStatus: a1,
        descendants: descendants as unknown as any[]
      })
    ).not.toThrow()
  })

  it('nests replies targeting parent publicId cleanly beneath parent without parentUnavailable', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })

    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      publicId: 'bob-status-pub-1',
      createdAt: BASE_TIME + 1000
    })

    const c1 = createMockNote({
      id: 'https://activities.local/users/carol/statuses/c1',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: 'bob-status-pub-1',
      createdAt: BASE_TIME + 2000
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [c1, b1]
    })

    expect(tree.totalDescendants).toBe(2)
    expect(tree.descendants).toHaveLength(1)
    const b1Node = tree.descendants[0]
    expect(b1Node.status.id).toBe(b1.id)
    expect(b1Node.parentUnavailable).toBeUndefined()
    expect(b1Node.replies).toHaveLength(1)
    const c1Node = b1Node.replies[0]
    expect(c1Node.status.id).toBe(c1.id)
    expect(c1Node.parentUnavailable).toBeUndefined()
  })

  it('nests direct replies targeting focusedStatus publicId without parentUnavailable', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      publicId: 'alice-status-pub-1',
      createdAt: BASE_TIME
    })

    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: 'alice-status-pub-1',
      createdAt: BASE_TIME + 1000
    })

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: [b1]
    })

    expect(tree.totalDescendants).toBe(1)
    expect(tree.descendants).toHaveLength(1)
    expect(tree.descendants[0].status.id).toBe(b1.id)
    expect(tree.descendants[0].parentUnavailable).toBeUndefined()
  })

  it('associates replies targeting ancestors into ancestorReplies without parentUnavailable', () => {
    const root = createMockNote({
      id: 'https://activities.local/users/alice/statuses/root',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME,
      text: 'Ancestor Root'
    })

    const focused = createMockNote({
      id: 'https://activities.local/users/alice/statuses/focused',
      actor: mockAlice,
      actorId: mockAlice.id,
      reply: root.id,
      createdAt: BASE_TIME + 60000,
      text: 'Focused Status'
    })

    const replyToAncestor = createMockNote({
      id: 'https://activities.local/users/bob/statuses/reply-to-root',
      actor: mockBob,
      actorId: mockBob.id,
      reply: root.id,
      createdAt: BASE_TIME + 70000,
      text: 'Bob reply to root ancestor'
    })

    const tree = buildThreadTree({
      focusedStatus: focused,
      ancestors: [root],
      descendants: [replyToAncestor]
    })

    expect(tree.ancestorReplies?.[root.id]).toBeDefined()
    expect(tree.ancestorReplies?.[root.id]).toHaveLength(1)
    expect(tree.ancestorReplies?.[root.id][0].status.id).toBe(
      replyToAncestor.id
    )
    expect(tree.ancestorReplies?.[root.id][0].parentUnavailable).toBeUndefined()
    // It is not dumped into tree.descendants
    expect(tree.descendants).toHaveLength(0)
  })

  it('places priority status replies at the top next to replied message even if newer', () => {
    const root = createMockNote({
      id: 'https://activities.local/users/alice/statuses/root',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })

    const olderReply = createMockNote({
      id: 'https://activities.local/users/bob/statuses/older',
      actor: mockBob,
      actorId: mockBob.id,
      reply: root.id,
      createdAt: BASE_TIME + 1000,
      text: 'Older reply'
    })

    const newerPriorityReply = createMockNote({
      id: 'https://activities.local/users/carol/statuses/priority-reply',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: root.id,
      createdAt: BASE_TIME + 50000,
      text: 'Just created reply'
    })

    const tree = buildThreadTree({
      focusedStatus: root,
      descendants: [olderReply, newerPriorityReply],
      priorityStatusIds: new Set([newerPriorityReply.id])
    })

    expect(tree.descendants.map((d) => d.status.id)).toEqual([
      newerPriorityReply.id,
      olderReply.id
    ])
  })

  it('keeps a priority reply nested under its parent in chronological place', () => {
    const root = createMockNote({
      id: 'https://activities.local/users/alice/statuses/root',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })
    const parent = createMockNote({
      id: 'https://activities.local/users/bob/statuses/parent',
      actor: mockBob,
      actorId: mockBob.id,
      reply: root.id,
      createdAt: BASE_TIME + 1000
    })
    const olderChild = createMockNote({
      id: 'https://activities.local/users/carol/statuses/older-child',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: parent.id,
      createdAt: BASE_TIME + 2000
    })
    const newerPriorityChild = createMockNote({
      id: 'https://activities.local/users/dave/statuses/priority-child',
      actor: mockDave,
      actorId: mockDave.id,
      reply: parent.id,
      createdAt: BASE_TIME + 3000
    })

    const tree = buildThreadTree({
      focusedStatus: root,
      descendants: [parent, olderChild, newerPriorityChild],
      priorityStatusIds: new Set([newerPriorityChild.id])
    })

    // The priority tier only lifts top-level replies: nested, the newer reply
    // keeps its chronological place after the older one.
    expect(tree.descendants.map((node) => node.status.id)).toEqual([parent.id])
    expect(tree.descendants[0].replies.map((node) => node.status.id)).toEqual([
      olderChild.id,
      newerPriorityChild.id
    ])
  })

  it('names every fold on the way to a reply, matching parents by id and url', () => {
    const a1 = createMockNote({
      id: 'https://activities.local/users/alice/statuses/a1',
      actor: mockAlice,
      actorId: mockAlice.id,
      createdAt: BASE_TIME
    })
    const b1 = createMockNote({
      id: 'https://activities.local/users/bob/statuses/b1',
      actor: mockBob,
      actorId: mockBob.id,
      reply: a1.id,
      createdAt: BASE_TIME + 1000
    })
    const c1 = createMockNote({
      id: 'https://activities.local/users/carol/statuses/c1',
      actor: mockCarol,
      actorId: mockCarol.id,
      reply: b1.id,
      createdAt: BASE_TIME + 2000
    })
    const byId = createMockNote({
      id: 'https://activities.local/users/dave/statuses/by-id',
      actor: mockDave,
      actorId: mockDave.id,
      reply: c1.id,
      createdAt: BASE_TIME + 3000
    })
    const byUrl = createMockNote({
      id: 'https://activities.local/users/eve/statuses/by-url',
      actor: mockEve,
      actorId: mockEve.id,
      reply: c1.url,
      createdAt: BASE_TIME + 4000
    })

    const expected = [
      getConversationFoldKey(c1.id),
      getOthersFoldKey(c1.id),
      getConversationFoldKey(b1.id),
      getOthersFoldKey(b1.id),
      getConversationFoldKey(a1.id),
      getOthersFoldKey(a1.id)
    ]

    expect(getFoldKeysRevealing(byId, [a1, b1, c1])).toEqual(expected)
    expect(getFoldKeysRevealing(byUrl, [a1, b1, c1])).toEqual(expected)
  })
})
