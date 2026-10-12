// The hour key of a `bucket:<type>:<YYYYMMDDHH>` counter. The bucket writes
// and reads are in lib/database/kysely/counterBucket.ts.

/** Format a Date to the compact hour key used in bucket counter ids: 'YYYYMMDDHH' */
export const formatBucketHour = (date: Date): string => {
  const y = date.getUTCFullYear()
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  return `${y}${mo}${d}${h}`
}

/** Truncate a Date to the start of its UTC hour */
export const truncateToHour = (date: Date): Date => {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours()
    )
  )
}
