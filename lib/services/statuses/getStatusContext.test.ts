import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getStatusContext } from '@/lib/services/statuses/getStatusContext'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { Actor } from '@/lib/types/domain/actor'
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
})
