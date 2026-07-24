'use client'

import { FC, ReactNode, createContext, useContext, useMemo } from 'react'

import { DEFAULT_MAX_STATUS_CHARACTERS } from '@/lib/services/mastodon/constants'

/**
 * The client-visible slice of the resolved server settings (see
 * `lib/services/serverSettings`, resolved env -> database -> default).
 *
 * A Server Component reads the resolved values once — the `(timeline)` layout
 * publishes them here — so authoring UI deep in the tree can size itself to the
 * instance's configured limits without every intermediate component threading a
 * prop. Keep this to values the browser genuinely needs; it is not a mirror of
 * `ResolvedServerSettings`.
 *
 * These values drive UX only. The limits stay enforced server-side on the
 * status create/edit routes (`validateStatusContentLimits`), so a missing or
 * stale provider can never let an over-long status through.
 */
export interface InstanceLimits {
  /** Resolved `posts.maxCharacters` — the composer's character budget. */
  maxStatusCharacters: number
}

export const DEFAULT_INSTANCE_LIMITS: InstanceLimits = {
  maxStatusCharacters: DEFAULT_MAX_STATUS_CHARACTERS
}

// Rendering without a provider yields the defaults, so a consumer is never left
// without a limit and the composer keeps working on any surface that is not
// wrapped.
const InstanceLimitsContext = createContext<InstanceLimits>(
  DEFAULT_INSTANCE_LIMITS
)

// The value crosses the server/client boundary, so treat anything that is not a
// positive integer as "not configured" and fall back to the default rather than
// rendering a NaN or negative counter.
const positiveIntegerOr = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback

interface ProviderProps {
  maxStatusCharacters?: number
  children: ReactNode
}

export const InstanceLimitsProvider: FC<ProviderProps> = ({
  maxStatusCharacters,
  children
}) => {
  // Memoized so the context reference is stable across unrelated re-renders of
  // the layout, which would otherwise re-render every consumer.
  const value = useMemo<InstanceLimits>(
    () => ({
      maxStatusCharacters: positiveIntegerOr(
        maxStatusCharacters,
        DEFAULT_INSTANCE_LIMITS.maxStatusCharacters
      )
    }),
    [maxStatusCharacters]
  )

  return (
    <InstanceLimitsContext.Provider value={value}>
      {children}
    </InstanceLimitsContext.Provider>
  )
}

/** Reads the surrounding instance limits, or the defaults without a provider. */
export const useInstanceLimits = (): InstanceLimits =>
  useContext(InstanceLimitsContext)
