import {
  DateKey,
  addDays,
  localDateKeyAt,
  parseDateKey
} from '@/lib/fitness/calendar/localDay'
import { getPublicIdTimestamp, isPublicId } from '@/lib/utils/publicId'

import {
  DEFAULT_ANCHOR,
  DEFAULT_TIME_ZONE,
  SeedActivity,
  buildSeedPlan,
  fileIdFor,
  parseCliOptions,
  publicIdFor
} from './createMockFitnessCalendarData'

const ANCHOR = parseDateKey(DEFAULT_ANCHOR) as DateKey
const plan = buildSeedPlan({ anchor: ANCHOR, timeZone: DEFAULT_TIME_ZONE })

const isCountable = (activity: SeedActivity) =>
  activity.processingStatus === 'completed' &&
  activity.isPrimary &&
  !activity.deleted

const countableOn = (date: string) =>
  plan.filter((activity) => isCountable(activity) && activity.date === date)

const at = (key: string) => {
  const found = plan.find((activity) => activity.key === key)
  if (!found) throw new Error(`No seed activity ${key}`)
  return found
}

describe('buildSeedPlan', () => {
  it('is identical on every call', () => {
    const again = buildSeedPlan({ anchor: ANCHOR, timeZone: DEFAULT_TIME_ZONE })
    expect(again).toEqual(plan)
  })

  it('uses unique keys', () => {
    expect(new Set(plan.map((activity) => activity.key)).size).toBe(plan.length)
  })

  it('files every activity under the local day it names', () => {
    for (const activity of plan) {
      expect(localDateKeyAt(activity.startMs, DEFAULT_TIME_ZONE)).toBe(
        activity.date
      )
    }
  })

  it('writes nothing after 00:05 on the anchor day', () => {
    const anchorRows = plan.filter((activity) => activity.date === ANCHOR)
    expect(anchorRows.map((activity) => activity.time)).toEqual(['00:05'])
    const last = plan[plan.length - 1]
    expect(last.date).toBe(ANCHOR)
    expect(
      plan.every(
        (activity) => localDateKeyAt(activity.startMs, 'UTC') <= ANCHOR
      )
    ).toBe(true)
  })

  it('drops everything after an earlier anchor', () => {
    const earlier = buildSeedPlan({
      anchor: '2026-03-30' as DateKey,
      timeZone: DEFAULT_TIME_ZONE
    })
    expect(earlier.every((activity) => activity.date <= '2026-03-30')).toBe(
      true
    )
    expect(earlier.some((activity) => activity.date === '2026-03-29')).toBe(
      true
    )
    expect(earlier[earlier.length - 1].time).toBe('00:05')
  })

  it('covers 2023 to 2026', () => {
    const years = new Set(plan.map((activity) => activity.date.slice(0, 4)))
    expect([...years].sort()).toEqual(['2023', '2024', '2025', '2026'])
  })

  it('has a 22-activity day and a 5-activity day of countable rows', () => {
    expect(countableOn('2026-09-12')).toHaveLength(22)
    expect(countableOn('2026-09-26')).toHaveLength(5)
    expect(countableOn('2026-09-02')).toHaveLength(3)
    expect(countableOn('2026-09-03')).toHaveLength(2)
    expect(countableOn('2026-09-05')).toHaveLength(4)
  })

  it('has a first-line title over 200 characters', () => {
    const post = at('2026-08-23-0740-ride').postHtml as string
    const firstLine = post.split('</p>')[0].replace(/<[^>]+>/g, '')
    expect(firstLine.length).toBeGreaterThan(200)
  })

  it('leaves some activities without a post and mixes types', () => {
    const countable = plan.filter(isCountable)
    expect(countable.some((activity) => activity.postHtml === null)).toBe(true)
    expect(countable.some((activity) => activity.postHtml !== null)).toBe(true)
    expect(countable.some((activity) => activity.activityType === null)).toBe(
      true
    )
    const types = new Set(countable.map((activity) => activity.activityType))
    for (const type of ['run', 'ride', 'walk', 'hike']) {
      expect(types.has(type as never)).toBe(true)
    }
  })

  it('includes each kind of excluded row', () => {
    expect(plan.some((a) => !a.isPrimary)).toBe(true)
    expect(plan.some((a) => a.processingStatus === 'failed')).toBe(true)
    expect(plan.some((a) => a.processingStatus === 'pending')).toBe(true)
    expect(plan.some((a) => a.deleted)).toBe(true)
  })

  it('links the non-primary sibling to its primary post and nothing else', () => {
    const sibling = at('2026-09-09-0701-non-primary')
    const primary = at('2026-09-09-0700-run')
    expect(sibling.isPrimary).toBe(false)
    expect(sibling.postHtml).toBeNull()
    expect(sibling.postFrom).toBe(
      primary.postHtml === null ? null : primary.key
    )
  })

  it('leaves 8 September with only excluded rows', () => {
    const rows = plan.filter((activity) => activity.date === '2026-09-08')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some(isCountable)).toBe(false)
  })

  it('separates 23:45 and 00:10 by local day although both are one UTC day', () => {
    const late = at('2026-09-20-2345-boundary-run')
    const early = at('2026-09-21-0010-boundary-walk')
    expect(localDateKeyAt(late.startMs, DEFAULT_TIME_ZONE)).toBe('2026-09-20')
    expect(localDateKeyAt(early.startMs, DEFAULT_TIME_ZONE)).toBe('2026-09-21')
    expect(localDateKeyAt(late.startMs, 'UTC')).toBe('2026-09-20')
    expect(localDateKeyAt(early.startMs, 'UTC')).toBe('2026-09-20')
  })

  it('puts 00:30 Amsterdam on the previous UTC day', () => {
    const row = at('2026-09-15-0030-after-midnight')
    expect(new Date(row.startMs).toISOString()).toBe('2026-09-14T22:30:00.000Z')
  })

  it('has both 02:30 passes on the fall-back day, an hour apart', () => {
    const first = at('2025-10-26-0230-first-pass')
    const second = at('2025-10-26-0230-second-pass')
    expect(new Date(first.startMs).toISOString()).toBe(
      '2025-10-26T00:30:00.000Z'
    )
    expect(new Date(second.startMs).toISOString()).toBe(
      '2025-10-26T01:30:00.000Z'
    )
    expect(countableOn('2025-10-26')).toHaveLength(5)
  })

  it('seeds 2026-10-25 only once the anchor has reached it', () => {
    expect(plan.some((activity) => activity.date === '2026-10-25')).toBe(false)
    const later = buildSeedPlan({
      anchor: '2026-10-26' as DateKey,
      timeZone: DEFAULT_TIME_ZONE
    })
    const first = later.find((a) => a.key === '2026-10-25-0230-first-pass')
    const second = later.find((a) => a.key === '2026-10-25-0230-second-pass')
    expect(new Date(first?.startMs ?? 0).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z'
    )
    expect(new Date(second?.startMs ?? 0).toISOString()).toBe(
      '2026-10-25T01:30:00.000Z'
    )
  })

  it('has the spring-forward day without the skipped hour', () => {
    const rows = countableOn('2026-03-29')
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(rows.map((row) => row.time)).not.toContain('02:30')
  })

  it('has the leap day and the year and month edges', () => {
    expect(countableOn('2024-02-29')).toHaveLength(2)
    for (const date of [
      '2024-12-31',
      '2025-01-01',
      '2026-08-31',
      '2026-09-01'
    ]) {
      expect(countableOn(date).length).toBeGreaterThan(0)
    }
    // 22:10Z on 30 June is local 1 July: a UTC bucket would fill the empty month.
    const july = at('2025-07-01-0010-after-empty')
    expect(new Date(july.startMs).toISOString()).toBe(
      '2025-06-30T22:10:00.000Z'
    )
  })

  it('leaves 2025-06 empty in local time, and rest weeks empty', () => {
    expect(plan.filter((a) => a.date.startsWith('2025-06-'))).toEqual([])
    for (const monday of [
      '2023-08-14',
      '2024-08-05',
      '2026-04-13',
      '2026-07-20'
    ]) {
      for (let offset = 0; offset < 7; offset += 1) {
        const date = addDays(monday as DateKey, offset)
        expect(plan.filter((a) => a.date === date)).toEqual([])
      }
    }
  })

  it('keeps paces and speeds plausible', () => {
    for (const activity of plan.filter(isCountable)) {
      const { distanceMeters, durationSeconds, activityType } = activity
      expect(distanceMeters).toBeGreaterThan(0)
      expect(durationSeconds).toBeGreaterThan(0)
      const km = (distanceMeters as number) / 1000
      const seconds = durationSeconds as number
      const kmh = km / (seconds / 3600)
      if (activityType === 'run' || activityType === null) {
        // 5:00-6:30 per km; rounding the distance moves it a hair
        expect(seconds / km).toBeGreaterThanOrEqual(298)
        expect(seconds / km).toBeLessThanOrEqual(392)
      }
      if (activityType === 'ride' || activityType === 'gravel_ride') {
        expect(kmh).toBeGreaterThanOrEqual(21.9)
        expect(kmh).toBeLessThanOrEqual(30.1)
      }
    }
  })

  it('derives post and file ids from the actor and key alone', () => {
    const actorId = 'https://localhost:3102/users/testuser'
    const row = at('2026-09-20-2345-boundary-run')
    const publicId = publicIdFor(actorId, row.key, row.startMs)
    expect(isPublicId(publicId)).toBe(true)
    expect(publicIdFor(actorId, row.key, row.startMs)).toBe(publicId)
    expect(publicIdFor('https://other/users/x', row.key, row.startMs)).not.toBe(
      publicId
    )
    expect(getPublicIdTimestamp(publicId)).toBe(row.startMs)
    expect(fileIdFor(actorId, row.key)).toBe(fileIdFor(actorId, row.key))
    expect(fileIdFor(actorId, row.key)).not.toBe(fileIdFor(actorId, 'other'))
  })
})

