import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns'

export const getISOTimeUTC = (timestamp: number, onlyDate: boolean = false) => {
  if (onlyDate) {
    return format(new UTCDate(timestamp), 'yyyy-MM-dd')
  }
  return format(new UTCDate(timestamp), `yyyy-MM-dd'T'HH:mm:ss'Z'`)
}

// Timestamp formatter for Mastodon REST API entities. Unlike ActivityPub
// `published` (which omits fractional seconds), Mastodon always emits
// millisecond precision (e.g. `2021-09-03T21:00:00.000Z`). The official
// Mastodon iOS decoder rejects full datetimes WITHOUT fractional seconds, which
// makes a required `Date` field (e.g. account/status `created_at`) fail to
// decode and blanks the entire entity. Use this for Mastodon datetime fields;
// keep `getISOTimeUTC` for ActivityPub.
export const getMastodonTimeUTC = (timestamp: number) =>
  format(new UTCDate(timestamp), `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`)
