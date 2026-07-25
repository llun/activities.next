import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getConfig } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { sendMail } from '@/lib/services/email'
import { REPLY_SENTINEL } from '@/lib/services/email/replyMarker'
import {
  REPLY_TOKEN_MAX_USES,
  hashReplyToken,
  mintReplyToken
} from '@/lib/services/email/replyToken'
import { saveMedia } from '@/lib/services/medias'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { getAttachmentsFromMediaIds } from '@/lib/services/statuses/mediaIds'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getVisibility } from '@/lib/utils/getVisibility'

import { REPLY_BY_EMAIL_JOB_NAME } from './names'
import { replyByEmailJob } from './replyByEmailJob'

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

vi.mock('@/lib/services/email', () => ({
  sendMail: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/medias', () => ({
  saveMedia: vi.fn().mockResolvedValue(null)
}))

// Stubbed so a stored media id resolves to a real attachment. Against the live
// helper it would return null (no medias row for the fake id), which silently
// posts the reply with no attachments at all — the exact hole that let the
// storeAttachments -> createNoteFromUserInput wiring go untested.
vi.mock('@/lib/services/statuses/mediaIds', () => ({
  getAttachmentsFromMediaIds: vi.fn().mockResolvedValue([])
}))

const mockSendMail = sendMail as jest.MockedFunction<typeof sendMail>
const mockSaveMedia = saveMedia as jest.MockedFunction<typeof saveMedia>
const mockGetAttachments = getAttachmentsFromMediaIds as jest.MockedFunction<
  typeof getAttachmentsFromMediaIds
>
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

const INBOUND = {
  secret: 'inbound-secret',
  domain: 'reply.llun.dev',
  localPartPrefix: 'reply'
}

const replyBody = (reply: string) =>
  [
    reply,
    '',
    'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
    `> ${REPLY_SENTINEL}`,
    '> @someone mentioned you in a post.'
  ].join('\n')

const runJob = (database: Database, data: unknown) =>
  replyByEmailJob(database, {
    id: 'reply-by-email-test',
    name: REPLY_BY_EMAIL_JOB_NAME,
    data
  })

const repliesTo = async (database: Database, statusId: string) => {
  const status = (await database.getStatus({
    statusId,
    withReplies: true
  })) as Status
  return status.type === 'Note' ? status.replies : []
}

