import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createImportedStatus } from '@/lib/services/accountImport/createImportedStatus'
import type { ImportedStatusInput } from '@/lib/services/accountImport/mappers/types'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import type { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const queueMock = vi.hoisted(() => {
  const publish = vi.fn()
  const getQueue = vi.fn(() => ({ publish }))
  return { getQueue, publish }
})

vi.mock('@/lib/services/queue', () => ({ getQueue: queueMock.getQueue }))

const published = Date.parse('2024-02-03T04:05:06.000Z')
const makeInput = (
  publicId: string,
  overrides: Partial<ImportedStatusInput> = {}
): ImportedStatusInput => ({
  sourceId: `https://archive.test/users/owner/statuses/${publicId}`,
  sourceUrl: null,
  publicId,
  published,
  visibility: 'public',
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: ['https://local.test/users/owner/followers'],
  text: 'current version',
  summary: null,
  sensitive: false,
  language: null,
  replyToStatusId: null,
  externalReplyUri: null,
  quoteSourceId: null,
  quoteStatusId: null,
  quoteApprovalPolicy: 'public',
  tags: [],
  attachments: [],
  poll: null,
  pinned: false,
  edits: [],
  ...overrides
})

describe('createImportedStatus', () => {
  const { database, db, prepare, destroy } = createTestDatabase({
    backend: 'sqlite'
  })
  let actor: Actor
  let otherActorId: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromId({
      id: DatabaseSeed.actors.primary.id
    })) as Actor
    otherActorId = DatabaseSeed.actors.replyAuthor.id
  }, 30_000)

  afterAll(async () => {
    await destroy()
  })

  beforeEach(() => {
    queueMock.getQueue.mockClear()
    queueMock.publish.mockClear()
  })

  const sideEffectCounts = async () => ({
    timelines: (await db.selectFrom('timelines').selectAll().execute()).length,
    notifications: (await db.selectFrom('notifications').selectAll().execute())
      .length,
    federatedTimeline: (
      await db.selectFrom('federated_timeline').selectAll().execute()
    ).length,
    queueJobs: (await db.selectFrom('queue_jobs').selectAll().execute()).length,
    linkPreviews: (
      await db.selectFrom('status_link_previews').selectAll().execute()
    ).length
  })

  it('writes quietly, stores edits and pins, drops foreign quotes and unknown emoji, and is idempotent', async () => {
    const externalQuoteId = `${otherActorId}/statuses/account-import-quote-target`
    await database.createNote({
      id: externalQuoteId,
      url: externalQuoteId,
      actorId: otherActorId,
      text: 'someone else status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const before = await sideEffectCounts()
    const input = makeInput('018d0000-0000-7000-8000-000000000001', {
      pinned: true,
      quoteSourceId: externalQuoteId,
      quoteStatusId: externalQuoteId,
      tags: [
        {
          type: 'hashtag',
          name: '#archive',
          value: 'https://archive.test/tags/archive'
        },
        {
          type: 'mention',
          name: '@someone@elsewhere.test',
          value: 'https://elsewhere.test/users/someone'
        },
        {
          type: 'emoji',
          name: ':missing_local_emoji:',
          value: 'https://archive.test/emoji.png'
        }
      ],
      edits: [
        {
          text: 'old version',
          summary: null,
          sensitive: false,
          attachments: null,
          pollOptions: null,
          supersededAt: published + 1
        },
        {
          text: 'middle version',
          summary: null,
          sensitive: false,
          attachments: null,
          pollOptions: null,
          supersededAt: published + 2
        }
      ]
    })

    const created = await createImportedStatus(database, actor, input)
    expect(created).toMatchObject({
      createdAt: published,
      text: 'current version',
      type: StatusType.enum.Note
    })

    const history = await db
      .selectFrom('status_history')
      .selectAll()
      .where('statusId', '=', created.id)
      .execute()
    expect(history).toHaveLength(2)
    const revisions = history.map((item) =>
      typeof item.data === 'string' ? JSON.parse(item.data) : item.data
    )
    expect(revisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'old version' }),
        expect.objectContaining({ text: 'middle version' })
      ])
    )

    const tags = await database.getTags({ statusId: created.id })
    expect(tags.map((tag) => tag.type)).toEqual(
      expect.arrayContaining(['hashtag', 'mention'])
    )
    expect(tags.some((tag) => tag.name.includes('missing_local_emoji'))).toBe(
      false
    )
    expect(await database.getStatusQuote({ statusId: created.id })).toBeNull()
    expect(
      await db
        .selectFrom('status_pins')
        .selectAll()
        .where('statusId', '=', created.id)
        .execute()
    ).toHaveLength(1)
    expect(await sideEffectCounts()).toEqual(before)
    expect(queueMock.getQueue).not.toHaveBeenCalled()
    expect(queueMock.publish).not.toHaveBeenCalled()

    const replay = await createImportedStatus(database, actor, input)
    expect(replay).toMatchObject({
      id: created.id,
      publicId: input.publicId,
      text: 'current version',
      updatedAt: created.updatedAt
    })
    expect(
      await db
        .selectFrom('status_history')
        .selectAll()
        .where('statusId', '=', created.id)
        .execute()
    ).toHaveLength(2)
    expect(await sideEffectCounts()).toEqual(before)
  })

  it('creates polls already closed at the published timestamp', async () => {
    const input = makeInput('018d0000-0000-7000-8000-000000000002', {
      text: 'poll question',
      poll: {
        pollType: 'oneOf',
        choices: [
          { title: 'yes', totalVotes: 7 },
          { title: 'no', totalVotes: 3 }
        ],
        endAt: published + 60_000,
        hideTotals: false
      }
    })
    const status = await createImportedStatus(database, actor, input)
    expect(status.type).toBe(StatusType.enum.Poll)
    if (status.type === StatusType.enum.Poll) {
      expect(status.endAt).toBe(published)
      expect(status.choices.map((choice) => choice.title)).toEqual([
        'yes',
        'no'
      ])
    }
    expect(queueMock.getQueue).not.toHaveBeenCalled()
    expect(queueMock.publish).not.toHaveBeenCalled()
  })
})
