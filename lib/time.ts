import formatInTimeZone from 'date-fns-tz/formatInTimeZone'

export const getISOTimeUTC = (timestamp: number) =>
  formatInTimeZone(timestamp, 'GMT+0', "yyyy-MM-dd'T'HH:mm:ss'Z'")
