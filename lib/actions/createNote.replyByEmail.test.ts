import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { REPLY_SENTINEL } from '@/lib/services/email/replyMarker'
import {
  extractReplyTokenFromAddress,
  resolveReplyToken
} from '@/lib/services/email/replyToken'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

enableFetchMocks()

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

const mockSendAlerts = sendNotificationAlerts as jest.MockedFunction<
  typeof sendNotificationAlerts
>
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

const INBOUND = {
  secret: 'inbound-secret',
  domain: 'reply.llun.dev',
  localPartPrefix: 'reply'
}

/**
 * The local-author producer: ACTOR2 posts, ACTOR1 is notified.
 *
 * The assertion that matters is WHOSE account the minted token authorizes.
 * It must be the recipient (ACTOR1) — the person whose mailbox receives the
 * address — never the author. Getting that backwards would hand anyone who can
 * read the recipient's mail, or anyone the thread is forwarded to, the ability
 * to post as the author.
 */
describe('createNoteFromUserInput reply-by-email minting', () => {
  const database = getTestSQLDatabase()
  const baseConfig = mockGetConfig()
  let actor1: Actor
  let actor2: Actor

  // sendNotificationAlerts is dispatched from a floating promise chain, so let
  // it settle before reading the calls.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromId({ id: ACTOR1_ID })) as Actor
    actor2 = (await database.getActorFromId({ id: ACTOR2_ID })) as Actor
  })

  afterAll(async () => {
    mockGetConfig.mockReturnValue(baseConfig)
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    mockGetConfig.mockReturnValue({ ...baseConfig, emailInbound: INBOUND })
    await database.updateActor({ actorId: ACTOR1_ID, replyByEmail: true })
  })

  afterEach(async () => {
    await database.updateActor({ actorId: ACTOR1_ID, replyByEmail: false })
  })

  const emailContentFor = async (actorId: string) => {
    await settle()
    const call = mockSendAlerts.mock.calls.find(
      ([params]) => params.actorId === actorId
    )
    return call?.[0].events[0].emailContent
  }

  it('binds the token on a reply notification to the recipient, not the author', async () => {
    const parent = await database.createNote({
      id: `${ACTOR1_ID}/statuses/rbe-parent`,
      url: `${ACTOR1_ID}/statuses/rbe-parent`,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Parent post'
    })

    const status = await createNoteFromUserInput({
      currentActor: actor2,
      text: 'A reply from actor2',
      replyNoteId: parent.id,
      database
    })

    const emailContent = await emailContentFor(ACTOR1_ID)
    expect(emailContent?.replyTo).toMatch(
      /^reply\+[A-Za-z0-9_-]+@reply\.llun\.dev$/
    )
    expect(emailContent?.text).toContain(REPLY_SENTINEL)

    const token = extractReplyTokenFromAddress(emailContent!.replyTo!)
    await expect(resolveReplyToken(database, token!)).resolves.toMatchObject({
      status: 'ok',
      token: {
        // The recipient, NOT actor2 who wrote the post.
        actorId: ACTOR1_ID,
        statusId: status!.id,
        notificationType: 'reply'
      }
    })
  })

  it('binds the token on a mention notification to the mentioned actor', async () => {
    const status = await createNoteFromUserInput({
      currentActor: actor2,
      text: `Hello @${actor1.username}@${actor1.domain}`,
      database
    })

    const emailContent = await emailContentFor(ACTOR1_ID)
    expect(emailContent?.replyTo).toBeDefined()

    const token = extractReplyTokenFromAddress(emailContent!.replyTo!)
    await expect(resolveReplyToken(database, token!)).resolves.toMatchObject({
      status: 'ok',
      token: {
        actorId: ACTOR1_ID,
        statusId: status!.id,
        notificationType: 'mention'
      }
    })
  })

  it('leaves the notification non-repliable when the recipient has not opted in', async () => {
    await database.updateActor({ actorId: ACTOR1_ID, replyByEmail: false })

    await createNoteFromUserInput({
      currentActor: actor2,
      text: `Hello again @${actor1.username}@${actor1.domain}`,
      database
    })

    const emailContent = await emailContentFor(ACTOR1_ID)
    expect(emailContent).toBeDefined()
    expect(emailContent).not.toHaveProperty('replyTo')
    expect(emailContent?.text).not.toContain(REPLY_SENTINEL)
  })
})
