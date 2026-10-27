import { mapOwnStatus } from '@/lib/services/accountImport/mappers/mapOwnStatus'
import type { ImportMapperContext } from '@/lib/services/accountImport/mappers/types'
import type { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const actor = {
  id: 'https://local.test/users/me',
  username: 'me',
  domain: 'local.test',
  followersUrl: 'https://local.test/users/me/followers'
} as Actor
const published = '2024-02-03T04:05:06.000Z'
const sourceActorId = 'https://old.test/users/owner'
const context = (
  overrides: Partial<ImportMapperContext> = {}
): ImportMapperContext => ({
  actor,
  ownStatusIds: new Set(),
  nowMs: Date.parse('2025-01-01T00:00:00Z'),
  sourceActorId,
  ...overrides
})

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'https://old.test/users/owner/statuses/1',
  publicId: null,
  type: 'Note',
  actorId: 'https://old.test/users/owner',
  visibility: 'public',
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: ['https://old.test/users/owner/followers'],
  createdAt: published,
  updatedAt: published,
  url: 'https://old.test/@owner/1',
  inReplyTo: null,
  text: 'hello',
  summary: null,
  sensitive: false,
  language: null,
  applicationName: null,
  applicationWebsite: null,
  pinned: false,
  quote: null,
  quoteApprovalPolicy: 'public',
  tags: [],
  attachments: [],
  poll: null,
  edits: [],
  ...overrides
})

