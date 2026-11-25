export type PdsRepoStatus = 'active' | 'deactivated' | 'takendown' | 'deleted'

export type PdsEventType = 'commit' | 'sync' | 'identity' | 'account'

export interface PdsRepo {
  did: string
  actorId: string
  domain: string
  signingKeyDid: string
  rootCid: string | null
  rev: string | null
  status: PdsRepoStatus
  /** The account's current atproto handle, or null while it has none. */
  handle: string | null
  /** The `did:key` added as the first rotation key, or null. */
  recoveryKeyDid: string | null
  /** The latest signed `did:plc` operation as JSON, or null. */
  plcOperation: string | null
  createdAt: number
  updatedAt: number
}

export interface PdsBlock {
  did: string
  cid: string
  bytes: Buffer
  repoRev: string
  createdAt: number
}

export interface PdsRecord {
  did: string
  collection: string
  rkey: string
  cid: string
  repoRev: string
  indexedAt: number
}

export interface PdsEvent {
  seq: number
  did: string
  type: PdsEventType
  payload: Buffer
  createdAt: number
}

export interface PdsBlob {
  did: string
  cid: string
  mimeType: string
  size: number
  storageKey: string
  createdAt: number
}

export type CreatePdsRepoParams = {
  did: string
  actorId: string
  domain: string
  signingKey: string
  signingKeyDid: string
  rootCid?: string | null
  rev?: string | null
  status?: PdsRepoStatus
  /** The account's atproto handle, or null while it has none. */
  handle?: string | null
  /** The latest signed `did:plc` operation as JSON, or null. */
  plcOperation?: string | null
}

export type GetPdsRepoParams =
  { did: string; actorId?: never } | { actorId: string; did?: never }

export type GetPdsRepoByHandleParams = {
  handle: string
  /** The served domain the repo belongs to; any domain when omitted. */
  domain?: string
}

export type UpdatePdsRepoIdentityParams = {
  did: string
  /** Omitted leaves the stored handle unchanged; `null` clears it. */
  handle?: string | null
  /** Omitted leaves the stored recovery key unchanged; `null` clears it. */
  recoveryKeyDid?: string | null
  /** Omitted leaves the stored PLC operation unchanged; `null` clears it. */
  plcOperation?: string | null
}

/** A per-DID JSON array of preferences for the app features on a hosted account. */
export type PdsPreferences = unknown[]

export type GetPdsPreferencesParams = {
  did: string
}

export type PutPdsPreferencesParams = {
  did: string
  preferences: PdsPreferences
}

export type ListPdsReposParams = {
  domain?: string
  cursor?: string
  limit?: number
}

/** Tombstone rows (`status = 'deleted'`) last touched before `before`. */
export type ListDeletedPdsReposBeforeParams = {
  before: Date | number
  limit?: number
}

export type UpdatePdsRepoHeadParams = {
  did: string
  rootCid: string
  rev: string
  expectedRev: string | null
}

export type PutPdsBlocksParams = {
  did: string
  blocks: Array<{
    cid: string
    bytes: Uint8Array
    repoRev: string
  }>
}

export type ListPdsBlocksParams = {
  did: string
  sinceRev?: string
  cursor?: string
  limit?: number
  maxBytes?: number
}

export type UpsertPdsRecordParams = {
  did: string
  collection: string
  rkey: string
  cid: string
  repoRev: string
  indexedAt?: Date | number
}

export type ListPdsRecordsParams = {
  did: string
  collection: string
  cursor?: string
  limit?: number
  reverse?: boolean
}

export type AppendPdsEventParams = {
  did: string
  type: PdsEventType
  payload: Uint8Array
  createdAt?: Date | number
}

export type ListPdsEventsParams = {
  afterSeq?: number
  limit?: number
  maxBytes?: number
  did?: string
  domain?: string
  activeReposOnly?: boolean
}

export type PdsEventSeqBounds = {
  oldest: number | null
  newest: number | null
}

export type CreatePdsBlobParams = {
  did: string
  cid: string
  mimeType: string
  size: number
  storageKey: string
  createdAt?: Date | number
}

export type ListPdsBlobsParams = {
  did: string
  since?: string
  cursor?: string
  limit?: number
}

export type PdsCommitRecordWrite =
  | {
      action: 'create' | 'update'
      collection: string
      rkey: string
      cid: string
      recordUri?: string
      blobCids?: string[]
    }
  | {
      action: 'delete'
      collection: string
      rkey: string
      recordUri?: string
    }

export type CommitPdsRepoWriteParams = {
  did: string
  rootCid: string
  rev: string
  expectedRev: string | null
  blocks: Array<{
    cid: string
    bytes: Uint8Array
  }>
  removedBlockCids?: string[]
  recordWrites: PdsCommitRecordWrite[]
  event?: {
    type: PdsEventType
    payload: Uint8Array
    createdAt?: Date | number
  }
  indexedAt?: Date | number
}

