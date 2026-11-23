// A Bluesky account linked to an actor (lib/services/bluesky/), the encrypted
// session the atproto client keeps for it, and pending OAuth sign-ins. The
// session and state values are stored as given: the service encrypts them.

export type BlueskyAuthType = 'oauth' | 'app_password'

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
  createdAt: number
  updatedAt: number
}

export type SaveBlueskyAccountParams = Omit<
  BlueskyAccount,
  'instanceHandle' | 'createdAt' | 'updatedAt'
>

export interface BlueskyAccountDatabase {
  getBlueskyAccount(params: { actorId: string }): Promise<BlueskyAccount | null>
  getBlueskyAccountByDid(params: {
    did: string
  }): Promise<BlueskyAccount | null>
  getBlueskyAccountByInstanceHandle(params: {
    host: string
  }): Promise<BlueskyAccount | null>
  /**
   * Links the DID to the actor, replacing the actor's earlier link (and that
   * link's session when it was another DID). Returns `did_taken` without
   * writing when another actor already holds the DID.
   */
  saveBlueskyAccount(
    params: SaveBlueskyAccountParams
  ): Promise<'saved' | 'did_taken'>
  updateBlueskyAccountIdentity(params: {
    actorId: string
    handle: string
    pdsUrl: string
    domainHandle: boolean
  }): Promise<void>
  /** `false` when another actor already answers for `host`. */
  setBlueskyInstanceHandle(params: {
    actorId: string
    host: string | null
  }): Promise<boolean>
  /** Removes the link and its stored session. */
  deleteBlueskyAccount(params: { actorId: string }): Promise<void>

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
