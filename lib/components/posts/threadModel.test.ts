import { describe, expect, it } from 'vitest'

import {
  BASE_TIME,
  createMockNote,
  mockAlice,
  mockBob,
  mockCarol,
  mockDave
} from '@/lib/components/posts/__fixtures__/timeline-context'
import {
  THREAD_COLLAPSE_THRESHOLD,
  buildThreadTree
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

  it('expands all branches when total descendants < 10', () => {
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

    expect(tree.descendants[0].initiallyCollapsed).toBe(false)
  })

  it('collapses deeper branches when total descendants >= 10', () => {
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

    const replies = Array.from({ length: 9 }, (_, i) =>
      createMockNote({
        id: `https://activities.local/users/bob/statuses/sub-${i}`,
        actor: mockBob,
        actorId: mockBob.id,
        reply: b1.id,
        createdAt: BASE_TIME + 2000 + i * 1000
      })
    )

    const allDescendants = [b1, ...replies]
    expect(allDescendants.length).toBe(THREAD_COLLAPSE_THRESHOLD)

    const tree = buildThreadTree({
      focusedStatus: a1,
      descendants: allDescendants
    })

    expect(tree.totalDescendants).toBe(10)
    expect(tree.descendants[0].initiallyCollapsed).toBe(true)
    expect(tree.descendants[0].totalDescendantCount).toBe(9)
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
})
