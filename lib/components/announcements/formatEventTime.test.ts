import { formatEventTime } from './formatEventTime'

describe('formatEventTime', () => {
  it('collapses a same-day range to one date, 24 h times and the zone', () => {
    expect(
      formatEventTime({
        startsAt: '2026-06-13T09:00:00.000Z',
        endsAt: '2026-06-13T10:00:00.000Z',
        allDay: false,
        timeZone: 'UTC'
      })
    ).toBe('Sat Jun 13, 09:00 – 10:00 UTC')
  })

  it('shows both dates for a range across days, with one zone label', () => {
    expect(
      formatEventTime({
        startsAt: '2026-10-01T09:00:00.000Z',
        endsAt: '2026-10-12T10:00:00.000Z',
        allDay: false,
        timeZone: 'UTC'
      })
    ).toBe('Thu Oct 1, 09:00 – Mon Oct 12, 10:00 UTC')
  })

  it('shows only the start when the event has no end', () => {
    expect(
      formatEventTime({
        startsAt: '2026-06-13T09:00:00.000Z',
        endsAt: null,
        allDay: false,
        timeZone: 'UTC'
      })
    ).toBe('Sat Jun 13, 09:00 UTC')
  })

  it('uses a 24 hour clock, so the afternoon reads 15:30 and midnight 00:00', () => {
    expect(
      formatEventTime({
        startsAt: '2026-06-13T00:00:00.000Z',
        endsAt: '2026-06-13T15:30:00.000Z',
        allDay: false,
        timeZone: 'UTC'
      })
    ).toBe('Sat Jun 13, 00:00 – 15:30 UTC')
  })

  it("renders in the reader's zone and names it", () => {
    expect(
      formatEventTime({
        startsAt: '2026-06-13T09:00:00.000Z',
        endsAt: '2026-06-13T10:00:00.000Z',
        allDay: false,
        timeZone: 'America/Los_Angeles'
      })
    ).toBe('Sat Jun 13, 02:00 – 03:00 PDT')
    expect(
      formatEventTime({
        startsAt: '2026-06-13T09:00:00.000Z',
        endsAt: '2026-06-13T10:00:00.000Z',
        allDay: false,
        timeZone: 'Asia/Bangkok'
      })
    ).toBe('Sat Jun 13, 16:00 – 17:00 GMT+7')
  })

  it('judges "same day" in the rendering zone, not in UTC', () => {
    // 20:00–22:00 UTC is 03:00–05:00 the next day in Bangkok: still one day.
    expect(
      formatEventTime({
        startsAt: '2026-06-12T20:00:00.000Z',
        endsAt: '2026-06-12T22:00:00.000Z',
        allDay: false,
        timeZone: 'Asia/Bangkok'
      })
    ).toBe('Sat Jun 13, 03:00 – 05:00 GMT+7')
    // 22:00 UTC and 02:00 UTC next day are different days in UTC, but the same
    // evening in Los Angeles.
    expect(
      formatEventTime({
        startsAt: '2026-06-13T22:00:00.000Z',
        endsAt: '2026-06-14T02:00:00.000Z',
        allDay: false,
        timeZone: 'America/Los_Angeles'
      })
    ).toBe('Sat Jun 13, 15:00 – 19:00 PDT')
  })

  it('names each bound when a daylight-saving change falls between them', () => {
    expect(
      formatEventTime({
        startsAt: '2026-03-07T20:00:00.000Z',
        endsAt: '2026-03-08T20:00:00.000Z',
        allDay: false,
        timeZone: 'America/New_York'
      })
    ).toBe('Sat Mar 7, 15:00 EST – Sun Mar 8, 16:00 EDT')
  })

  it('renders an all-day event as dates only, in UTC, with no clock or zone', () => {
    expect(
      formatEventTime({
        startsAt: '2026-06-13T00:00:00.000Z',
        endsAt: '2026-06-15T00:00:00.000Z',
        allDay: true,
        // The zone is ignored for all-day events: the stored instant is a
        // calendar date, which must not shift west of UTC.
        timeZone: 'America/Los_Angeles'
      })
    ).toBe('Sat Jun 13 – Mon Jun 15')
  })

  it('shows a one-day all-day event once', () => {
    expect(
      formatEventTime({
        startsAt: '2026-06-13T00:00:00.000Z',
        endsAt: '2026-06-13T00:00:00.000Z',
        allDay: true
      })
    ).toBe('Sat Jun 13')
  })

  it('returns null without a usable start', () => {
    expect(
      formatEventTime({ startsAt: null, endsAt: null, allDay: false })
    ).toBeNull()
    expect(
      formatEventTime({ startsAt: 'not a date', endsAt: null, allDay: false })
    ).toBeNull()
  })

  it('ignores an unparseable end', () => {
    expect(
      formatEventTime({
        startsAt: '2026-06-13T09:00:00.000Z',
        endsAt: 'garbage',
        allDay: false,
        timeZone: 'UTC'
      })
    ).toBe('Sat Jun 13, 09:00 UTC')
  })
})
