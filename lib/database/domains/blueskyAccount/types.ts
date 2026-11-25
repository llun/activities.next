// A Bluesky account linked to an actor (lib/services/bluesky/), the encrypted
// session the atproto client keeps for it, and pending OAuth sign-ins. The
// session and state values are stored as given: the service encrypts them.

// `hosted`: the account is on this server's embedded PDS
// (lib/services/pds/accounts.ts), so it has no stored session.
export type BlueskyAuthType = 'oauth' | 'app_password' | 'hosted'

export interface BlueskyAccount {
  actorId: string
  did: string
  handle: string
  pdsUrl: string
  authType: BlueskyAuthType
  // The handle is the user's own domain, not one their PDS hands out, so it
  // needs a DNS record (or /.well-known/atproto-did) on that domain.
  domainHandle: boolean
  // The server host this actor answers /.well-known/atproto-did for.
  instanceHandle: string | null
  // The last Home sync that finished, and why the latest one failed.
  lastSyncedAt: number | null
  syncError: string | null
  // When Bluesky notifications were last polled/seen for this account.
  notificationsSeenAt: number | null
  // Whether new posts are cross-posted to Bluesky without asking each time.
  crosspostByDefault: boolean
  createdAt: number
  updatedAt: number
}

export type SaveBlueskyAccountParams = Omit<
  BlueskyAccount,
  | 'instanceHandle'
  | 'lastSyncedAt'
  | 'syncError'
  | 'notificationsSeenAt'
  | 'crosspostByDefault'
  | 'createdAt'
  | 'updatedAt'
> & {
  // Left out, a new row cross-posts by default and a relink keeps its choice.
  crosspostByDefault?: boolean
}

export interface BlueskyAccountDatabase {
  getBlueskyAccount(params: { actorId: string }): Promise<BlueskyAccount | null>
  getBlueskyAccountByDid(params: {
    did: string
  }): Promise<BlueskyAccount | null>
  /** Only a claim an active admin's actor holds. */
  getBlueskyAccountByInstanceHandle(params: {
    host: string
  }): Promise<BlueskyAccount | null>
  /**
   * Links the DID to the actor, replacing the actor's earlier link (and that
   * link's session, follows and interactions when it was another DID). Returns
   * `did_taken` without writing when another actor already holds the DID.
   */
  saveBlueskyAccount(
    params: SaveBlueskyAccountParams
  ): Promise<'saved' | 'did_taken'>
  /**
   * Whether the actor may hold `host` as a handle now: an active admin's actor
   * on that domain, neither disabled nor suspended.
   */
  isEligibleInstanceHandleHolder(params: {
    actorId: string
    host: string
  }): Promise<boolean>
  /**
   * Whether the actor may take `host` as a handle: an eligible holder, with no
   * other eligible holder's claim on it.
   */
  canHoldInstanceHandle(params: {
    actorId: string
    host: string
  }): Promise<boolean>
  updateBlueskyAccountIdentity(params: {
    actorId: string
    handle: string
    pdsUrl: string
    domainHandle: boolean
  }): Promise<void>
  updateBlueskyNotificationsSeenAt(params: {
    actorId: string
    seenAt: number | null
  }): Promise<void>
  updateBlueskyCrosspostDefault(params: {
    actorId: string
    crosspostByDefault: boolean
  }): Promise<void>
  /**
   * `false` when another active admin's actor already answers for `host`, or a
   * live hosted Bluesky account of an eligible holder holds it as its handle; a
   * claim whose holder lost that is freed first.
   */
  setBlueskyInstanceHandle(params: {
    actorId: string
    host: string | null
  }): Promise<boolean>
  /**
   * Actors whose linked account still has a stored session, or is hosted on
   * this server, leaving out ones that are suspended, being deleted, disabled
   * or unconfirmed.
   */
  listBlueskyAccountsToSync(): Promise<string[]>
  /**
   * Removes the link, its stored session, its follows and its interactions.
   * With `hostedDid`, only while the row is still the hosted account of that
   * DID, read in the same transaction: a row written meanwhile (a link, or a
   * new hosted account) stays. Answers whether a row was removed.
   */
  deleteBlueskyAccount(params: {
    actorId: string
    hostedDid?: string
  }): Promise<boolean>

  getBlueskySession(params: { did: string }): Promise<string | null>
  setBlueskySession(params: { did: string; session: string }): Promise<void>
  deleteBlueskySession(params: { did: string }): Promise<void>

  /** Returns null for a missing or expired state. */
  getBlueskyOAuthState(params: {
    key: string
    now?: number
  }): Promise<string | null>
  /** Also prunes expired states. */
  setBlueskyOAuthState(params: {
    key: string
    state: string
    expiresAt: number
    now?: number
  }): Promise<void>
  deleteBlueskyOAuthState(params: { key: string }): Promise<void>
}
