import { mapMastodonItem } from '@/lib/services/accountImport/mappers/mapMastodonItem'
import type { ImportMapperContext } from '@/lib/services/accountImport/mappers/types'
import type { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const actor = {
  id: 'https://local.test/users/me',
  username: 'me',
  domain: 'local.test',
  followersUrl: 'https://local.test/users/me/followers'
} as Actor
const sourceActorId = 'https://old.test/users/owner'
const sourceFollowersUrl = 'https://old.test/followers/owner'
const published = '2024-02-03T04:05:06.000Z'
const context = (
  overrides: Partial<ImportMapperContext> = {}
): ImportMapperContext => ({
  actor,
  ownStatusIds: new Set(),
  nowMs: Date.parse('2025-01-01T00:00:00Z'),
  sourceActorId,
  sourceFollowersUrl,
  ...overrides
})

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'https://old.test/activities/1',
  type: 'Create',
  actor: sourceActorId,
  published,
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [sourceFollowersUrl],
  object: {
    id: 'https://old.test/statuses/1',
    type: 'Note',
    content: '<p>hello</p>',
    summary: null,
    sensitive: false,
    published,
    inReplyTo: null,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [sourceFollowersUrl],
    tag: [],
    attachment: [],
    url: 'https://old.test/@owner/1'
  },
  ...overrides
})

describe('mapMastodonItem', () => {
  it('skips every specified unsupported activity or date', () => {
    expect(
      mapMastodonItem(
        { ...item(), type: 'Announce', object: 'https://old.test/statuses/1' },
        context()
      )
    ).toEqual({ ok: false, reason: 'boost' })

    expect(
      mapMastodonItem(
        item({
          object: {
            ...(item().object as Record<string, unknown>),
            inReplyTo: 'https://elsewhere.test/status/parent'
          }
        }),
        context()
      )
    ).toEqual({ ok: false, reason: 'reply-to-other' })

    expect(
      mapMastodonItem(
        item({
          object: {
            ...(item().object as Record<string, unknown>),
            to: ['https://recipient.test/users/a'],
            cc: []
          }
        }),
        context()
      )
    ).toEqual({ ok: false, reason: 'direct' })

    expect(
      mapMastodonItem(
        item({
          object: {
            ...(item().object as Record<string, unknown>),
            published: 'not-a-date'
          }
        }),
        context()
      )
    ).toEqual({ ok: false, reason: 'bad-date' })
    expect(
      mapMastodonItem(
        item({
          object: {
            ...(item().object as Record<string, unknown>),
            published: '2030-01-01T00:00:00.000Z'
          }
        }),
        context()
      )
    ).toEqual({ ok: false, reason: 'bad-date' })
    expect(mapMastodonItem({ type: 'Create' }, context())).toEqual({
      ok: false,
      reason: 'invalid'
    })
  })

  it.each([
    {
      visibility: 'public',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [sourceFollowersUrl],
      expectedTo: [ACTIVITY_STREAM_PUBLIC],
      expectedCc: [actor.followersUrl]
    },
    {
      visibility: 'unlisted',
      to: [sourceFollowersUrl],
      cc: [ACTIVITY_STREAM_PUBLIC],
      expectedTo: [actor.followersUrl],
      expectedCc: [ACTIVITY_STREAM_PUBLIC]
    },
    {
      visibility: 'private',
      to: [sourceFollowersUrl],
      cc: [],
      expectedTo: [actor.followersUrl],
      expectedCc: []
    },
    {
      visibility: 'direct',
      to: [sourceActorId],
      cc: [],
      expectedTo: [actor.id],
      expectedCc: []
    }
  ] as const)(
    'rebuilds $visibility recipients for the target actor',
    (testCase) => {
      const input = item({
        object: {
          ...(item().object as Record<string, unknown>),
          to: testCase.to,
          cc: testCase.cc
        }
      })
      const result = mapMastodonItem(input, context())
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.input.visibility).toBe(testCase.visibility)
      expect(result.input.to).toEqual(testCase.expectedTo)
      expect(result.input.cc).toEqual(testCase.expectedCc)
      expect(result.input.to).not.toContain(sourceFollowersUrl)
      expect(result.input.cc).not.toContain(sourceFollowersUrl)
    }
  )

  it('keeps an external reply as data only when requested', () => {
    const result = mapMastodonItem(
      item({
        object: {
          ...(item().object as Record<string, unknown>),
          inReplyTo: 'https://elsewhere.test/status/parent'
        }
      }),
      context({ repliesToOthers: 'keep' })
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.replyToStatusId).toBeNull()
    expect(result.input.externalReplyUri).toBe(
      'https://elsewhere.test/status/parent'
    )
  })

  it('derives the same time ordered UUIDv7 on every run', () => {
    const first = mapMastodonItem(item(), context())
    const second = mapMastodonItem(item(), context())
    const later = mapMastodonItem(
      item({
        object: {
          ...(item().object as Record<string, unknown>),
          id: 'https://old.test/statuses/2',
          published: '2024-02-03T04:05:07.000Z'
        }
      }),
      context()
    )
    expect(first.ok && second.ok && later.ok).toBe(true)
    if (!first.ok || !second.ok || !later.ok) return
    expect(first.input.publicId).toBe(second.input.publicId)
    expect(first.input.publicId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(
      first.input.publicId.localeCompare(later.input.publicId)
    ).toBeLessThan(0)
  })

  it('drops unknown archive keys and rejects overlong strings', () => {
    const valid = mapMastodonItem(item({ untrusted: 'dropped' }), context())
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(valid.input).not.toHaveProperty('untrusted')

    const invalid = mapMastodonItem(
      item({
        object: {
          ...(item().object as Record<string, unknown>),
          content: 'x'.repeat(100_001)
        }
      }),
      context()
    )
    expect(invalid).toEqual({ ok: false, reason: 'invalid' })
  })
})
