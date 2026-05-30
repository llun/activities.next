import { MarkerRow } from '@/lib/types/database/operations'
import { Markers } from '@/lib/types/mastodon'

export const getMastodonMarkers = (rows: MarkerRow[]): Markers => {
  const markers: Markers = {}
  for (const row of rows) {
    markers[row.timeline] = {
      last_read_id: row.lastReadId,
      version: row.version,
      updated_at: new Date(row.updatedAt).toISOString()
    }
  }
  return markers
}
