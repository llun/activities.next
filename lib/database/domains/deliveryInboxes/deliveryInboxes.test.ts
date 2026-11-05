import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  DELIVERY_FAILURE_DAYS_THRESHOLD,
  DELIVERY_UNAVAILABLE_PROBE_INTERVAL_MS,
  MAX_DELIVERY_LAST_ERROR_LENGTH
} from '@/lib/database/domains/deliveryInboxes/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

describe('deliveryInboxes database domain', () => {
  const { database, db, prepare, destroy } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await db.deleteFrom('delivery_inbox_failures').execute()
  })

  it('records the first failure, ignores same-day repeats, and truncates lastError', async () => {
    const t1 = Date.parse('2026-11-01T08:00:00.000Z')
    const t2 = Date.parse('2026-11-01T23:59:59.000Z')
    const longError = 'x'.repeat(MAX_DELIVERY_LAST_ERROR_LENGTH + 80)

    const firstMarked = await database.recordDeliveryFailure({
      inbox: 'https://Remote.Example/Inbox',
      error: 'HTTP 503',
      now: t1
    })
    expect(firstMarked).toBe(false)
    expect(
      await database.isInboxUnavailable({
        inbox: 'https://Remote.Example/Inbox',
        now: Date.parse('2026-11-07T12:00:00.000Z')
      })
    ).toBe(false)

    const secondMarked = await database.recordDeliveryFailure({
      inbox: 'https://Remote.Example/Inbox',
      error: longError,
      now: t2
    })
    expect(secondMarked).toBe(false)

    const row = await db
      .selectFrom('delivery_inbox_failures')
      .selectAll()
      .where('inbox', '=', 'https://Remote.Example/Inbox')
      .executeTakeFirstOrThrow()

    expect(row.inbox).toBe('https://Remote.Example/Inbox')
    expect(row.domain).toBe('remote.example')
    expect(row.failureDays).toBe(1)
    expect(row.lastFailureDay).toBe('2026-11-01')
    expect(Number(row.firstFailureAt)).toBe(t1)
    expect(Number(row.lastFailureAt)).toBe(t2)
    expect(row.unavailableSince).toBeNull()
    expect(row.lastError).toBe('x'.repeat(MAX_DELIVERY_LAST_ERROR_LENGTH))
  })

  it('marks the inbox unavailable on the 7th distinct UTC day and returns true only once', async () => {
    for (let day = 1; day < DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      const now = Date.parse(`2026-11-0${day}T12:00:00.000Z`)
      const marked = await database.recordDeliveryFailure({
        inbox: 'https://failing.example/inbox',
        error: 'HTTP 502',
        now
      })
      expect(marked).toBe(false)
      expect(
        await database.isInboxUnavailable({
          inbox: 'https://failing.example/inbox',
          now: Date.parse('2026-11-07T12:00:00.000Z')
        })
      ).toBe(false)
    }

    const seventhDay = Date.parse('2026-11-07T12:00:00.000Z')
    const markedOnSeventh = await database.recordDeliveryFailure({
      inbox: 'https://failing.example/inbox',
      error: 'ETIMEDOUT',
      now: seventhDay
    })
    expect(markedOnSeventh).toBe(true)
    expect(
      await database.isInboxUnavailable({
        inbox: 'https://failing.example/inbox',
        now: Date.parse('2026-11-07T12:00:00.000Z')
      })
    ).toBe(true)
    expect(
      await database.isInboxUnavailable({
        inbox: 'https://FAILING.EXAMPLE/inbox',
        now: seventhDay
      })
    ).toBe(false)

    const eighthDay = Date.parse('2026-11-08T12:00:00.000Z')
    const markedOnEighth = await database.recordDeliveryFailure({
      inbox: 'https://failing.example/inbox',
      error: 'ETIMEDOUT',
      now: eighthDay
    })
    expect(markedOnEighth).toBe(false)

    const row = await db
      .selectFrom('delivery_inbox_failures')
      .selectAll()
      .where('inbox', '=', 'https://failing.example/inbox')
      .executeTakeFirstOrThrow()

    expect(row.failureDays).toBe(8)
    expect(Number(row.unavailableSince)).toBe(seventhDay)
  })

  it('clears failures so a recovered inbox starts counting from day 1 again', async () => {
    for (let day = 1; day <= DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        inbox: 'https://recovered.example/inbox',
        error: 'HTTP 503',
        now: Date.parse(`2026-11-0${day}T10:00:00.000Z`)
      })
    }
    expect(
      await database.isInboxUnavailable({
        inbox: 'https://recovered.example/inbox',
        now: Date.parse('2026-11-07T12:00:00.000Z')
      })
    ).toBe(true)

    await database.clearDeliveryFailures({
      inbox: 'https://recovered.example/inbox'
    })

    expect(
      await database.isInboxUnavailable({
        inbox: 'https://recovered.example/inbox',
        now: Date.parse('2026-11-07T12:00:00.000Z')
      })
    ).toBe(false)

    const markedAfterClear = await database.recordDeliveryFailure({
      inbox: 'https://recovered.example/inbox',
      error: 'HTTP 503',
      now: Date.parse('2026-11-10T10:00:00.000Z')
    })
    expect(markedAfterClear).toBe(false)

    const row = await db
      .selectFrom('delivery_inbox_failures')
      .select(['failureDays', 'unavailableSince'])
      .where('inbox', '=', 'https://recovered.example/inbox')
      .executeTakeFirstOrThrow()
    expect(row.failureDays).toBe(1)
    expect(row.unavailableSince).toBeNull()
  })

  it('returns only unavailable inboxes in getUnavailableInboxes', async () => {
    for (let day = 1; day <= DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        inbox: 'https://dead-one.example/inbox',
        error: 'HTTP 504',
        now: Date.parse(`2026-11-0${day}T04:00:00.000Z`)
      })
      await database.recordDeliveryFailure({
        inbox: 'https://dead-two.example/inbox',
        error: 'ECONNREFUSED',
        now: Date.parse(`2026-11-0${day}T04:00:00.000Z`)
      })
    }

    await database.recordDeliveryFailure({
      inbox: 'https://flaky.example/inbox',
      error: 'HTTP 503',
      now: Date.parse('2026-11-01T04:00:00.000Z')
    })

    expect(await database.getUnavailableInboxes({ inboxes: [] })).toEqual([])

    const unavailable = await database.getUnavailableInboxes({
      now: Date.parse('2026-11-07T12:00:00.000Z'),
      inboxes: [
        'https://dead-one.example/inbox',
        'https://dead-one.example/inbox',
        'https://flaky.example/inbox',
        'https://healthy.example/inbox',
        'https://dead-two.example/inbox'
      ]
    })

    expect(unavailable.sort()).toEqual([
      'https://dead-one.example/inbox',
      'https://dead-two.example/inbox'
    ])
  })

  it('serializes concurrent failures on the threshold day so only one call marks unavailable', async () => {
    for (let day = 1; day < DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        inbox: 'https://race.example/inbox',
        error: 'HTTP 503',
        now: Date.parse(`2026-11-0${day}T06:00:00.000Z`)
      })
    }

    const thresholdTime = Date.parse('2026-11-07T06:00:00.000Z')
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        database.recordDeliveryFailure({
          inbox: 'https://race.example/inbox',
          error: 'HTTP 503',
          now: thresholdTime
        })
      )
    )

    expect(outcomes.filter(Boolean)).toHaveLength(1)

    const row = await db
      .selectFrom('delivery_inbox_failures')
      .select(['failureDays', 'unavailableSince'])
      .where('inbox', '=', 'https://race.example/inbox')
      .executeTakeFirstOrThrow()
    expect(row.failureDays).toBe(DELIVERY_FAILURE_DAYS_THRESHOLD)
    expect(Number(row.unavailableSince)).toBe(thresholdTime)
  })

  it.each(['https://victim.example:1/x', 'https://victim.example/other'])(
    'isolates failures for %s from the legitimate inbox',
    async (inbox) => {
      const now = Date.parse('2026-11-07T12:00:00.000Z')
      for (let day = 0; day < DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
        await database.recordDeliveryFailure({
          inbox,
          now: now - (6 - day) * 86400000
        })
      }
      expect(await database.isInboxUnavailable({ inbox, now })).toBe(true)
      expect(
        await database.isInboxUnavailable({
          inbox: 'https://victim.example/inbox',
          now
        })
      ).toBe(false)
      expect(
        await database.getUnavailableInboxes({
          inboxes: [inbox, 'https://victim.example/inbox'],
          now
        })
      ).toEqual([inbox])
    }
  )

  it('allows a daily probe after the 24 hour window and suppresses again after a failed probe', async () => {
    const inbox = 'https://probe.example/inbox'
    const lastFailureAt = Date.parse('2026-11-07T12:00:00.000Z')
    for (let day = 0; day < DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        inbox,
        now: lastFailureAt - (6 - day) * 86400000
      })
    }
    const insideWindow =
      lastFailureAt + DELIVERY_UNAVAILABLE_PROBE_INTERVAL_MS - 1
    const atBoundary = insideWindow + 1
    const afterWindow = atBoundary + 1
    for (const now of [insideWindow, atBoundary, afterWindow]) {
      expect(await database.isInboxUnavailable({ inbox, now })).toBe(
        now === insideWindow
      )
      expect(
        await database.getUnavailableInboxes({ inboxes: [inbox], now })
      ).toEqual(now === insideWindow ? [inbox] : [])
    }
    await database.recordDeliveryFailure({ inbox, now: afterWindow })
    expect(await database.isInboxUnavailable({ inbox, now: afterWindow })).toBe(
      true
    )
  })

  it('clears every inbox for a verified domain and preserves other domains', async () => {
    const inboxes = [
      'https://Remote.Example/inbox',
      'https://remote.example:1/x',
      'https://remote.example/other',
      'https://other.example/inbox'
    ]
    for (const inbox of inboxes) {
      await database.recordDeliveryFailure({ inbox })
    }
    // A successful POST clears only the exact destination.
    await database.clearDeliveryFailures({ inbox: inboxes[0] })
    expect(
      (await db.selectFrom('delivery_inbox_failures').select('inbox').execute())
        .map((row) => row.inbox)
        .sort()
    ).toEqual(inboxes.slice(1).sort())
    await database.clearDeliveryFailuresForDomain({
      domain: ' REMOTE.EXAMPLE '
    })
    expect(
      await db
        .selectFrom('delivery_inbox_failures')
        .select(['inbox', 'domain'])
        .execute()
    ).toEqual([{ inbox: inboxes[3], domain: 'other.example' }])
  })
})
