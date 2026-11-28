// The per-domain "Who can host a Bluesky account" setting, shared by the
// database types, the admin API and the page. Dependency-free: client modules
// import it.
export const BLUESKY_HOSTING_POLICIES = [
  'nobody',
  'listed',
  'everyone'
] as const

export type BlueskyHostingPolicy = (typeof BLUESKY_HOSTING_POLICIES)[number]