export type CommitPdsRepoWriteResult =
  | {
      committed: true
      event: PdsEvent | null
      deletedBlobStorageKeys: string[]
    }
  | {
      committed: false
      event: null
      deletedBlobStorageKeys: []
    }

export type InitializePdsRepoParams = {
  did: string
  actorId: string
  domain: string
  signingKey: string
  signingKeyDid: string
  rootCid: string
  rev: string
  status?: PdsRepoStatus
  handle?: string | null
  plcOperation?: string | null
  blocks: Array<{
    cid: string
    bytes: Uint8Array
  }>
  events: Array<{
    type: PdsEventType
    payload: Uint8Array
    createdAt?: Date | number
  }>
}

export type InitializePdsRepoResult = {
  repo: PdsRepo
  events: PdsEvent[]
}

export interface PdsDatabase {
  createPdsRepo(params: CreatePdsRepoParams): Promise<PdsRepo>
  getPdsRepo(params: GetPdsRepoParams): Promise<PdsRepo | null>
  getPdsRepoByHandle(params: GetPdsRepoByHandleParams): Promise<PdsRepo | null>
  getPdsRepoSigningKey(params: { did: string }): Promise<string | null>
  listPdsRepos(
    params?: ListPdsReposParams
  ): Promise<{ repos: PdsRepo[]; cursor?: string }>
  listDeletedPdsReposBefore(
    params: ListDeletedPdsReposBeforeParams
  ): Promise<string[]>
  updatePdsRepoHead(params: UpdatePdsRepoHeadParams): Promise<boolean>
  updatePdsRepoIdentity(params: UpdatePdsRepoIdentityParams): Promise<boolean>
  updatePdsRepoStatus(params: {
    did: string
    status: PdsRepoStatus
  }): Promise<boolean>

  getPdsPreferences(
    params: GetPdsPreferencesParams
  ): Promise<PdsPreferences | null>
  putPdsPreferences(params: PutPdsPreferencesParams): Promise<PdsPreferences>

  putPdsBlocks(params: PutPdsBlocksParams): Promise<void>
  getPdsBlocks(params: { did: string; cids: string[] }): Promise<PdsBlock[]>
  getPdsBlockSizes(params: {
    did: string
    cids: string[]
  }): Promise<Array<{ cid: string; byteLength: number }>>
  getPdsBlocksByRev(params: {
    did: string
    repoRev?: string
    sinceRev?: string
  }): Promise<PdsBlock[]>
  listPdsBlocks(
    params: ListPdsBlocksParams
  ): Promise<{ blocks: PdsBlock[]; cursor?: string }>

  upsertPdsRecord(params: UpsertPdsRecordParams): Promise<PdsRecord>
  deletePdsRecord(params: {
    did: string
    collection: string
    rkey: string
  }): Promise<boolean>
  getPdsRecord(params: {
    did: string
    collection: string
    rkey: string
  }): Promise<PdsRecord | null>
  listPdsRecords(
    params: ListPdsRecordsParams
  ): Promise<{ records: PdsRecord[]; cursor?: string }>
  listPdsCollections(params: { did: string; limit?: number }): Promise<string[]>

  appendPdsEvent(params: AppendPdsEventParams): Promise<PdsEvent>
  listPdsEvents(params?: ListPdsEventsParams): Promise<PdsEvent[]>
  getPdsEventSeqBounds(): Promise<PdsEventSeqBounds>
  deletePdsEventsBefore(params: { before: Date | number }): Promise<number>

  createPdsBlob(params: CreatePdsBlobParams): Promise<PdsBlob>
  getPdsBlob(params: {
    did: string
    cid: string
    includeUnreferenced?: boolean
  }): Promise<PdsBlob | null>
  listPdsBlobs(
    params: ListPdsBlobsParams
  ): Promise<{ blobs: PdsBlob[]; cursor?: string }>
  listPdsBlobStorageKeys(params: { did: string }): Promise<string[]>
  deletePdsBlob(params: {
    did: string
    cid: string
    storageKey?: string
  }): Promise<boolean>

  putPdsRecordBlobs(params: {
    did: string
    recordUri: string
    blobCids: string[]
  }): Promise<void>
  deletePdsRecordBlobs(params: {
    did: string
    recordUri: string
  }): Promise<void>
  getPdsRecordBlobs(params: {
    did: string
    recordUri: string
  }): Promise<string[]>
  countPdsBlobReferences(params: {
    did: string
    blobCid: string
  }): Promise<number>

  initializePdsRepo(
    params: InitializePdsRepoParams
  ): Promise<InitializePdsRepoResult>
  commitPdsRepoWrite(
    params: CommitPdsRepoWriteParams
  ): Promise<CommitPdsRepoWriteResult>
  deletePdsRepoData(params: {
    did: string
  }): Promise<{ blobStorageKeys: string[] }>
  deletePdsRepoContent(params: {
    did: string
  }): Promise<{ blobStorageKeys: string[] }>
}
