import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { Actor } from '@/lib/types/domain/actor'
import { QuoteState } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import {
  QUOTING_STATUS_PAGE_SIZE,
  notifyQuotedStatusUpdate
} from './notifyQuotedStatusUpdate'

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

describe('notifyQuotedStatusUpdate', () => {
  const database = getTestSQLDatabase()
  const mockSendNotificationAlerts =
    sendNotificationAlerts as jest.MockedFunction<typeof sendNotificationAlerts>
  // actor1 authors (and edits) the quoted status; actor2 is a local quoter.
  let actor1: Actor
  let actor2: Actor
  let counter = 0

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    actor2 = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor
  })

  afterAll(async () => {
    if (database) await database.destroy()
  })

  beforeEach(() => {
    mockSendNotificationAlerts.mockClear()
  })

  const createStatus = async (actorId: string, label: string) => {
    counter += 1
    const id = `${actorId}/statuses/qu-${label}-${counter}`
    await database.createNote({
      id,
      url: id,
      actorId,
      text: label,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    return id
  }

  const createQuote = async (
    quotingActorId: string,
    quotedStatusId: string,
    state: QuoteState = 'accepted'
  ) => {
    const quotingStatusId = await createStatus(quotingActorId, 'quoting')
    await database.createStatusQuote({
      statusId: quotingStatusId,
      quotedStatusId,
      state
    })
    return quotingStatusId
  }

  const quotedUpdateNotificationsFor = (actorId: string) =>
    database.getNotifications({
      actorId,
      limit: 500,
      types: ['quoted_update']
    })

  it('notifies a local quoting author when the quoted status is updated', async () => {
    const quotedId = await createStatus(actor1.id, 'quoted')
    const quotingId = await createQuote(actor2.id, quotedId)

    await notifyQuotedStatusUpdate({
      database,
      quotedStatusId: quotedId,
      sourceActorId: actor1.id,
      sourceActor: actor1
    })

    const notifications = await quotedUpdateNotificationsFor(actor2.id)
    expect(notifications.filter((n) => n.statusId === quotingId)).toHaveLength(
      1
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockSendNotificationAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: actor2.id,
        sourceActorId: actor1.id,
        statusId: quotingId,
        events: expect.arrayContaining([
          expect.objectContaining({ type: 'quoted_update' })
        ])
      })
    )
  })

  it('does not notify a remote quoting author', async () => {
    const quotedId = await createStatus(actor1.id, 'quoted')
    const quotingId = await createQuote(EXTERNAL_ACTOR1, quotedId)

    await notifyQuotedStatusUpdate({
      database,
      quotedStatusId: quotedId,
      sourceActorId: actor1.id,
      sourceActor: actor1
    })

    const notifications = await quotedUpdateNotificationsFor(EXTERNAL_ACTOR1)
    expect(notifications.filter((n) => n.statusId === quotingId)).toHaveLength(
      0
    )
  })

  it('does not notify the editor about their own quote', async () => {
    const quotedId = await createStatus(actor1.id, 'quoted')
    const quotingId = await createQuote(actor1.id, quotedId)

    await notifyQuotedStatusUpdate({
      database,
      quotedStatusId: quotedId,
      sourceActorId: actor1.id,
      sourceActor: actor1
    })

    const notifications = await quotedUpdateNotificationsFor(actor1.id)
    expect(notifications.filter((n) => n.statusId === quotingId)).toHaveLength(
      0
    )
  })

  it.each([
    { state: 'pending' as const },
    { state: 'rejected' as const },
    { state: 'revoked' as const },
    { state: 'deleted' as const }
  ])('does not notify for a $state quote edge', async ({ state }) => {
    const quotedId = await createStatus(actor1.id, 'quoted')
    const quotingId = await createQuote(actor2.id, quotedId, state)

    await notifyQuotedStatusUpdate({
      database,
      quotedStatusId: quotedId,
      sourceActorId: actor1.id,
      sourceActor: actor1
    })

    const notifications = await quotedUpdateNotificationsFor(actor2.id)
    expect(notifications.filter((n) => n.statusId === quotingId)).toHaveLength(
      0
    )
  })

  it('enumerates every accepted quoter past the pagination page size', async () => {
    const quotedId = await createStatus(actor1.id, 'quoted')
    const quotingIds: string[] = []
    for (let i = 0; i < QUOTING_STATUS_PAGE_SIZE + 3; i += 1) {
      quotingIds.push(await createQuote(actor2.id, quotedId))
    }

    await notifyQuotedStatusUpdate({
      database,
      quotedStatusId: quotedId,
      sourceActorId: actor1.id,
      sourceActor: actor1
    })

    const notifications = await quotedUpdateNotificationsFor(actor2.id)
    const notifiedStatusIds = new Set(notifications.map((n) => n.statusId))
    for (const quotingId of quotingIds) {
      expect(notifiedStatusIds.has(quotingId)).toBe(true)
    }
  })
})
