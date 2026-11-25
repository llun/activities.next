// Client-safe shape of a profile's hosted Bluesky account, as Settings ›
// Bluesky shows it. Built by lib/services/pds/accounts.ts.

export type HostedBlueskyRepoStatus =
  'active' | 'deactivated' | 'takendown' | 'deleted'

export interface HostedBlueskyHandleChoice {
  handle: string
  // instance: the bare served domain, offered to an admin's profile that may
  // hold it; pds: <username>.<PDS host>.
  kind: 'instance' | 'pds'
}

export interface HostedBlueskyRepoSummary {
  did: string
  handle: string | null
  status: HostedBlueskyRepoStatus
  recoveryKeyDid: string | null
}

export interface HostedBlueskyMoveOutSummary {
  pdsUrl: string
  handle: string
  stage: 'started' | 'switched'
}

export interface HostedBlueskyAccountState {
  // Whether the Settings card should show at all: the domain's PDS is on, the
  // actor is allowed, and the account is confirmed, approved and not blocked.
  available: boolean
  // The PDS hostname (with port) the account lives on, or null when the
  // actor's domain has no PDS.
  pdsHostname: string | null
  // Whether ACTIVITIES_BLUESKY_PDS_ROTATION_KEY is set and valid.
  rotationKeyConfigured: boolean
  // The hosted repo, or null when the profile has none (or only a tombstone).
  repo: HostedBlueskyRepoSummary | null
  // The handles a new account may take. A custom domain handle is only
  // accepted when changing an existing account's handle.
  handleChoices: HostedBlueskyHandleChoice[]
  customHandleAllowed: boolean
  // The destination PDS hostname when this repo's PLC operation points away
  // from this server, or null while it is hosted here.
  movedTo: string | null
  // Summary of an in-progress move to another PDS, or null when none.
  moveOut: HostedBlueskyMoveOutSummary | null
}
