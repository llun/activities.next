/**
 * Formats a message timestamp. The server knows neither the reader's locale
 * nor their time zone, so until `hasHydrated` (from `useHasHydrated`) is true
 * the server render and the hydrating one both print en-US in UTC; after that
 * the reader's own locale and zone take over.
 */
export const formatMessageTime = (
  timestamp: number,
  options: Intl.DateTimeFormatOptions,
  hasHydrated: boolean
): string =>
  (hasHydrated
    ? new Intl.DateTimeFormat(undefined, options)
    : new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' })
  ).format(timestamp)