describe('parseCliOptions', () => {
  it('defaults both flags together', () => {
    expect(parseCliOptions([])).toEqual({
      anchor: DEFAULT_ANCHOR,
      timeZone: DEFAULT_TIME_ZONE,
      username: 'testuser'
    })
  })

  it('accepts both forms of a flag', () => {
    expect(
      parseCliOptions([
        '--anchor',
        '2026-10-04',
        '--time-zone=America/Los_Angeles',
        '--username',
        'sam'
      ])
    ).toEqual({
      anchor: '2026-10-04',
      timeZone: 'America/Los_Angeles',
      username: 'sam'
    })
  })

  it('requires the two flags together', () => {
    expect(() => parseCliOptions(['--anchor', '2026-10-04'])).toThrow(
      /go together/
    )
    expect(() => parseCliOptions(['--time-zone', 'Europe/Amsterdam'])).toThrow(
      /go together/
    )
  })

  it('rejects bad values and unknown flags', () => {
    expect(() =>
      parseCliOptions(['--anchor', '2026-02-30', '--time-zone', 'UTC'])
    ).toThrow(/real YYYY-MM-DD/)
    expect(() =>
      parseCliOptions(['--anchor', '2026-10-04', '--time-zone', 'Nowhere/Land'])
    ).toThrow(/IANA/)
    expect(() => parseCliOptions(['--wat'])).toThrow(/Unknown argument/)
    expect(() => parseCliOptions(['--anchor'])).toThrow(/Missing value/)
  })
})
