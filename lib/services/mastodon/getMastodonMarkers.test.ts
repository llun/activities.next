import { MarkerRow } from '@/lib/types/database/operations'

import { getMastodonMarkers } from './getMastodonMarkers'

describe('getMastodonMarkers', () => {
  it('serializes rows keyed by timeline with ISO updated_at', () => {
    const updatedAt = Date.parse('2026-05-30T12:00:00.000Z')
    const rows: MarkerRow[] = [
      {
        actorId: 'a',
        timeline: 'home',
        lastReadId: '100',
        version: 2,
        updatedAt
      }
    ]
    expect(getMastodonMarkers(rows)).toEqual({
      home: {
        last_read_id: '100',
        version: 2,
        updated_at: '2026-05-30T12:00:00.000Z'
      }
    })
  })

  it('returns an empty object for no rows', () => {
    expect(getMastodonMarkers([])).toEqual({})
  })
})
