// The optional product features a domain can turn off (step 5 of the
// multi-domain plan). Dependency-free (no runtime imports beyond this file):
// the database layer, the admin API and client components all import it.
//
// A domain can only turn off what the server has on: the effective switch on
// a domain is the server switch (Admin › Server settings) AND the domain not listing
// the feature in its `disabledFeatures`. Like the server switches, it hides
// the navigation entries and the bootstrap flags; the routes keep working.

export const DOMAIN_FEATURES = ['fitness', 'explore', 'messages'] as const

export type DomainFeature = (typeof DOMAIN_FEATURES)[number]

export type FeatureFlags = Record<DomainFeature, boolean>

export const isDomainFeature = (value: unknown): value is DomainFeature =>
  typeof value === 'string' &&
  (DOMAIN_FEATURES as readonly string[]).includes(value)

/**
 * The stored `domains.disabledFeatures` text as a list of known features, in
 * the registry's order and without duplicates. Anything unreadable is "none":
 * a feature switch only hides navigation, so a bad value fails open.
 */
export const parseDisabledFeatures = (
  value: string | null | undefined
): DomainFeature[] => {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return DOMAIN_FEATURES.filter((feature) => parsed.includes(feature))
  } catch {
    return []
  }
}

/** The effective switches: the server's, minus what the domain turned off. */
export const applyDisabledFeatures = (
  server: FeatureFlags,
  disabled: readonly DomainFeature[]
): FeatureFlags => ({
  fitness: server.fitness && !disabled.includes('fitness'),
  explore: server.explore && !disabled.includes('explore'),
  messages: server.messages && !disabled.includes('messages')
})
