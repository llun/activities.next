import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns'

// Single UTC datetime formatter used for both ActivityPub `published` and REST
// API datetime fields. It always emits millisecond precision (e.g.
// `2021-09-03T21:00:00.000Z`) for Mastodon compatibility: the official Mastodon
// iOS decoder rejects full datetimes WITHOUT fractional seconds, which makes a
// required `Date` field (e.g. account/status `created_at`) fail to decode and
// blanks the entire entity. ActivityPub `published` also accepts fractional
// seconds, so a single format works everywhere.
export const getISOTimeUTC = (timestamp: number, onlyDate: boolean = false) => {
  if (onlyDate) {
    return format(new UTCDate(timestamp), 'yyyy-MM-dd')
  }
  return format(new UTCDate(timestamp), `yyyy-MM-dd'T'HH:mm:ss.SSS'Z'`)
}
