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

// The destination server's own account status, as
// `com.atproto.server.checkAccountStatus` answers it for a move in progress.
export interface HostedBlueskyMoveOutAccountStatus {
  activated: boolean
  validDid: boolean
  repoCommit: string | null
  repoRev: string | null
  repoBlocks: number
  indexedRecords: number
  privateStateValues: number
  expectedBlobs: number
  importedBlobs: number
}

// `GET /api/v1/bluesky/hosted/move`: the stored move's progress, or null when
// no move is in progress.
export interface HostedBlueskyMoveOutProgress {
  pdsUrl: string
  handle: string
  stage: 'started' | 'switched'
  importedRev: string | null
  localRev: string | null
  switchedAt: number | null
  status: HostedBlueskyMoveOutAccountStatus
}

export interface HostedBlueskyMoveOutState {
  progress: HostedBlueskyMoveOutProgress | null
  state: HostedBlueskyAccountState
}

export interface HostedBlueskyMoveOutStartResult {
  moveOut: HostedBlueskyMoveOutSummary
  state: HostedBlueskyAccountState
}

export interface HostedBlueskyMoveOutRepoResult {
  importedRev: string | null
  bytes: number
}

export interface HostedBlueskyMoveOutBlobFailure {
  cid: string
  reason: string
}

export interface HostedBlueskyMoveOutBlobsResult {
  copied: number
  failed: HostedBlueskyMoveOutBlobFailure[]
  cursor: string | null
  done: boolean
}

export interface HostedBlueskyMoveOutPreferencesResult {
  count: number
}

export interface HostedBlueskyMoveOutFinishResult {
  movedTo: string
  handle: string
  state: HostedBlueskyAccountState
}

export interface HostedBlueskyMoveOutCancelResult {
  cancelled: true
  pdsUrl: string
  handle: string
  remoteAccountRemains: true
  message: string
  state: HostedBlueskyAccountState
}
