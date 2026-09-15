import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { getStatusContext } from '@/lib/services/statuses/getStatusContext'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { Actor } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('getStatusContext', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor
  let actor3: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromId({ id: ACTOR1_ID }))!
    actor3 = (await database.getActorFromId({ id: ACTOR3_ID }))!
  })

  afterAll(async () => {
    await database.destroy()
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

  it('respects access control and excludes unreadable ancestors', async () => {
    const publicRootId = `${ACTOR1_ID}/statuses/ctx-acc-root`
    const privateMidId = `${ACTOR1_ID}/statuses/ctx-acc-mid`
    const publicLeafId = `${ACTOR1_ID}/statuses/ctx-acc-leaf`

    await database.createNote({
      id: publicRootId,
      url: publicRootId,
      actorId: ACTOR1_ID,
      text: 'Public Root',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    await database.createNote({
      id: privateMidId,
      url: privateMidId,
      actorId: ACTOR1_ID,
      text: 'Followers-only Mid',
      reply: publicRootId,
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })

    await database.createNote({
      id: publicLeafId,
      url: publicLeafId,
      actorId: ACTOR1_ID,
      text: 'Public Leaf',
      reply: privateMidId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    // Non-follower actor3 reads the public leaf:
    // The private mid ancestor is excluded, but public root remains
    const result = await getStatusContext({
      database,
      statusId: publicLeafId,
      currentActor: actor3
    })

    const ancestorIds = result.ancestors.map((s) => s.id)
    expect(ancestorIds).toContain(publicRootId)
    expect(ancestorIds).not.toContain(privateMidId)
  })

  it('strictly excludes blocked and muted ancestors and descendant replies', async () => {
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

    const modRootId = `${ACTOR1_ID}/statuses/ctx-mod-root`
    const blockedParentId = `${ACTOR2_ID}/statuses/ctx-mod-blocked-parent`
    const mutedParentId = `${ACTOR3_ID}/statuses/ctx-mod-muted-parent`
    const modLeafId = `${ACTOR1_ID}/statuses/ctx-mod-leaf`

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
    const blockedReplyId = `${ACTOR2_ID}/statuses/ctx-mod-blocked-reply`
    const mutedReplyId = `${ACTOR3_ID}/statuses/ctx-mod-muted-reply`
    const allowedReplyId = `${ACTOR1_ID}/statuses/ctx-mod-allowed-reply`

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

  it('normalizes timestamp sorting and handles invalid dates gracefully', async () => {
    const sortRootId = `${ACTOR1_ID}/statuses/ctx-sort-root`
    await database.createNote({
      id: sortRootId,
      url: sortRootId,
      actorId: ACTOR1_ID,
      text: 'Sort Root',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const replyInvalidDateId = `${ACTOR1_ID}/statuses/ctx-sort-invalid-date`
    const replyValidDateId = `${ACTOR1_ID}/statuses/ctx-sort-valid-date`

    const wrappedDb = {
      ...database,
      getStatusReplies: vi.fn(async ({ statusId }: { statusId: string }) => {
        if (statusId === sortRootId) {
          return [
            {
              id: replyValidDateId,
              actorId: ACTOR1_ID,
              type: StatusType.enum.Note,
              to: [ACTIVITY_STREAM_PUBLIC],
              cc: [],
              reply: sortRootId,
              createdAt: 50000,
              text: 'Valid date reply'
            } as unknown as Status,
            {
              id: replyInvalidDateId,
              actorId: ACTOR1_ID,
              type: StatusType.enum.Note,
              to: [ACTIVITY_STREAM_PUBLIC],
              cc: [],
              reply: sortRootId,
              createdAt: 'invalid-date' as unknown as number,
              text: 'Invalid date reply'
            } as unknown as Status
          ]
        }
        return []
      })
    } as unknown as Database

    const result = await getStatusContext({
      database: wrappedDb,
      statusId: sortRootId,
      currentActor: actor1
    })

    expect(result.descendants.map((s) => s.id)).toEqual([
      replyInvalidDateId,
      replyValidDateId
    ])
  })
})
