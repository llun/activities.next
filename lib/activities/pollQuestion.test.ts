import { getPollQuestion } from '@/lib/activities/pollQuestion'
import { StatusPoll } from '@/lib/types/domain/status'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
import { toActivityPubObject } from '@/lib/utils/toActivityPubObject'

const now = Date.UTC(2026, 10, 4)
const statusId = 'https://example.test/users/pollbot/statuses/1'
const poll = (overrides: Partial<StatusPoll> = {}): StatusPoll =>
  StatusPoll.parse({
    id: statusId,
    type: 'Poll',
    actorId: 'https://example.test/users/pollbot',
    actor: null,
    url: statusId,
    text: '<p>Choose a color</p>',
    summary: null,
    reply: '',
    replies: [],
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    edits: [],
    isLocalActor: true,
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    attachments: [],
    tags: [],
    choices: ['Red', 'Blue'].map((title) => ({
      statusId,
      title,
      totalVotes: 3,
      createdAt: now,
      updatedAt: now
    })),
    pollType: 'oneOf',
    endAt: now + 60_000,
    createdAt: now,
    updatedAt: now,
    ...overrides
  })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

describe.each([
  ['builder', (status: StatusPoll) => getPollQuestion(status, { replies: [] })],
  ['delivery', getNoteFromStatus],
  ['fetch', toActivityPubObject]
] as const)('%s Question', (_surface, serialize) => {
  it('maps the final quoted content and summary to the declared language', () => {
    const question = serialize(
      poll({
        language: 'th',
        detectedLanguage: 'en',
        summary: 'คำเตือน',
        quote: {
          quotedStatusId: 'https://remote.example/statuses/quoted',
          state: 'accepted'
        }
      })
    )!
    expect(question.content).toContain('quote-inline')
    expect(question.contentMap).toEqual({ th: question.content })
    expect(question.summaryMap).toEqual({ th: question.summary })
  })

  it.each([undefined, null, '', '12'])(
    'omits language maps for an absent or invalid language %j',
    (language) => {
      const question = serialize(
        poll({ language, detectedLanguage: 'th', summary: 'Warning' })
      )!
      expect(question).not.toHaveProperty('contentMap')
      expect(question).not.toHaveProperty('summaryMap')
    }
  )

  it('omits summaryMap when the poll has no summary', () => {
    const question = serialize(poll({ language: 'th' }))!
    expect(question.contentMap).toEqual({ th: question.content })
    expect(question).not.toHaveProperty('summaryMap')
  })

  it.each(['oneOf', 'anyOf'] as const)(
    'emits %s options, distinct voters and endTime',
    (pollType) => {
      const question = serialize(poll({ pollType, votersCount: 4 }))
      expect(question).toMatchObject({
        type: 'Question',
        [pollType]: [
          {
            type: 'Note',
            name: 'Red',
            replies: { type: 'Collection', totalItems: 3 }
          },
          {
            type: 'Note',
            name: 'Blue',
            replies: { type: 'Collection', totalItems: 3 }
          }
        ],
        votersCount: 4,
        endTime: new Date(now + 60_000).toISOString(),
        replies: { type: 'Collection', totalItems: 0 },
        sensitive: false,
        interactionPolicy: expect.any(Object)
      })
      expect(question).not.toHaveProperty(
        pollType === 'oneOf' ? 'anyOf' : 'oneOf'
      )
      expect(question).not.toHaveProperty('closed')
    }
  )

  it.each(['oneOf', 'anyOf'] as const)(
    'hides %s tallies until the exact expiration boundary',
    (pollType) => {
      const status = poll({ pollType, hideTotals: true, votersCount: 4 })
      vi.setSystemTime(status.endAt - 1)
      expect(serialize(status)).toMatchObject({
        [pollType]: [
          { type: 'Note', name: 'Red' },
          { type: 'Note', name: 'Blue' }
        ],
        votersCount: 4
      })
      expect(serialize(status)).not.toHaveProperty(`${pollType}.0.replies`)
      expect(serialize(status)).not.toHaveProperty(`${pollType}.1.replies`)
      expect(serialize(status)).not.toHaveProperty('closed')
      vi.setSystemTime(status.endAt)
      expect(serialize(status)).toMatchObject({
        closed: new Date(status.endAt).toISOString(),
        [pollType]: [
          { replies: { totalItems: 3 } },
          { replies: { totalItems: 3 } }
        ]
      })
    }
  )

  it('uses the legacy sum only for oneOf without a hydrated voter count', () => {
    expect(serialize(poll())).toHaveProperty('votersCount', 6)
    expect(serialize(poll({ votersCount: 0 }))).toHaveProperty('votersCount', 0)
    expect(serialize(poll({ pollType: 'anyOf' }))).not.toHaveProperty(
      'votersCount'
    )
  })
})

it('keeps fetch and delivery aligned and adds delivery audience and forced updated', () => {
  const status = poll()
  const audience = 'https://community.example/groups/colors'
  expect(getNoteFromStatus(status)).toEqual(toActivityPubObject(status))
  expect(getNoteFromStatus(status, { audience, includeUpdated: true })).toEqual(
    {
      ...toActivityPubObject(status),
      audience,
      updated: new Date(now).toISOString()
    }
  )
})

it('renders local Markdown in Question content and contentMap identically on fetch and delivery', () => {
  const status = poll({
    text: 'Vote **bold** at [docs](https://example.com/docs)',
    language: 'en',
    isLocalActor: true
  })
  const delivered = getNoteFromStatus(status)!
  const fetched = toActivityPubObject(status)

  expect(fetched.content).toContain('<strong>bold</strong>')
  expect(fetched.content).toContain('<a href="https://example.com/docs"')
  expect(fetched.content).toBe(delivered.content)
  expect(fetched.contentMap).toEqual({ en: fetched.content })
  expect(fetched.contentMap).toEqual(delivered.contentMap)
})

it('preserves non-fitness media, sensitivity and quote fields on fetch and delivery', () => {
  const attachment = {
    id: 'media-1',
    actorId: 'https://example.test/users/pollbot',
    statusId,
    type: 'Document' as const,
    mediaType: 'image/png',
    url: 'https://example.test/photo.png',
    name: 'A blue sky',
    createdAt: now,
    updatedAt: now
  }
  const status = poll({
    sensitive: true,
    attachments: [
      attachment,
      {
        ...attachment,
        id: 'fitness-1',
        mediaType: 'application/gpx+xml',
        url: 'https://example.test/route.gpx'
      }
    ],
    quote: {
      quotedStatusId: 'https://remote.example/statuses/1',
      state: 'pending'
    }
  })
  for (const question of [
    getNoteFromStatus(status),
    toActivityPubObject(status)
  ]) {
    expect(question).toMatchObject({
      sensitive: true,
      attachment: [
        { type: 'Document', mediaType: 'image/png', url: attachment.url }
      ],
      quote: status.quote!.quotedStatusId,
      interactionPolicy: expect.any(Object)
    })
    expect(question?.attachment).toHaveLength(1)
    expect(question?.content).toContain('quote-inline')
  }
})
