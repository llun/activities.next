import {
  annotateMastodonStatusesWithFilters,
  applyFiltersToStatus,
  buildKeywordMatcher,
  dropHideMatchesFromStatuses,
  partitionStatusesByFilters
} from '@/lib/services/filters/applyFilters'
import { ActiveFilterRecord } from '@/lib/types/database/operations'
import { Filter, FilterKeyword } from '@/lib/types/domain/filter'
import { Status, StatusType } from '@/lib/types/domain/status'
import * as Mastodon from '@/lib/types/mastodon'
import { generatePublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

const TEST_ACTOR = 'https://llun.test/users/test1'

const buildFilter = (overrides: Partial<Filter> & { id: string }): Filter => ({
  actorId: TEST_ACTOR,
  title: 'Test filter',
  context: ['home'],
  filterAction: 'warn',
  expiresAt: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides
})

const buildKeyword = (
  filterId: string,
  keyword: string,
  wholeWord = false,
  id = `${filterId}:kw:${keyword}`
): FilterKeyword => ({
  id,
  filterId,
  keyword,
  wholeWord,
  createdAt: 0,
  updatedAt: 0
})

const buildStatusNote = (
  id: string,
  text: string,
  publicId: string | null = null
): Status =>
  ({
    id,
    publicId,
    actorId: TEST_ACTOR,
    actor: null,
    type: StatusType.enum.Note,
    url: id,
    text,
    summary: null,
    reply: '',
    replies: [],
    actorAnnounceStatusId: null,
    isActorLiked: false,
    isActorBookmarked: false,
    totalLikes: 0,
    totalShares: 0,
    attachments: [],
    tags: [],
    to: [],
    cc: [],
    edits: [],
    isLocalActor: true,
    createdAt: 0,
    updatedAt: 0
  }) as unknown as Status

const buildStatusAnnounce = (
  id: string,
  originalStatus: Status,
  publicId: string | null = null
): Status =>
  ({
    id,
    publicId,
    actorId: TEST_ACTOR,
    actor: null,
    type: StatusType.enum.Announce,
    originalStatus,
    to: [],
    cc: [],
    edits: [],
    isLocalActor: true,
    createdAt: 0,
    updatedAt: 0
  }) as unknown as Status

// The three forms `filter_statuses.statusId` can durably hold for one status:
// the resolved ActivityPub URI (what the write route stores today), the legacy
// colon form (rows written before the route resolved client ids), and a bare
// publicId (a post-flip client id the route could not resolve, stored as sent).
const buildStoredStatusIdCases = (status: Status) => [
  { description: 'the resolved status uri', stored: status.id },
  { description: 'the legacy colon form', stored: urlToId(status.id) },
  { description: 'a bare publicId', stored: status.publicId as string }
]

const buildStatusIdFilterRecord = (
  filterId: string,
  storedStatusId: string,
  overrides: Partial<Filter> = {}
): ActiveFilterRecord => {
  const filter = buildFilter({ id: filterId, ...overrides })
  return {
    filter,
    keywords: [],
    statuses: [
      {
        id: `${filterId}:fs`,
        filterId: filter.id,
        statusId: storedStatusId,
        createdAt: 0
      }
    ]
  }
}

describe('buildKeywordMatcher', () => {
  it('matches partial when whole_word is false', () => {
    const matcher = buildKeywordMatcher('cat', false)
    expect(matcher.test('catalog')).toBe(true)
    expect(matcher.test('a CAT here')).toBe(true)
  })

  it('respects whole-word boundaries (ASCII)', () => {
    const matcher = buildKeywordMatcher('cat', true)
    expect(matcher.test('catalog')).toBe(false)
    expect(matcher.test('the cat sat')).toBe(true)
    expect(matcher.test('-cat-')).toBe(true)
    expect(matcher.test('cat')).toBe(true)
  })

  it('handles Unicode whole-word boundaries', () => {
    const matcher = buildKeywordMatcher('café', true)
    expect(matcher.test('Visit the café today')).toBe(true)
    expect(matcher.test('cafés')).toBe(false)
  })

  it('treats a non-word keyword as a literal anywhere when whole_word=true', () => {
    const matcher = buildKeywordMatcher('!!', true)
    expect(matcher.test('hello!!')).toBe(true)
  })
})

describe('applyFiltersToStatus', () => {
  it('returns a FilterResult with keyword_matches for a content match', () => {
    const filter = buildFilter({ id: 'f1' })
    const records: ActiveFilterRecord[] = [
      {
        filter,
        keywords: [buildKeyword(filter.id, 'spoiler', true)],
        statuses: []
      }
    ]
    const status = buildStatusNote(
      'https://llun.test/users/test1/statuses/1',
      'Big spoiler ahead.'
    )

    const results = applyFiltersToStatus(status, records)
    expect(results).toHaveLength(1)
    expect(results[0].keyword_matches).toEqual(['spoiler'])
    expect(results[0].status_matches).toBeNull()
  })

  // A filter status row can hold the resolved status URI (written by the route
  // today), the legacy colon-form id (written before the route resolved client
  // ids), or a publicId the route could not resolve and stored unchanged. All
  // three must keep matching the same status, or a filter silently stops
  // working with nothing to show for it.
  //
  // A URI is emitted in the colon form so a client can compare `status_matches`
  // against the status ids it holds; anything else is emitted exactly as
  // stored, since running urlToId over a bare publicId would append a `:` the
  // client never wrote.
  const matchTarget = buildStatusNote(
    'https://llun.test/users/test1/statuses/2',
    'no keywords here',
    generatePublicId()
  )
  it.each(
    buildStoredStatusIdCases(matchTarget).map((testCase) => ({
      ...testCase,
      emitted:
        testCase.stored === matchTarget.id
          ? urlToId(matchTarget.id)
          : testCase.stored
    }))
  )(
    'returns status_matches for a row stored as $description',
    ({ stored, emitted }) => {
      const records = [buildStatusIdFilterRecord('f2', stored)]
      const results = applyFiltersToStatus(matchTarget, records)
      expect(results).toHaveLength(1)
      expect(results[0].status_matches).toEqual([emitted])
    }
  )

  const announceOriginal = buildStatusNote(
    'https://llun.test/users/test1/statuses/original',
    'reblogged body',
    generatePublicId()
  )
  it.each(buildStoredStatusIdCases(announceOriginal))(
    'matches an announce through the reblogged original stored as $description',
    ({ stored }) => {
      const announce = buildStatusAnnounce(
        'https://llun.test/users/test2/statuses/announce',
        announceOriginal,
        generatePublicId()
      )
      const records = [buildStatusIdFilterRecord('f-announce', stored)]
      expect(applyFiltersToStatus(announce, records)).toHaveLength(1)
    }
  )

  it('matches an announce through the announce wrapper public id', () => {
    const original = buildStatusNote(
      'https://llun.test/users/test1/statuses/announce-original',
      'reblogged body',
      generatePublicId()
    )
    const announce = buildStatusAnnounce(
      'https://llun.test/users/test2/statuses/announce-wrapper',
      original,
      generatePublicId()
    )
    const records = [
      buildStatusIdFilterRecord('f-wrapper', announce.publicId as string)
    ]
    expect(applyFiltersToStatus(announce, records)).toHaveLength(1)
  })

  it('does not match a status whose public id belongs to another status', () => {
    const status = buildStatusNote(
      'https://llun.test/users/test1/statuses/other',
      'no keywords here',
      generatePublicId()
    )
    const records = [buildStatusIdFilterRecord('f-other', generatePublicId())]
    expect(applyFiltersToStatus(status, records)).toEqual([])
  })

  it('returns no matches when none of the keywords or status ids hit', () => {
    const filter = buildFilter({ id: 'f3' })
    const records: ActiveFilterRecord[] = [
      {
        filter,
        keywords: [buildKeyword(filter.id, 'banana')],
        statuses: []
      }
    ]
    const status = buildStatusNote(
      'https://llun.test/users/test1/statuses/3',
      'totally unrelated body'
    )
    expect(applyFiltersToStatus(status, records)).toEqual([])
  })
})

describe('partitionStatusesByFilters', () => {
  it('drops statuses that have any hide match', () => {
    const hideFilter = buildFilter({
      id: 'hide',
      filterAction: 'hide'
    })
    const records: ActiveFilterRecord[] = [
      {
        filter: hideFilter,
        keywords: [buildKeyword(hideFilter.id, 'taboo')],
        statuses: []
      }
    ]
    const visible = buildStatusNote(
      'https://llun.test/users/test1/statuses/visible',
      'fine'
    )
    const dropped = buildStatusNote(
      'https://llun.test/users/test1/statuses/dropped',
      'this contains taboo'
    )

    const result = partitionStatusesByFilters([visible, dropped], records)
    expect(result.visible.map((entry) => entry.status.id)).toEqual([visible.id])
    expect(result.droppedIds).toEqual([dropped.id])
  })

  const hideTarget = buildStatusNote(
    'https://llun.test/users/test1/statuses/hide-by-id',
    'no keywords here',
    generatePublicId()
  )
  it.each(buildStoredStatusIdCases(hideTarget))(
    'drops a status hidden by a row stored as $description',
    ({ stored }) => {
      const keep = buildStatusNote(
        'https://llun.test/users/test1/statuses/hide-by-id-keep',
        'no keywords here',
        generatePublicId()
      )
      const records = [
        buildStatusIdFilterRecord('f-hide-by-id', stored, {
          filterAction: 'hide'
        })
      ]

      const result = partitionStatusesByFilters([keep, hideTarget], records)
      expect(result.visible.map((entry) => entry.status.id)).toEqual([keep.id])
      expect(result.droppedIds).toEqual([hideTarget.id])
    }
  )

  it('keeps statuses that only have warn matches and attaches filter results', () => {
    const warnFilter = buildFilter({ id: 'warn' })
    const records: ActiveFilterRecord[] = [
      {
        filter: warnFilter,
        keywords: [buildKeyword(warnFilter.id, 'spoiler')],
        statuses: []
      }
    ]
    const status = buildStatusNote(
      'https://llun.test/users/test1/statuses/warned',
      'spoiler alert'
    )

    const result = partitionStatusesByFilters([status], records)
    expect(result.droppedIds).toEqual([])
    expect(result.visible).toHaveLength(1)
    expect(result.visible[0].filtered).toHaveLength(1)
  })
})

describe('dropHideMatchesFromStatuses', () => {
  it('removes only statuses matched by hide filters', () => {
    const hideFilter = buildFilter({ id: 'h', filterAction: 'hide' })
    const warnFilter = buildFilter({ id: 'w' })
    const records: ActiveFilterRecord[] = [
      {
        filter: hideFilter,
        keywords: [buildKeyword(hideFilter.id, 'gone')],
        statuses: []
      },
      {
        filter: warnFilter,
        keywords: [buildKeyword(warnFilter.id, 'maybe')],
        statuses: []
      }
    ]
    const keep1 = buildStatusNote(
      'https://llun.test/users/test1/statuses/keep1',
      'fine'
    )
    const drop = buildStatusNote(
      'https://llun.test/users/test1/statuses/drop',
      'now gone'
    )
    const keep2 = buildStatusNote(
      'https://llun.test/users/test1/statuses/keep2',
      'maybe interesting'
    )

    const result = dropHideMatchesFromStatuses([keep1, drop, keep2], records)
    expect(result.map((s) => s.id)).toEqual([keep1.id, keep2.id])
  })
})

describe('annotateMastodonStatusesWithFilters', () => {
  it('attaches filtered results to corresponding Mastodon statuses', () => {
    const filter = buildFilter({ id: 'annotate' })
    const records: ActiveFilterRecord[] = [
      {
        filter,
        keywords: [buildKeyword(filter.id, 'soon')],
        statuses: []
      }
    ]
    const status = buildStatusNote(
      'https://llun.test/users/test1/statuses/a1',
      'releasing soon'
    )
    const mastodonStatus = { id: status.id } as Mastodon.Status
    const annotated = annotateMastodonStatusesWithFilters(
      [mastodonStatus],
      [status],
      records
    )
    expect(annotated[0].filtered).toHaveLength(1)
  })

  // The serialized entity is keyed by its EMITTED id: the publicId when the row
  // has one, the legacy colon form when it predates the backfill. Both have to
  // find the domain status they were built from, or the annotation vanishes
  // with no error anywhere.
  it.each([
    {
      description: 'a public id',
      publicId: generatePublicId(),
      emittedId: (status: Status) => status.publicId as string
    },
    {
      description: 'the legacy colon form on a pre-backfill row',
      publicId: null,
      emittedId: (status: Status) => urlToId(status.id)
    }
  ])(
    'annotates a serialized status whose id is $description',
    ({ publicId, emittedId }) => {
      const filter = buildFilter({ id: 'annotate-public-id' })
      const records: ActiveFilterRecord[] = [
        {
          filter,
          keywords: [buildKeyword(filter.id, 'soon')],
          statuses: []
        }
      ]
      const status = buildStatusNote(
        'https://llun.test/users/test1/statuses/a2',
        'releasing soon',
        publicId
      )
      const mastodonStatus = { id: emittedId(status) } as Mastodon.Status

      const annotated = annotateMastodonStatusesWithFilters(
        [mastodonStatus],
        [status],
        records
      )
      expect(annotated[0].filtered).toHaveLength(1)
    }
  )

  it('annotates a reblog on its inner status when the entity id is a public id', () => {
    const filter = buildFilter({ id: 'annotate-reblog' })
    const records: ActiveFilterRecord[] = [
      {
        filter,
        keywords: [buildKeyword(filter.id, 'soon')],
        statuses: []
      }
    ]
    const original = buildStatusNote(
      'https://llun.test/users/test1/statuses/a3',
      'releasing soon',
      generatePublicId()
    )
    const announce = buildStatusAnnounce(
      'https://llun.test/users/test2/statuses/a3-announce',
      original,
      generatePublicId()
    )
    const mastodonStatus = {
      id: announce.publicId as string,
      reblog: { id: original.publicId as string }
    } as Mastodon.Status

    const annotated = annotateMastodonStatusesWithFilters(
      [mastodonStatus],
      [announce],
      records
    )
    expect(annotated[0].filtered).toBeUndefined()
    expect(annotated[0].reblog?.filtered).toHaveLength(1)
  })
})