describe('replyByEmailJob', () => {
  const database = getTestSQLDatabase()
  const baseConfig = mockGetConfig()
  let actor1: Actor
  let publicStatus: Status
  let directStatus: Status

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = (await database.getActorFromId({ id: ACTOR1_ID })) as Actor

    // ACTOR2 mentions ACTOR1 publicly, and separately sends a DM.
    publicStatus = await database.createNote({
      id: `${ACTOR2_ID}/statuses/public-mention`,
      url: `${ACTOR2_ID}/statuses/public-mention`,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${ACTOR2_ID}/followers`],
      text: 'Hello @test1@llun.test'
    })
    directStatus = await database.createNote({
      id: `${ACTOR2_ID}/statuses/direct-message`,
      url: `${ACTOR2_ID}/statuses/direct-message`,
      actorId: ACTOR2_ID,
      to: [ACTOR1_ID],
      cc: [],
      text: 'A private word, @test1@llun.test'
    })
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
    mockSaveMedia.mockResolvedValue(null)
    mockGetAttachments.mockResolvedValue([])
    await database.updateActor({ actorId: ACTOR1_ID, replyByEmail: true })
  })

  const mintFor = async (statusId: string) => {
    const minted = await mintReplyToken(database, {
      actorId: ACTOR1_ID,
      statusId,
      notificationType: 'mention'
    })
    return minted!.token
  }

  it('posts the reply into the thread it was sent about', async () => {
    const token = await mintFor(publicStatus.id)

    await runJob(database, {
      token,
      messageId: '<post-into-thread@example.tld>',
      from: actor1.account?.email,
      text: replyBody('Answering from my inbox.')
    })

    const replies = await repliesTo(database, publicStatus.id)
    const posted = replies.find((reply) =>
      reply.text.includes('Answering from my inbox')
    )
    expect(posted).toBeDefined()
    expect(posted?.actorId).toBe(ACTOR1_ID)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('inherits public visibility from the parent status', async () => {
    const token = await mintFor(publicStatus.id)

    await runJob(database, {
      token,
      messageId: '<inherits-public@example.tld>',
      text: replyBody('Public answer.')
    })

    const replies = await repliesTo(database, publicStatus.id)
    const posted = replies.find((reply) => reply.text.includes('Public answer'))
    expect(posted).toBeDefined()
    expect(getVisibility(posted!.to, posted!.cc)).toBe('public')
  })

  it('keeps a reply to a direct message direct', async () => {
    const token = await mintFor(directStatus.id)

    await runJob(database, {
      token,
      messageId: '<stays-direct@example.tld>',
      text: replyBody('Private answer.')
    })

    const replies = await repliesTo(database, directStatus.id)
    const posted = replies.find((reply) =>
      reply.text.includes('Private answer')
    )
    expect(posted).toBeDefined()
    // The sender never typed an @mention; the parent author is inherited.
    expect(getVisibility(posted!.to, posted!.cc)).toBe('direct')
    expect(posted!.to).toContain(ACTOR2_ID)
  })

  it('posts once for a duplicated delivery of the same message', async () => {
    const token = await mintFor(publicStatus.id)
    const data = {
      token,
      messageId: '<duplicate-delivery@example.tld>',
      text: replyBody('Only once please.')
    }

    await runJob(database, data)
    await runJob(database, data)

    const replies = await repliesTo(database, publicStatus.id)
    expect(
      replies.filter((reply) => reply.text.includes('Only once please'))
    ).toHaveLength(1)
  })

  it('records a use against the token', async () => {
    const token = await mintFor(publicStatus.id)

    await runJob(database, {
      token,
      messageId: '<records-a-use@example.tld>',
      text: replyBody('Counting this one.')
    })

    const row = await database.getEmailReplyToken({
      tokenHash: hashReplyToken(token)
    })
    expect(row?.useCount).toBe(1)
    expect(row?.lastUsedAt).toBeGreaterThan(0)
  })

  it.each([
    {
      description: 'the token was never minted',
      data: { token: 'never-minted', text: 'hello' }
    },
    {
      description: 'the payload does not match the schema',
      data: { nope: true }
    }
  ])('posts nothing and warns nobody when $description', async ({ data }) => {
    const before = await repliesTo(database, publicStatus.id)

    await runJob(database, data)

    expect(await repliesTo(database, publicStatus.id)).toHaveLength(
      before.length
    )
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  // Deliberately uses a REAL token: with a bogus one the job would stop at the
  // token lookup regardless, so the case would pass with the config guard
  // deleted and prove nothing about it.
  it('posts nothing when inbound email is no longer configured', async () => {
    const token = await mintFor(publicStatus.id)
    mockGetConfig.mockReturnValue({ ...baseConfig, emailInbound: undefined })

    await runJob(database, {
      token,
      messageId: '<unconfigured@example.tld>',
      text: replyBody('Should not reach the thread.')
    })

    const replies = await repliesTo(database, publicStatus.id)
    expect(
      replies.some((reply) =>
        reply.text.includes('Should not reach the thread')
      )
    ).toBe(false)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  // Regression: an expired or spent token used to be lumped in with an unknown
  // one and dropped with only a log line — so the sender believed they had
  // posted. The row still names its owner, so they can and must be told.
  it('tells the sender when the reply address has expired', async () => {
    const token = await mintFor(publicStatus.id)
    const row = await database.getEmailReplyToken({
      tokenHash: hashReplyToken(token)
    })

    vi.useFakeTimers()
    vi.setSystemTime(new Date(row!.expiresAt + 1))
    try {
      await runJob(database, {
        token,
        messageId: '<expired-token@example.tld>',
        text: replyBody('Too late.')
      })
    } finally {
      vi.useRealTimers()
    }

    const replies = await repliesTo(database, publicStatus.id)
    expect(replies.some((reply) => reply.text.includes('Too late'))).toBe(false)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: [actor1.account?.email],
        content: expect.objectContaining({
          text: expect.stringContaining('has expired')
        })
      })
    )
  })

  it('tells the sender when the reply address is spent', async () => {
    const token = await mintFor(publicStatus.id)
    const row = await database.getEmailReplyToken({
      tokenHash: hashReplyToken(token)
    })
    for (let use = 0; use < REPLY_TOKEN_MAX_USES; use += 1) {
      await database.recordEmailReplyTokenUse({ id: row!.id })
    }

    await runJob(database, {
      token,
      messageId: '<spent-token@example.tld>',
      text: replyBody('One too many.')
    })

    const replies = await repliesTo(database, publicStatus.id)
    expect(replies.some((reply) => reply.text.includes('One too many'))).toBe(
      false
    )
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: expect.stringContaining('as many times as it allows')
        })
      })
    )
  })

  it('refuses a suspended actor', async () => {
    const token = await mintFor(publicStatus.id)
    await database.setActorSuspended({ actorId: ACTOR1_ID, suspended: true })

    try {
      await runJob(database, {
        token,
        messageId: '<suspended@example.tld>',
        text: replyBody('Should not post.')
      })

      const replies = await repliesTo(database, publicStatus.id)
      expect(
        replies.some((reply) => reply.text.includes('Should not post'))
      ).toBe(false)
      expect(mockSendMail).not.toHaveBeenCalled()
    } finally {
      await database.setActorSuspended({ actorId: ACTOR1_ID, suspended: false })
    }
  })

  // The admin switch has to be re-checked at redemption, not just at minting:
  // tokens live 30 days, so an instance that turns the feature off must stop
  // honouring every address it already handed out.
  it('refuses a still-opted-in actor once the admin switch is off', async () => {
    const token = await mintFor(publicStatus.id)
    await database.setServerSetting({
      key: 'replyByEmail.enabled',
      value: false
    })
    invalidateServerSettingsCache(database)

    try {
      await runJob(database, {
        token,
        messageId: '<instance-disabled@example.tld>',
        text: replyBody('Instance said no.')
      })

      const replies = await repliesTo(database, publicStatus.id)
      expect(
        replies.some((reply) => reply.text.includes('Instance said no'))
      ).toBe(false)
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            text: expect.stringContaining('switched off')
          })
        })
      )
    } finally {
      await database.deleteServerSetting({ key: 'replyByEmail.enabled' })
      invalidateServerSettingsCache(database)
    }
  })

  it('refuses an actor who has not opted in and says why', async () => {
    const token = await mintFor(publicStatus.id)
    await database.updateActor({ actorId: ACTOR1_ID, replyByEmail: false })

    await runJob(database, {
      token,
      messageId: '<opted-out@example.tld>',
      text: replyBody('Should not post either.')
    })

    const replies = await repliesTo(database, publicStatus.id)
    expect(
      replies.some((reply) => reply.text.includes('Should not post either'))
    ).toBe(false)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: [actor1.account?.email],
        content: expect.objectContaining({
          text: expect.stringContaining('switched off')
        })
      })
    )
  })

  it('tells the sender when the reply had no text of its own', async () => {
    const token = await mintFor(publicStatus.id)

    await runJob(database, {
      token,
      messageId: '<empty-reply@example.tld>',
      text: `${REPLY_SENTINEL}\n> quoted original only`
    })

    const replies = await repliesTo(database, publicStatus.id)
    expect(replies.some((reply) => reply.text.trim() === '')).toBe(false)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: expect.stringContaining('no text above the quoted original')
        })
      })
    )
  })

  it('tells the sender when the reply is over the character limit', async () => {
    const token = await mintFor(publicStatus.id)

    await runJob(database, {
      token,
      messageId: '<too-long@example.tld>',
      text: replyBody('x'.repeat(5000))
    })

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: expect.stringContaining('longer than this server allows')
        })
      })
    )
  })

  it('never makes the failure notice itself repliable', async () => {
    const token = await mintFor(publicStatus.id)

    await runJob(database, {
      token,
      messageId: '<no-loop@example.tld>',
      text: `${REPLY_SENTINEL}\n> quoted original only`
    })

    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail.mock.calls[0][0]).not.toHaveProperty('replyTo')
  })

  it('drops an attachment the media pipeline does not accept, and still posts', async () => {
    const token = await mintFor(publicStatus.id)

    await runJob(database, {
      token,
      messageId: '<pdf-attachment@example.tld>',
      text: replyBody('Text survives the dropped PDF.'),
      attachments: [
        {
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('not really a pdf').toString('base64')
        }
      ]
    })

    expect(mockSaveMedia).not.toHaveBeenCalled()
    const replies = await repliesTo(database, publicStatus.id)
    expect(
      replies.some((reply) =>
        reply.text.includes('Text survives the dropped PDF')
      )
    ).toBe(true)
  })

  it('skips an inline image referenced from the quoted history', async () => {
    const token = await mintFor(publicStatus.id)

    await runJob(database, {
      token,
      messageId: '<inline-logo@example.tld>',
      text: replyBody('No signature logo please.'),
      attachments: [
        {
          filename: 'logo.png',
          contentType: 'image/png',
          contentId: '<logo@signature>',
          contentBase64: Buffer.from('png').toString('base64')
        }
      ]
    })

    expect(mockSaveMedia).not.toHaveBeenCalled()
  })

  it('stores a real image attachment and puts it on the reply', async () => {
    const token = await mintFor(publicStatus.id)
    mockSaveMedia.mockResolvedValue({ id: 'media-1' } as never)
    mockGetAttachments.mockResolvedValue([
      {
        type: 'upload',
        id: 'media-1',
        mediaType: 'image/png',
        url: 'https://llun.test/api/v1/files/shot.png',
        width: 100,
        height: 100
      }
    ] as never)

    await runJob(database, {
      token,
      messageId: '<png-attachment@example.tld>',
      text: replyBody('Here is the screenshot.'),
      attachments: [
        {
          filename: 'shot.png',
          contentType: 'image/png',
          contentBase64: Buffer.from('png bytes').toString('base64')
        }
      ]
    })

    expect(mockSaveMedia).toHaveBeenCalledTimes(1)
    const [, , media] = mockSaveMedia.mock.calls[0]
    expect(media.file).toBeInstanceOf(File)
    expect(media.file.type).toBe('image/png')
    // The stored id must actually be resolved and threaded into the post.
    expect(mockGetAttachments).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: ACTOR1_ID }),
      ['media-1']
    )

    const replies = await repliesTo(database, publicStatus.id)
    const posted = replies.find((reply) =>
      reply.text.includes('Here is the screenshot')
    )
    expect(posted?.attachments).toHaveLength(1)
    expect(posted?.attachments[0].mediaType).toBe('image/png')
  })
})
