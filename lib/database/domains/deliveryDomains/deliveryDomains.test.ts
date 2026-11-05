import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  DELIVERY_FAILURE_DAYS_THRESHOLD,
  MAX_DELIVERY_LAST_ERROR_LENGTH
} from '@/lib/database/domains/deliveryDomains/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

describe('deliveryDomains database domain', () => {
  const { database, db, prepare, destroy } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await db.deleteFrom('delivery_domain_failures').execute()
  })

  it('records the first failure, ignores same-day repeats, and truncates lastError', async () => {
    const t1 = Date.parse('2026-11-01T08:00:00.000Z')
    const t2 = Date.parse('2026-11-01T23:59:59.000Z')
    const longError = 'x'.repeat(MAX_DELIVERY_LAST_ERROR_LENGTH + 80)

    const firstMarked = await database.recordDeliveryFailure({
      domain: '  Remote.Example ',
      error: 'HTTP 503',
      now: t1
    })
    expect(firstMarked).toBe(false)
    expect(
      await database.isDomainUnavailable({ domain: 'remote.example' })
    ).toBe(false)

    const secondMarked = await database.recordDeliveryFailure({
      domain: 'REMOTE.EXAMPLE',
      error: longError,
      now: t2
    })
    expect(secondMarked).toBe(false)

    const row = await db
      .selectFrom('delivery_domain_failures')
      .selectAll()
      .where('domain', '=', 'remote.example')
      .executeTakeFirstOrThrow()

    expect(row.failureDays).toBe(1)
    expect(row.lastFailureDay).toBe('2026-11-01')
    expect(Number(row.firstFailureAt)).toBe(t1)
    expect(Number(row.lastFailureAt)).toBe(t2)
    expect(row.unavailableSince).toBeNull()
    expect(row.lastError).toBe('x'.repeat(MAX_DELIVERY_LAST_ERROR_LENGTH))
  })

  it('marks the domain unavailable on the 7th distinct UTC day and returns true only once', async () => {
    for (let day = 1; day < DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      const now = Date.parse(`2026-11-0${day}T12:00:00.000Z`)
      const marked = await database.recordDeliveryFailure({
        domain: 'failing.example',
        error: 'HTTP 502',
        now
      })
      expect(marked).toBe(false)
      expect(
        await database.isDomainUnavailable({ domain: 'failing.example' })
      ).toBe(false)
    }

    const seventhDay = Date.parse('2026-11-07T12:00:00.000Z')
    const markedOnSeventh = await database.recordDeliveryFailure({
      domain: 'failing.example',
      error: 'ETIMEDOUT',
      now: seventhDay
    })
    expect(markedOnSeventh).toBe(true)
    expect(
      await database.isDomainUnavailable({ domain: 'failing.example' })
    ).toBe(true)
    expect(
      await database.isDomainUnavailable({ domain: 'FAILING.EXAMPLE' })
    ).toBe(true)

    const eighthDay = Date.parse('2026-11-08T12:00:00.000Z')
    const markedOnEighth = await database.recordDeliveryFailure({
      domain: 'failing.example',
      error: 'ETIMEDOUT',
      now: eighthDay
    })
    expect(markedOnEighth).toBe(false)

    const row = await db
      .selectFrom('delivery_domain_failures')
      .selectAll()
      .where('domain', '=', 'failing.example')
      .executeTakeFirstOrThrow()

    expect(row.failureDays).toBe(8)
    expect(Number(row.unavailableSince)).toBe(seventhDay)
  })

  it('clears failures so a recovered domain starts counting from day 1 again', async () => {
    for (let day = 1; day <= DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        domain: 'recovered.example',
        error: 'HTTP 503',
        now: Date.parse(`2026-11-0${day}T10:00:00.000Z`)
      })
    }
    expect(
      await database.isDomainUnavailable({ domain: 'recovered.example' })
    ).toBe(true)

    await database.clearDeliveryFailures({ domain: 'RECOVERED.EXAMPLE' })

    expect(
      await database.isDomainUnavailable({ domain: 'recovered.example' })
    ).toBe(false)

    const markedAfterClear = await database.recordDeliveryFailure({
      domain: 'recovered.example',
      error: 'HTTP 503',
      now: Date.parse('2026-11-10T10:00:00.000Z')
    })
    expect(markedAfterClear).toBe(false)

    const row = await db
      .selectFrom('delivery_domain_failures')
      .select(['failureDays', 'unavailableSince'])
      .where('domain', '=', 'recovered.example')
      .executeTakeFirstOrThrow()
    expect(row.failureDays).toBe(1)
    expect(row.unavailableSince).toBeNull()
  })

  it('returns only unavailable domains in getUnavailableDomains', async () => {
    for (let day = 1; day <= DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        domain: 'dead-one.example',
        error: 'HTTP 504',
        now: Date.parse(`2026-11-0${day}T04:00:00.000Z`)
      })
      await database.recordDeliveryFailure({
        domain: 'dead-two.example',
        error: 'ECONNREFUSED',
        now: Date.parse(`2026-11-0${day}T04:00:00.000Z`)
      })
    }

    await database.recordDeliveryFailure({
      domain: 'flaky.example',
      error: 'HTTP 503',
      now: Date.parse('2026-11-01T04:00:00.000Z')
    })

    expect(await database.getUnavailableDomains({ domains: [] })).toEqual([])

    const unavailable = await database.getUnavailableDomains({
      domains: [
        'DEAD-ONE.example',
        'dead-one.example',
        'flaky.example',
        'healthy.example',
        'dead-two.example'
      ]
    })

    expect(unavailable.sort()).toEqual(['dead-one.example', 'dead-two.example'])
  })

  it('serializes concurrent failures on the threshold day so only one call marks unavailable', async () => {
    for (let day = 1; day < DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        domain: 'race.example',
        error: 'HTTP 503',
        now: Date.parse(`2026-11-0${day}T06:00:00.000Z`)
      })
    }

    const thresholdTime = Date.parse('2026-11-07T06:00:00.000Z')
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        database.recordDeliveryFailure({
          domain: 'race.example',
          error: 'HTTP 503',
          now: thresholdTime
        })
      )
    )

    expect(outcomes.filter(Boolean)).toHaveLength(1)

    const row = await db
      .selectFrom('delivery_domain_failures')
      .select(['failureDays', 'unavailableSince'])
      .where('domain', '=', 'race.example')
      .executeTakeFirstOrThrow()
    expect(row.failureDays).toBe(DELIVERY_FAILURE_DAYS_THRESHOLD)
    expect(Number(row.unavailableSince)).toBe(thresholdTime)
  })
})
