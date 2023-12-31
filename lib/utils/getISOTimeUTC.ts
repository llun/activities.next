import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns'

export const getISOTimeUTC = (timestamp: number) =>
  format(new UTCDate(timestamp), `yyyy-MM-dd'T'HH:mm:ss'Z'`)
