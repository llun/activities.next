import { UTCDate } from '@date-fns/utc'
import { format } from 'date-fns/format'
import { useMemo } from 'react'

import { useHasHydrated } from '@/lib/hooks/useHasHydrated'

/**
 * Returns a formatter for a message timestamp. The server knows neither the
 * reader's locale nor their time zone, so until `useHasHydrated` turns true the
 * server render and the hydrating one both print `pattern` (a date-fns pattern,
 * en-US) in UTC. date-fns is used there because it prints the same text in every
 * engine, where `Intl` output varies with the engine's ICU (Safari renders
 * "Oct 4 at 3:05 PM" for what Node renders "Oct 4, 3:05 PM"). After hydration
 * `options` take over in the reader's own locale and zone.
 *
 * The formatter is built once per component and rebuilt only when hydration
 * flips, not on every render. It is not cached across components, since that
 * would pin the zone at first use. Pass a module-level `options` so it stays
 * stable.
 */
export const useMessageTimeFormat = (
  pattern: string,
  options: Intl.DateTimeFormatOptions
): ((timestamp: number) => string) => {
  const hasHydrated = useHasHydrated()
  return useMemo(() => {
    if (!hasHydrated) {
      return (timestamp: number) => format(new UTCDate(timestamp), pattern)
    }
    const formatter = new Intl.DateTimeFormat(undefined, options)
    return (timestamp: number) => formatter.format(timestamp)
  }, [hasHydrated, pattern, options])
}
