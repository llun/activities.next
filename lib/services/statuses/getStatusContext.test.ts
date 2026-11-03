import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import {
  ANONYMOUS_DESCENDANTS_DEPTH_LIMIT,
  DESCENDANTS_VISIT_FACTOR,
  getStatusContext
} from '@/lib/services/statuses/getStatusContext'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_FOLLOWER_URL, ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('getStatusContext', () => {
  const { database, prepare } = createTestDatabase()
  let actor1: Actor

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromId({ id: ACTOR1_ID }))!
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    await database.deleteBlock({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID
    })
    await database.deleteMute({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR3_ID
    })
  })

  it('resolves focus status by ID, URL, or publicId', async () => {
    const statusId = `${ACTOR1_ID}/statuses/ctx-resolve-test`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Resolve test note',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const byId = await getStatusContext({ database, statusId })
    expect(byId.status?.id).toBe(statusId)

    const pubId = await statusPublicId(database, statusId)
    const byPublicId = await getStatusContext({ database, statusId: pubId })
    expect(byPublicId.status?.id).toBe(statusId)
  })

  it('loads ancestors root-to-parent up to limit and handles cycles', async () => {
    const rootId = `${ACTOR1_ID}/statuses/ctx-anc-root`
    const midId = `${ACTOR1_ID}/statuses/ctx-anc-mid`
    const leafId = `${ACTOR1_ID}/statuses/ctx-anc-leaf`

    await database.createNote({
      id: rootId,
      url: rootId,
      actorId: ACTOR1_ID,
      text: 'Ancestor Root',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    await database.createNote({
      id: midId,
      url: midId,
      actorId: ACTOR1_ID,
      text: 'Ancestor Mid',
      reply: rootId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    await database.createNote({
      id: leafId,
      url: leafId,
      actorId: ACTOR1_ID,
      text: 'Ancestor Leaf',
      reply: midId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const result = await getStatusContext({
      database,
      statusId: leafId,
      currentActor: actor1
    })

    expect(result.ancestors.map((s) => s.id)).toEqual([rootId, midId])
    expect(result.descendants).toEqual([])
    expect(result.hasMoreAncestors).toBe(false)
  })

  it('reports hasMoreAncestors when ancestorsLimit is exceeded', async () => {
    const rootId = `${ACTOR1_ID}/statuses/ctx-limit-root`
    const midId = `${ACTOR1_ID}/statuses/ctx-limit-mid`
    const leafId = `${ACTOR1_ID}/statuses/ctx-limit-leaf`

    await database.createNote({
      id: rootId,
      url: rootId,
      actorId: ACTOR1_ID,
      text: 'Root',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: midId,
      url: midId,
      actorId: ACTOR1_ID,
      text: 'Mid',
      reply: rootId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: leafId,
      url: leafId,
      actorId: ACTOR1_ID,
      text: 'Leaf',
      reply: midId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const result = await getStatusContext({
      database,
      statusId: leafId,
      currentActor: actor1,
      ancestorsLimit: 1
    })

    expect(result.ancestors).toHaveLength(1)
    expect(result.ancestors[0].id).toBe(midId)
    expect(result.hasMoreAncestors).toBe(true)
  })

  describe('missingParentId', () => {
    const MISSING = 'https://remote.example/users/x/statuses/never-stored'

    it('names the unstored parent above a hidden ancestor', async () => {
      const hiddenId = `${ACTOR2_ID}/statuses/ctx-missing-hidden`
      const leafId = `${ACTOR1_ID}/statuses/ctx-missing-leaf`
      // Followers-only by an actor the anonymous viewer cannot follow.
      await database.createNote({
        id: hiddenId,
        url: hiddenId,
        actorId: ACTOR2_ID,
        text: 'Hidden ancestor',
        reply: MISSING,
        to: [ACTOR2_FOLLOWER_URL],
        cc: []
      })
      await database.createNote({
        id: leafId,
        url: leafId,
        actorId: ACTOR1_ID,
        text: 'Leaf',
        reply: hiddenId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const context = await getStatusContext({ database, statusId: leafId })

      expect(context.ancestors).toEqual([])
      expect(context.missingParentId).toBe(MISSING)
    })

    it('is empty when the chain reaches its root', async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-missing-root`
      const leafId = `${ACTOR1_ID}/statuses/ctx-missing-root-leaf`
      await database.createNote({
        id: rootId,
        url: rootId,
        actorId: ACTOR1_ID,
        text: 'Root',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: leafId,
        url: leafId,
        actorId: ACTOR1_ID,
        text: 'Leaf',
        reply: rootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const context = await getStatusContext({ database, statusId: leafId })

      expect(context.ancestors.map((status) => status.id)).toEqual([rootId])
      expect(context.missingParentId).toBe('')
    })
  })

  it('loads descendants with deterministic (createdAt, id) ordering', async () => {
    const rootId = `${ACTOR1_ID}/statuses/ctx-desc-root`
    const childAId = `${ACTOR1_ID}/statuses/ctx-desc-child-a`
    const childBId = `${ACTOR1_ID}/statuses/ctx-desc-child-b`
    const gcId = `${ACTOR1_ID}/statuses/ctx-desc-gc`

    await database.createNote({
      id: rootId,
      url: rootId,
      actorId: ACTOR1_ID,
      text: 'Desc Root',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    await database.createNote({
      id: childAId,
      url: childAId,
      actorId: ACTOR1_ID,
      text: 'Child A',
      reply: rootId,
      createdAt: 1000,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    await database.createNote({
      id: childBId,
      url: childBId,
      actorId: ACTOR2_ID,
      text: 'Child B',
      reply: rootId,
      createdAt: 2000,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    await database.createNote({
      id: gcId,
      url: gcId,
      actorId: ACTOR3_ID,
      text: 'Grandchild of A',
      reply: childAId,
      createdAt: 1500,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const result = await getStatusContext({
      database,
      statusId: rootId,
      currentActor: actor1
    })

    // Depth-first pre-order: Root -> Child A -> Grandchild of A -> Child B
    expect(result.descendants.map((s) => s.id)).toEqual([
      childAId,
      gcId,
      childBId
    ])
  })

  it('handles cyclic reply references without infinite looping', async () => {
    const cycle1Id = `${ACTOR1_ID}/statuses/ctx-cycle-1`
    const cycle2Id = `${ACTOR1_ID}/statuses/ctx-cycle-2`

    await database.createNote({
      id: cycle1Id,
      url: cycle1Id,
      actorId: ACTOR1_ID,
      text: 'Cycle 1',
      reply: cycle2Id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    await database.createNote({
      id: cycle2Id,
      url: cycle2Id,
      actorId: ACTOR1_ID,
      text: 'Cycle 2',
      reply: cycle1Id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const result = await getStatusContext({
      database,
      statusId: cycle1Id,
      currentActor: actor1
    })

    expect(result.status).not.toBeNull()
    expect(result.ancestors.map((s) => s.id)).toEqual([cycle2Id])
  })

  describe('blocked and muted statuses', () => {
    const modRootId = `${ACTOR1_ID}/statuses/ctx-mod-root`
    const blockedParentId = `${ACTOR2_ID}/statuses/ctx-mod-blocked-parent`
    const mutedParentId = `${ACTOR3_ID}/statuses/ctx-mod-muted-parent`
    const modLeafId = `${ACTOR1_ID}/statuses/ctx-mod-leaf`
    const blockedReplyId = `${ACTOR2_ID}/statuses/ctx-mod-blocked-reply`
    const mutedReplyId = `${ACTOR3_ID}/statuses/ctx-mod-muted-reply`
    const allowedReplyId = `${ACTOR1_ID}/statuses/ctx-mod-allowed-reply`

    beforeAll(async () => {
      await database.createNote({
        id: modRootId,
        url: modRootId,
        actorId: ACTOR1_ID,
        text: 'Moderation Root',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createNote({
        id: blockedParentId,
        url: blockedParentId,
        actorId: ACTOR2_ID,
        text: 'Blocked Parent',
        reply: modRootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createNote({
        id: mutedParentId,
        url: mutedParentId,
        actorId: ACTOR3_ID,
        text: 'Muted Parent',
        reply: blockedParentId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createNote({
        id: modLeafId,
        url: modLeafId,
        actorId: ACTOR1_ID,
        text: 'Leaf Note',
        reply: mutedParentId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      // Descendants on modRootId
      await database.createNote({
        id: blockedReplyId,
        url: blockedReplyId,
        actorId: ACTOR2_ID,
        text: 'Blocked Reply',
        reply: modRootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createNote({
        id: mutedReplyId,
        url: mutedReplyId,
        actorId: ACTOR3_ID,
        text: 'Muted Reply',
        reply: modRootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createNote({
        id: allowedReplyId,
        url: allowedReplyId,
        actorId: ACTOR1_ID,
        text: 'Allowed Reply',
        reply: modRootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
    })

    beforeEach(async () => {
      // ACTOR1_ID blocks ACTOR2_ID and mutes ACTOR3_ID
      await database.createBlock({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR2_ID,
        uri: `${ACTOR1_ID}#blocks/status-context-test`
      })
      await database.createMute({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR3_ID,
        notifications: false,
        endsAt: null
      })
    })

    afterEach(async () => {
      await database.deleteBlock({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR2_ID
      })
      await database.deleteMute({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR3_ID
      })
    })

    it('excludes blocked and muted ancestors', async () => {
      // When viewed by actor1:
      // Ancestors of modLeafId should exclude blockedParentId and mutedParentId, but include modRootId
      const leafContext = await getStatusContext({
        database,
        statusId: modLeafId,
        currentActor: actor1
      })
      const ancestorIds = leafContext.ancestors.map((s) => s.id)
      expect(ancestorIds).toContain(modRootId)
      expect(ancestorIds).not.toContain(blockedParentId)
      expect(ancestorIds).not.toContain(mutedParentId)
    })

    it('excludes blocked and muted descendant replies', async () => {
      // Descendants of modRootId should exclude blockedReplyId and mutedReplyId, but include allowedReplyId
      const rootContext = await getStatusContext({
        database,
        statusId: modRootId,
        currentActor: actor1
      })
      const descendantIds = rootContext.descendants.map((s) => s.id)
      expect(descendantIds).toContain(allowedReplyId)
      expect(descendantIds).not.toContain(blockedReplyId)
      expect(descendantIds).not.toContain(mutedReplyId)
    })
  })

  it('orders siblings with the same createdAt by id, across reply pages', async () => {
    const rootId = `${ACTOR1_ID}/statuses/ctx-tie-root`
    await database.createNote({
      id: rootId,
      url: rootId,
      actorId: ACTOR1_ID,
      text: 'Tie root',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    // More than the first page, written out of id order, one timestamp.
    const names = ['f', 'b', 'h', 'a', 'e', 'c', 'g', 'd']
    for (const name of names) {
      const id = `${ACTOR2_ID}/statuses/ctx-tie-${name}`
      await database.createNote({
        id,
        url: id,
        actorId: ACTOR2_ID,
        text: name,
        reply: rootId,
        createdAt: 7000,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
    }

    const result = await getStatusContext({
      database,
      statusId: rootId,
      currentActor: actor1
    })

    expect(result.descendants.map((s) => s.id)).toEqual(
      [...names].sort().map((name) => `${ACTOR2_ID}/statuses/ctx-tie-${name}`)
    )
  })

  describe('per-status descendant filtering, limits and the author self-thread', () => {
    const note = (
      id: string,
      actorId: string,
      values: {
        reply?: string
        createdAt?: number
        to?: string[]
      } = {}
    ) =>
      database.createNote({
        id,
        url: id,
        actorId,
        text: id,
        reply: values.reply,
        createdAt: values.createdAt,
        to: values.to ?? [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
    const ids = (statuses: Status[]) => statuses.map((item) => item.id)

    afterEach(async () => {
      await database.deleteActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'llun.dev'
      })
    })

    it('returns the reply under a muted author’s reply', async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-muted-sub-root`
      const mutedId = `${ACTOR3_ID}/statuses/ctx-muted-sub-reply`
      const childId = `${ACTOR4_ID}/statuses/ctx-muted-sub-child`
      await note(rootId, ACTOR1_ID)
      await note(mutedId, ACTOR3_ID, { reply: rootId, createdAt: 1000 })
      await note(childId, ACTOR4_ID, { reply: mutedId, createdAt: 2000 })
      await database.createMute({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR3_ID,
        notifications: false,
        endsAt: null
      })

      const result = await getStatusContext({
        database,
        statusId: rootId,
        currentActor: actor1
      })

      expect(ids(result.descendants)).toEqual([childId])
      expect(result.hasMoreDescendants).toBe(false)
    })

    it('returns a public reply under a followers-only one to a signed-out viewer, never the followers-only ones', async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-fo-root`
      const followersOnlyId = `${ACTOR2_ID}/statuses/ctx-fo-reply`
      const publicChildId = `${ACTOR3_ID}/statuses/ctx-fo-public-child`
      const followersOnlyGrandchildId = `${ACTOR2_ID}/statuses/ctx-fo-grandchild`
      await note(rootId, ACTOR1_ID)
      await note(followersOnlyId, ACTOR2_ID, {
        reply: rootId,
        createdAt: 1000,
        to: [ACTOR2_FOLLOWER_URL]
      })
      await note(publicChildId, ACTOR3_ID, {
        reply: followersOnlyId,
        createdAt: 2000
      })
      await note(followersOnlyGrandchildId, ACTOR2_ID, {
        reply: publicChildId,
        createdAt: 3000,
        to: [ACTOR2_FOLLOWER_URL]
      })

      const anonymous = await getStatusContext({
        database,
        statusId: rootId
      })
      expect(ids(anonymous.descendants)).toEqual([publicChildId])
      expect(anonymous.hasMoreDescendants).toBe(false)

      // actor1 does not follow ACTOR2 either.
      const signedIn = await getStatusContext({
        database,
        statusId: rootId,
        currentActor: actor1
      })
      expect(ids(signedIn.descendants)).toEqual([publicChildId])
    })

    it('hides a reply from a domain the viewer blocked as an ancestor and as a descendant', async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-domain-root`
      const blockedId = `${EXTERNAL_ACTOR1}/statuses/ctx-domain-reply`
      const childId = `${ACTOR4_ID}/statuses/ctx-domain-child`
      await note(rootId, ACTOR1_ID)
      await note(blockedId, EXTERNAL_ACTOR1, { reply: rootId, createdAt: 1000 })
      await note(childId, ACTOR4_ID, { reply: blockedId, createdAt: 2000 })

      const before = await getStatusContext({
        database,
        statusId: rootId,
        currentActor: actor1
      })
      expect(ids(before.descendants)).toEqual([blockedId, childId])

      await database.createActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'llun.dev'
      })

      const fromRoot = await getStatusContext({
        database,
        statusId: rootId,
        currentActor: actor1
      })
      expect(ids(fromRoot.descendants)).toEqual([childId])

      const fromChild = await getStatusContext({
        database,
        statusId: childId,
        currentActor: actor1
      })
      expect(ids(fromChild.ancestors)).toEqual([rootId])
    })

    it('reports no more descendants at exactly the limit, and more at one past it', async () => {
      const exactRootId = `${ACTOR1_ID}/statuses/ctx-exact-root`
      const overRootId = `${ACTOR1_ID}/statuses/ctx-over-root`
      await note(exactRootId, ACTOR1_ID)
      await note(overRootId, ACTOR1_ID)
      for (let index = 0; index < 4; index++) {
        if (index < 3) {
          await note(`${ACTOR2_ID}/statuses/ctx-exact-${index}`, ACTOR2_ID, {
            reply: exactRootId,
            createdAt: 1000 + index
          })
        }
        await note(`${ACTOR2_ID}/statuses/ctx-over-${index}`, ACTOR2_ID, {
          reply: overRootId,
          createdAt: 1000 + index
        })
      }

      const exact = await getStatusContext({
        database,
        statusId: exactRootId,
        currentActor: actor1,
        descendantsLimit: 3
      })
      expect(exact.descendants).toHaveLength(3)
      expect(exact.hasMoreDescendants).toBe(false)

      const over = await getStatusContext({
        database,
        statusId: overRootId,
        currentActor: actor1,
        descendantsLimit: 3
      })
      expect(ids(over.descendants)).toEqual([
        `${ACTOR2_ID}/statuses/ctx-over-0`,
        `${ACTOR2_ID}/statuses/ctx-over-1`,
        `${ACTOR2_ID}/statuses/ctx-over-2`
      ])
      expect(over.hasMoreDescendants).toBe(true)
    })

    it('reports more ancestors only when the next one exists', async () => {
      const missingParentId = `${ACTOR2_ID}/statuses/ctx-anc-missing`
      const parentId = `${ACTOR1_ID}/statuses/ctx-anc-exact-parent`
      const leafId = `${ACTOR1_ID}/statuses/ctx-anc-exact-leaf`
      await note(parentId, ACTOR1_ID, { reply: missingParentId })
      await note(leafId, ACTOR1_ID, { reply: parentId })

      const result = await getStatusContext({
        database,
        statusId: leafId,
        currentActor: actor1,
        ancestorsLimit: 1
      })
      expect(ids(result.ancestors)).toEqual([parentId])
      expect(result.hasMoreAncestors).toBe(false)
    })

    it('reports more ancestors when the next one is hidden from the viewer', async () => {
      const topId = `${ACTOR1_ID}/statuses/ctx-anc-hidden-top`
      const mutedId = `${ACTOR3_ID}/statuses/ctx-anc-hidden-muted`
      const parentId = `${ACTOR1_ID}/statuses/ctx-anc-hidden-parent`
      const leafId = `${ACTOR1_ID}/statuses/ctx-anc-hidden-leaf`
      await note(topId, ACTOR1_ID)
      await note(mutedId, ACTOR3_ID, { reply: topId })
      await note(parentId, ACTOR1_ID, { reply: mutedId })
      await note(leafId, ACTOR1_ID, { reply: parentId })
      await database.createMute({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR3_ID,
        notifications: false,
        endsAt: null
      })

      const result = await getStatusContext({
        database,
        statusId: leafId,
        currentActor: actor1,
        ancestorsLimit: 1
      })
      expect(ids(result.ancestors)).toEqual([parentId])
      expect(result.hasMoreAncestors).toBe(true)
    })

    it(`stops ${ANONYMOUS_DESCENDANTS_DEPTH_LIMIT} levels down for a signed-out viewer`, async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-depth-root`
      await note(rootId, ACTOR1_ID)
      const chainIds: string[] = []
      let parent = rootId
      for (
        let level = 1;
        level <= ANONYMOUS_DESCENDANTS_DEPTH_LIMIT + 2;
        level++
      ) {
        const id = `${ACTOR2_ID}/statuses/ctx-depth-${level}`
        await note(id, ACTOR2_ID, { reply: parent, createdAt: 1000 + level })
        chainIds.push(id)
        parent = id
      }

      const anonymous = await getStatusContext({
        database,
        statusId: rootId
      })
      expect(ids(anonymous.descendants)).toEqual(
        chainIds.slice(0, ANONYMOUS_DESCENDANTS_DEPTH_LIMIT)
      )
      expect(anonymous.hasMoreDescendants).toBe(true)

      const signedIn = await getStatusContext({
        database,
        statusId: rootId,
        currentActor: actor1
      })
      expect(ids(signedIn.descendants)).toEqual(chainIds)
      expect(signedIn.hasMoreDescendants).toBe(false)
    })

    it('keeps the author’s later parts when earlier side replies fill the limit', async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-parts-root`
      const part2Id = `${ACTOR1_ID}/statuses/ctx-parts-2`
      const part3Id = `${ACTOR1_ID}/statuses/ctx-parts-3`
      await note(rootId, ACTOR1_ID)
      const sideIds: string[] = []
      for (let index = 0; index < 61; index++) {
        const id = `${ACTOR2_ID}/statuses/ctx-parts-side-${String(index).padStart(2, '0')}`
        await note(id, ACTOR2_ID, { reply: rootId, createdAt: 1000 + index })
        sideIds.push(id)
      }
      await note(part2Id, ACTOR1_ID, { reply: rootId, createdAt: 5000 })
      await note(part3Id, ACTOR1_ID, { reply: part2Id, createdAt: 6000 })

      for (const currentActor of [undefined, actor1]) {
        const result = await getStatusContext({
          database,
          statusId: rootId,
          currentActor,
          descendantsLimit: 60
        })
        // Still depth-first pre-order: the earlier side replies, then the parts.
        expect(ids(result.descendants)).toEqual([
          ...sideIds.slice(0, 58),
          part2Id,
          part3Id
        ])
        expect(result.hasMoreDescendants).toBe(true)
      }
    })

    it('fills the limit under a wide status whose replies each have a reply', async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-wide-root`
      await note(rootId, ACTOR1_ID)
      for (let index = 0; index < 210; index++) {
        const suffix = String(index).padStart(3, '0')
        const replyId = `${ACTOR2_ID}/statuses/ctx-wide-${suffix}`
        await note(replyId, ACTOR2_ID, {
          reply: rootId,
          createdAt: 10_000 + index * 10
        })
        await note(
          `${ACTOR3_ID}/statuses/ctx-wide-child-${suffix}`,
          ACTOR3_ID,
          {
            reply: replyId,
            createdAt: 10_000 + index * 10 + 5
          }
        )
      }

      for (const currentActor of [undefined, actor1]) {
        const result = await getStatusContext({
          database,
          statusId: rootId,
          currentActor,
          descendantsLimit: 60
        })
        // Pre-order: each reply, then its child, for the first 30 replies.
        expect(ids(result.descendants)).toEqual(
          Array.from({ length: 30 }, (_, index) => {
            const suffix = String(index).padStart(3, '0')
            return [
              `${ACTOR2_ID}/statuses/ctx-wide-${suffix}`,
              `${ACTOR3_ID}/statuses/ctx-wide-child-${suffix}`
            ]
          }).flat()
        )
        expect(result.hasMoreDescendants).toBe(true)
      }
    }, 60_000)

    it('bounds the reply reads when many replies share one url', async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-shared-url-root`
      // An author-supplied url that several stored replies all carry.
      const sharedUrl = `${ACTOR2_ID}/statuses/ctx-shared-url`
      await note(rootId, ACTOR1_ID)
      for (let index = 0; index < 12; index++) {
        const id = `${ACTOR2_ID}/statuses/ctx-shared-url-${index}`
        await database.createNote({
          id,
          url: sharedUrl,
          actorId: ACTOR2_ID,
          text: id,
          reply: rootId,
          createdAt: 1000 + index,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
      }
      // Hidden from the viewer, so walking them never fills the limit: each
      // status carrying the shared url would otherwise read them all again.
      for (let index = 0; index < 15; index++) {
        await note(
          `${ACTOR2_ID}/statuses/ctx-shared-url-child-${index}`,
          ACTOR2_ID,
          {
            reply: sharedUrl,
            createdAt: 2000 + index,
            to: [ACTOR2_FOLLOWER_URL]
          }
        )
      }
      const getStatusReplyRefs = vi.fn(database.getStatusReplyRefs)
      const spiedDb = { ...database, getStatusReplyRefs } as Database

      const descendantsLimit = 10
      const result = await getStatusContext({
        database: spiedDb,
        statusId: rootId,
        currentActor: actor1,
        descendantsLimit
      })

      const visitCap = descendantsLimit * DESCENDANTS_VISIT_FACTOR
      expect(result.descendants).toHaveLength(descendantsLimit)
      expect(result.hasMoreDescendants).toBe(true)
      const refsRead = (
        await Promise.all(
          getStatusReplyRefs.mock.results.map((call) => call.value)
        )
      ).reduce((sum, rows) => sum + rows.length, 0)
      expect(refsRead).toBeLessThanOrEqual(visitCap + 1)
      // The shared url is read once, never once per status carrying it.
      expect(
        getStatusReplyRefs.mock.calls.filter(
          ([params]) =>
            params.statusId === sharedUrl || params.url === sharedUrl
        ).length
      ).toBeLessThanOrEqual(Math.ceil(Math.log2(visitCap)) + 1)
      expect(getStatusReplyRefs.mock.calls.length).toBeLessThanOrEqual(
        visitCap + 3
      )
    })

    it('walks a reply whose id another reply uses as its url', async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-url-as-id-root`
      const victimId = `${ACTOR4_ID}/statuses/ctx-url-as-id-victim`
      const impostorId = `${ACTOR2_ID}/statuses/ctx-url-as-id-impostor`
      const victimChildId = `${ACTOR3_ID}/statuses/ctx-url-as-id-child`
      await note(rootId, ACTOR1_ID)
      // A hidden (followers-only) reply whose url is the victim's id.
      await database.createNote({
        id: impostorId,
        url: victimId,
        actorId: ACTOR2_ID,
        text: impostorId,
        reply: rootId,
        createdAt: 1000,
        to: [ACTOR2_FOLLOWER_URL],
        cc: []
      })
      await note(victimId, ACTOR4_ID, { reply: rootId, createdAt: 2000 })
      await note(victimChildId, ACTOR3_ID, {
        reply: victimId,
        createdAt: 3000
      })

      const result = await getStatusContext({
        database,
        statusId: rootId
      })

      // Both are returned. The child names the victim by an id the impostor
      // also uses as its url, so it is read under the impostor and comes
      // first; the client nests it under the victim by its reply target.
      expect(ids(result.descendants).sort()).toEqual(
        [victimChildId, victimId].sort()
      )
    })

    it('bounds the reply reads by the visit budget when every reply is hidden', async () => {
      const rootId = `${ACTOR1_ID}/statuses/ctx-visit-root`
      await note(rootId, ACTOR1_ID)
      for (let index = 0; index < 30; index++) {
        await note(`${ACTOR2_ID}/statuses/ctx-visit-${index}`, ACTOR2_ID, {
          reply: rootId,
          createdAt: 1000 + index,
          to: [ACTOR2_FOLLOWER_URL]
        })
      }
      const getStatusReplyRefs = vi.fn(database.getStatusReplyRefs)
      const getStatusReplies = vi.fn(database.getStatusReplies)
      const spiedDb = {
        ...database,
        getStatusReplyRefs,
        getStatusReplies
      } as Database

      const descendantsLimit = 2
      const result = await getStatusContext({
        database: spiedDb,
        statusId: rootId,
        descendantsLimit
      })

      const visitCap = descendantsLimit * DESCENDANTS_VISIT_FACTOR
      expect(result.descendants).toEqual([])
      // The walk stopped with replies left unvisited.
      expect(result.hasMoreDescendants).toBe(true)
      // One read per visited reply, plus the opened status's pages.
      expect(getStatusReplyRefs.mock.calls.length).toBeLessThanOrEqual(
        visitCap + 3
      )
      const refsRead = (
        await Promise.all(
          getStatusReplyRefs.mock.results.map((call) => call.value)
        )
      ).reduce((sum, rows) => sum + rows.length, 0)
      expect(refsRead).toBeLessThanOrEqual(visitCap + 1)
      expect(getStatusReplies.mock.calls.length).toBeLessThanOrEqual(4)
      for (const [params] of getStatusReplies.mock.calls) {
        expect(params.publicOnly).toBe(true)
        const size = params.statusIds?.length ?? params.limit ?? Infinity
        expect(size).toBeGreaterThan(0)
        expect(size).toBeLessThanOrEqual(visitCap + 1)
      }
    })
  })
})
