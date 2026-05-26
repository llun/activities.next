const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/

export const getCompatibleTime = (time: number | Date | string): number => {
  if (typeof time === 'number') return time
  if (typeof time === 'string') {
    const trimmed = time.trim()
    const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed
    return new Date(normalized).getTime()
  }
  return time.getTime()
}