describe('mapOwnStatus', () => {
  it('skips boosts, replies to others, and invalid or bad dates', () => {
    expect(
      mapOwnStatus(
        row({
          type: 'Announce',
          originalStatusId: 'https://old.test/status/2'
        }),
        context()
      )
    ).toEqual({ ok: false, reason: 'boost' })

    expect(
      mapOwnStatus(
        row({ inReplyTo: 'https://elsewhere.test/status/parent' }),
        context()
      )
    ).toEqual({ ok: false, reason: 'reply-to-other' })

    expect(
      mapOwnStatus(
        row({ inReplyTo: 'https://elsewhere.test/status/parent' }),
        context({ repliesToOthers: 'keep' })
      )
    ).toMatchObject({
      ok: true,
      input: {
        replyToStatusId: null,
        externalReplyUri: 'https://elsewhere.test/status/parent'
      }
    })

    expect(mapOwnStatus(row({ createdAt: 'not-a-date' }), context())).toEqual({
      ok: false,
      reason: 'bad-date'
    })
    expect(
      mapOwnStatus(row({ createdAt: '2030-01-01T00:00:00.000Z' }), context())
    ).toEqual({ ok: false, reason: 'bad-date' })
    expect(mapOwnStatus({ text: 'missing fields' }, context())).toEqual({
      ok: false,
      reason: 'invalid'
    })
    expect(mapOwnStatus(row({ text: 'x'.repeat(100_001) }), context())).toEqual(
      { ok: false, reason: 'invalid' }
    )
  })

  it.each([
    {
      visibility: 'public',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: ['https://old.test/users/owner/followers'],
      expectedTo: [ACTIVITY_STREAM_PUBLIC],
      expectedCc: [actor.followersUrl]
    },
    {
      visibility: 'unlisted',
      to: ['https://old.test/users/owner/followers'],
      cc: [ACTIVITY_STREAM_PUBLIC],
      expectedTo: [actor.followersUrl],
      expectedCc: [ACTIVITY_STREAM_PUBLIC]
    },
    {
      visibility: 'private',
      to: ['https://old.test/users/owner/followers'],
      cc: [],
      expectedTo: [actor.followersUrl],
      expectedCc: []
    },
    {
      visibility: 'direct',
      to: ['https://old.test/users/recipient'],
      cc: [],
      expectedTo: [actor.id],
      expectedCc: []
    }
  ] as const)('rebuilds own-export $visibility recipients', (testCase) => {
    const result = mapOwnStatus(
      row({
        visibility: testCase.visibility,
        to: testCase.to,
        cc: testCase.cc,
        tags:
          testCase.visibility === 'direct'
            ? [
                {
                  id: 'tag-1',
                  statusId: 'https://old.test/users/owner/statuses/1',
                  type: 'mention',
                  name: '@recipient@elsewhere.test',
                  value: 'https://old.test/users/recipient',
                  createdAt: published,
                  updatedAt: published
                }
              ]
            : []
      }),
      context()
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.visibility).toBe(testCase.visibility)
    expect(result.input.to).toEqual(testCase.expectedTo)
    expect(result.input.cc).toEqual(testCase.expectedCc)
    expect(result.input.to).not.toContain(
      'https://old.test/users/owner/followers'
    )
    expect(result.input.cc).not.toContain(
      'https://old.test/users/owner/followers'
    )
  })

  it('skips a row authored by anyone other than the archive actor', () => {
    expect(
      mapOwnStatus(
        row({ actorId: 'https://elsewhere.test/users/impostor' }),
        context()
      )
    ).toEqual({ ok: false, reason: 'foreign-author' })
    // An archive whose own actor id is unknown cannot be verified at all.
    expect(mapOwnStatus(row(), context({ sourceActorId: undefined }))).toEqual({
      ok: false,
      reason: 'foreign-author'
    })
  })

  it('binds the deterministic publicId to the importing actor', () => {
    const otherActor = {
      ...actor,
      id: 'https://local.test/users/other',
      username: 'other'
    } as Actor
    const mine = mapOwnStatus(row(), context())
    const mineAgain = mapOwnStatus(row(), context())
    const theirs = mapOwnStatus(row(), context({ actor: otherActor }))
    const theirsAgain = mapOwnStatus(row(), context({ actor: otherActor }))
    expect(mine.ok && mineAgain.ok && theirs.ok && theirsAgain.ok).toBe(true)
    if (!mine.ok || !mineAgain.ok || !theirs.ok || !theirsAgain.ok) return
    expect(mine.input.publicId).toBe(mineAgain.input.publicId)
    expect(theirs.input.publicId).toBe(theirsAgain.input.publicId)
    expect(theirs.input.publicId).not.toBe(mine.input.publicId)
  })

  it('derives a stable time ordered UUIDv7 and strips unknown keys', () => {
    const first = mapOwnStatus(row({ untrusted: 'dropped' }), context())
    const second = mapOwnStatus(row({ untrusted: 'dropped' }), context())
    const later = mapOwnStatus(
      row({
        id: 'https://old.test/users/owner/statuses/2',
        createdAt: '2024-02-03T04:05:07.000Z'
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
    expect(first.input).not.toHaveProperty('untrusted')
  })

  const edit = (supersededAt: string) => ({
    text: 'old text',
    summary: null,
    sensitive: false,
    attachments: null,
    pollOptions: null,
    supersededAt
  })
  const editsOf = (result: ReturnType<typeof mapOwnStatus>) =>
    result.ok ? result.input.edits : null

  it('drops an edit superseded later than now plus the skew', () => {
    // nowMs is 2025-01-01; an edit a year ahead is beyond the 5-minute skew.
    const result = mapOwnStatus(
      row({ edits: [edit('2030-01-01T00:00:00.000Z')] }),
      context()
    )
    expect(editsOf(result)).toEqual([])
  })

  it('drops an edit whose supersede time does not parse', () => {
    const result = mapOwnStatus(row({ edits: [edit('not-a-date')] }), context())
    expect(editsOf(result)).toEqual([])
  })

  it('drops an edit superseded before the status was published', () => {
    // published is 2024-02-03T04:05:06.000Z; one second earlier predates it.
    const result = mapOwnStatus(
      row({ edits: [edit('2024-02-03T04:05:05.000Z')] }),
      context()
    )
    expect(editsOf(result)).toEqual([])
  })

  it('keeps a valid edit, including one within the skew', () => {
    const nowMs = Date.parse('2025-01-01T00:00:00Z')
    const result = mapOwnStatus(
      row({
        edits: [
          edit('2024-02-03T04:05:07.000Z'),
          edit(new Date(nowMs + 4 * 60 * 1_000).toISOString())
        ]
      }),
      context()
    )
    expect(editsOf(result)).toEqual([
      {
        text: 'old text',
        summary: null,
        sensitive: false,
        attachments: null,
        pollOptions: null,
        supersededAt: Date.parse('2024-02-03T04:05:07.000Z')
      },
      {
        text: 'old text',
        summary: null,
        sensitive: false,
        attachments: null,
        pollOptions: null,
        supersededAt: nowMs + 4 * 60 * 1_000
      }
    ])
  })
})
