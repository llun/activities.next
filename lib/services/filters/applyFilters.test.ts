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

const buildStatusNote = (id: string, text: string): Status =>
  ({
    id,
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

  it('returns status_matches when the status id is in the filter list', () => {
    const filter = buildFilter({ id: 'f2' })
    const statusId = 'https://llun.test/users/test1/statuses/2'
    const records: ActiveFilterRecord[] = [
      {
        filter,
        keywords: [],
        statuses: [
          {
            id: 'fs1',
            filterId: filter.id,
            statusId,
            createdAt: 0
          }
        ]
      }
    ]
    const status = buildStatusNote(statusId, 'no keywords here')
    const results = applyFiltersToStatus(status, records)
    expect(results).toHaveLength(1)
    expect(results[0].status_matches).toEqual(['fs1'])
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
})
