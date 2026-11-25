import type { Secp256k1Keypair } from '@atproto/crypto'
import { type Cid, parseCid } from '@atproto/lex-data'
import { Repo, WriteOpAction, formatDataKey } from '@atproto/repo'
import {
  AtUri,
  type NsidString,
  isValidDid,
  isValidNsid,
  isValidRecordKey
} from '@atproto/syntax'

import { getPdsConfig, isPdsAllowed } from '@/lib/config/blueskyPds'
import type {
  PdsCommitRecordWrite,
  PdsRepo
} from '@/lib/database/domains/pds/types'
import type { Database } from '@/lib/database/types'
import {
  isActorConfirmationPending,
  isActorModerationBlocked
} from '@/lib/services/guards/accountState'
import { normalizeServedDomainChoice } from '@/lib/utils/host'

import {
  type PdsBlobObjectStore,
  deletePdsBlobFilesBestEffort
} from './blobStorage'
import { MAX_PDS_DID_LENGTH, MAX_PDS_WRITES_PER_COMMIT } from './constants'
import {
  PdsInvalidSwapError,
  PdsNotAllowedError,
  PdsRecordConflictError,
  PdsRecordNotFoundError,
  PdsRepoNotFoundError,
  PdsValidationError
} from './errors'
import {
  type PdsCommitEventOp,
  formatPdsAccountEvent,
  formatPdsCommitEvent,
  formatPdsIdentityEvent
} from './events'
import {
  createPdsSigningKey,
  encryptPdsSigningKey,
  loadPdsSigningKey
} from './keys'
import { withPdsRepoLock } from './lock'
import {
  type PdsWriteInput,
  type PreparedPdsCreate,
  type PreparedPdsUpdate,
  type PreparedPdsWrite,
  preparePdsWrite,
  preparedWriteToRepoOp
} from './prepare'
import { assertPdsDomainEnabled, assertPdsRepoAvailable } from './reads'
import { PdsSqlRepoStorage } from './storage'

export type CreatePdsRepoInput = {
  did: string
  actorId: string
  domain: string
  handle?: string
  /** The signed genesis `did:plc` operation as JSON, stored for the next update. */
  plcOperation?: string
  /** Optional pre-generated signing keypair (e.g. for deterministic tests). */
  signingKey?: Secp256k1Keypair
}

export type CreatePdsRepoResult = {
  repo: PdsRepo
  commit: {
    cid: string
    rev: string
  }
  didKey: string
  eventSeqs: {
    identity: number
    account: number
    commit: number
  }
}

export type ApplyPdsWritesInput = {
  did: string
  writes: PdsWriteInput[]
  swapCommit?: string
}

export type ApplyPdsWriteResultItem =
  | { action: 'create'; uri: string; cid: string }
  | { action: 'update'; uri: string; cid: string }
  | { action: 'delete'; uri: string; cid?: undefined }

export type ApplyPdsWritesResult = {
  commit: {
    cid: string
    rev: string
  }
  results: ApplyPdsWriteResultItem[]
  seq: number
}

const parseOptionalCid = (
  value: string | undefined,
  label: string
): Cid | undefined => {
  if (value === undefined) return undefined
  try {
    return parseCid(value)
  } catch (error) {
    throw new PdsValidationError(
      `Invalid ${label} CID: ${value}`,
      'InvalidRequest',
      {
        cause: error
      }
    )
  }
}

const assertActiveRepoForWrite = async (
  database: Database,
  did: string
): Promise<PdsRepo> => {
  const repo = await assertPdsRepoAvailable(database, {
    did,
    requireEnabled: true
  })
  if (!repo.rootCid || !repo.rev) {
    throw new PdsRepoNotFoundError(did)
  }
  return repo
}

/**
 * Creates a new embedded PDS repository for a local actor.
 *
 * Refuses unless the actor's served domain has PDS enabled in `getPdsConfig()`,
 * the local actor's domain matches the PDS domain, and the actor/account passes
 * the domain's `isPdsAllowed` allowlist. Atomically persists `pds_repos`, the
 * initial empty commit + MST blocks, and the initial `#identity`, `#account`
 * (active), and `#commit` events.
 */
export const createPdsRepo = async (
  database: Database,
  { did, actorId, domain, handle, plcOperation, signingKey }: CreatePdsRepoInput
): Promise<CreatePdsRepoResult> => {
  const normalizedDomain = assertPdsDomainEnabled(domain)
  const pdsConfig = getPdsConfig()

  if (did.length > MAX_PDS_DID_LENGTH || !isValidDid(did)) {
    throw new PdsValidationError(`Invalid DID: ${did}`)
  }

  const actor = await database.getActorFromId({ id: actorId })
  if (!actor || !actor.account) {
    throw new PdsValidationError(`Local actor not found: ${actorId}`)
  }

  const actorDomain = normalizeServedDomainChoice(actor.domain)
  if (!actorDomain || actorDomain !== normalizedDomain) {
    throw new PdsValidationError(
      `Actor domain ${actor.domain} does not match PDS domain ${normalizedDomain}`
    )
  }

  if (
    isActorModerationBlocked(actor) ||
    isActorConfirmationPending(actor) ||
    actor.account.approvedAt == null ||
    Boolean(actor.deletionStatus) ||
    !isPdsAllowed({
      email: actor.account.email,
      actorUsernameAtDomain: `${actor.username}@${actorDomain}`,
      domain: normalizedDomain,
      config: pdsConfig
    })
  ) {
    throw new PdsNotAllowedError(actorId)
  }

  const keypair = signingKey ?? (await createPdsSigningKey())
  const signingKeyDid = keypair.did()
  const encryptedSigningKey = await encryptPdsSigningKey(keypair, did)

  const storage = new PdsSqlRepoStorage(database, did)
  const initCommit = await Repo.formatInitCommit(storage, did, keypair, [])

  const now = new Date()
  const time = now.toISOString()

  const identityPayload = formatPdsIdentityEvent({ did, handle, time })
  const accountPayload = formatPdsAccountEvent({ did, active: true, time })
  const commitPayload = await formatPdsCommitEvent({
    did,
    commitData: initCommit,
    ops: [],
    prevData: null,
    time
  })

  const blocks = Array.from(initCommit.newBlocks.entries()).map(
    ({ cid, bytes }) => ({
      cid: cid.toString(),
      bytes
    })
  )

  const { repo, events } = await database.initializePdsRepo({
    did,
    actorId,
    domain: normalizedDomain,
    signingKey: encryptedSigningKey,
    signingKeyDid,
    rootCid: initCommit.cid.toString(),
    rev: initCommit.rev,
    status: 'active',
    handle: handle ?? null,
    plcOperation: plcOperation ?? null,
    blocks,
    events: [
      { type: 'identity', payload: identityPayload, createdAt: now },
      { type: 'account', payload: accountPayload, createdAt: now },
      { type: 'commit', payload: commitPayload, createdAt: now }
    ]
  })

  return {
    repo,
    commit: {
      cid: initCommit.cid.toString(),
      rev: initCommit.rev
    },
    didKey: signingKeyDid,
    eventSeqs: {
      identity: events[0].seq,
      account: events[1].seq,
      commit: events[2].seq
    }
  }
}

const commitPreparedWritesLocked = async (
  database: Database,
  {
    did,
    preparedWrites,
    swapCommitCid,
    blobStore
  }: {
    did: string
    preparedWrites: PreparedPdsWrite[]
    swapCommitCid?: Cid
    blobStore?: PdsBlobObjectStore
  }
): Promise<ApplyPdsWritesResult> => {
  const repoRow = await assertActiveRepoForWrite(database, did)
  const currentRootCid = parseCid(repoRow.rootCid as string)
  const currentRev = repoRow.rev as string

  if (swapCommitCid && !currentRootCid.equals(swapCommitCid)) {
    throw new PdsInvalidSwapError(
      `Commit was at ${currentRootCid.toString()}`,
      currentRootCid.toString()
    )
  }

  const storage = new PdsSqlRepoStorage(database, did)
  await storage.cacheRev(currentRev)

  const newRecordCids: Cid[] = []
  const commitOps: PdsCommitEventOp[] = []
  const recordWrites: PdsCommitRecordWrite[] = []
  const results: ApplyPdsWriteResultItem[] = []

  for (const write of preparedWrites) {
    const existing = await database.getPdsRecord({
      did,
      collection: write.collection,
      rkey: write.rkey
    })
    const existingCid = existing ? parseCid(existing.cid) : null
    const path = formatDataKey(write.collection, write.rkey)

    if (write.action === WriteOpAction.Create) {
      if (existingCid) {
        throw new PdsRecordConflictError(write.uri)
      }
      newRecordCids.push(write.cid)
      commitOps.push({
        action: 'create',
        path,
        cid: write.cid
      })
      recordWrites.push({
        action: 'create',
        collection: write.collection,
        rkey: write.rkey,
        cid: write.cid.toString(),
        recordUri: write.uri,
        blobCids: write.blobCids
      })
      results.push({
        action: 'create',
        uri: write.uri,
        cid: write.cid.toString()
      })
    } else if (write.action === WriteOpAction.Update) {
      if (!existingCid) {
        throw new PdsRecordNotFoundError(write.uri)
      }
      newRecordCids.push(write.cid)
      commitOps.push({
        action: 'update',
        path,
        cid: write.cid,
        prev: existingCid
      })
      recordWrites.push({
        action: 'update',
        collection: write.collection,
        rkey: write.rkey,
        cid: write.cid.toString(),
        recordUri: write.uri,
        blobCids: write.blobCids
      })
      results.push({
        action: 'update',
        uri: write.uri,
        cid: write.cid.toString()
      })
    } else {
      if (!existingCid) {
        throw new PdsRecordNotFoundError(write.uri)
      }
      commitOps.push({
        action: 'delete',
        path,
        cid: null,
        prev: existingCid
      })
      recordWrites.push({
        action: 'delete',
        collection: write.collection,
        rkey: write.rkey,
        recordUri: write.uri
      })
      results.push({
        action: 'delete',
        uri: write.uri
      })
    }
  }

  const encryptedSigningKey = await database.getPdsRepoSigningKey({ did })
  if (!encryptedSigningKey) {
    throw new PdsRepoNotFoundError(did)
  }
  const signingKey = await loadPdsSigningKey({
    did,
    signingKey: encryptedSigningKey
  })
  const repo = await Repo.load(storage, currentRootCid)
  const prevData = repo.commit.data
  const repoOps = preparedWrites.map(preparedWriteToRepoOp)
  const commit = await repo.formatCommit(repoOps, signingKey)

  // Mirror reference PDS: include any newly referenced record blocks that were
  // already in storage (e.g. identical record content at a different path).
  const newRecordBlocks = commit.relevantBlocks.getMany(newRecordCids)
  if (newRecordBlocks.missing.length > 0) {
    const missingBlocks = await storage.getBlocks(newRecordBlocks.missing)
    commit.relevantBlocks.addMap(missingBlocks.blocks)
  }

  const now = new Date()
  const eventPayload = await formatPdsCommitEvent({
    did,
    commitData: commit,
    ops: commitOps,
    prevData,
    time: now.toISOString()
  })

  const blocks = Array.from(commit.newBlocks.entries()).map(
    ({ cid, bytes }) => ({
      cid: cid.toString(),
      bytes
    })
  )
  const removedBlockCids = commit.removedCids
    .toList()
    .map((cid) => cid.toString())

  const commitResult = await database.commitPdsRepoWrite({
    did,
    rootCid: commit.cid.toString(),
    rev: commit.rev,
    expectedRev: currentRev,
    blocks,
    removedBlockCids,
    recordWrites,
    event: {
      type: 'commit',
      payload: eventPayload,
      createdAt: now
    },
    indexedAt: now
  })

  if (!commitResult.committed || !commitResult.event) {
    throw new PdsInvalidSwapError(
      'Repository head changed concurrently',
      currentRootCid.toString()
    )
  }

  if (commitResult.deletedBlobStorageKeys.length > 0) {
    await deletePdsBlobFilesBestEffort(commitResult.deletedBlobStorageKeys, {
      store: blobStore,
      context: { did }
    })
  }

  return {
    commit: {
      cid: commit.cid.toString(),
      rev: commit.rev
    },
    results,
    seq: commitResult.event.seq
  }
}

/**
 * Applies a batch of create/update/delete writes to a PDS repository in a
 * single signed commit and database transaction, serialized per DID.
 */
export const applyPdsWrites = async (
  database: Database,
  { did, writes, swapCommit }: ApplyPdsWritesInput,
  options: { blobStore?: PdsBlobObjectStore } = {}
): Promise<ApplyPdsWritesResult> => {
  if (!isValidDid(did)) {
    throw new PdsValidationError(`Invalid DID: ${did}`)
  }
  if (writes.length === 0) {
    throw new PdsValidationError('At least one write is required')
  }
  if (writes.length > MAX_PDS_WRITES_PER_COMMIT) {
    throw new PdsValidationError(
      `Too many writes. Max: ${MAX_PDS_WRITES_PER_COMMIT}`
    )
  }

  const swapCommitCid = parseOptionalCid(swapCommit, 'swapCommit')
  const preparedWrites: PreparedPdsWrite[] = []
  const seenPaths = new Set<string>()
  for (const write of writes) {
    const prepared = await preparePdsWrite({ did, write })
    const path = formatDataKey(prepared.collection, prepared.rkey)
    if (seenPaths.has(path)) {
      throw new PdsValidationError(`Duplicate write target in commit: ${path}`)
    }
    seenPaths.add(path)
    preparedWrites.push(prepared)
  }

  return withPdsRepoLock(database, did, () =>
    commitPreparedWritesLocked(database, {
      did,
      preparedWrites,
      swapCommitCid,
      blobStore: options.blobStore
    })
  )
}

export const createPdsRecord = async (
  database: Database,
  {
    did,
    collection,
    rkey,
    record,
    swapCommit
  }: {
    did: string
    collection: string
    rkey?: string
    record: Record<string, unknown>
    swapCommit?: string
  },
  options: { blobStore?: PdsBlobObjectStore } = {}
): Promise<{
  uri: string
  cid: string
  commit: { cid: string; rev: string }
  seq: number
}> => {
  const result = await applyPdsWrites(
    database,
    {
      did,
      writes: [{ action: 'create', collection, rkey, record }],
      swapCommit
    },
    options
  )
  const first = result.results[0] as Extract<
    ApplyPdsWriteResultItem,
    { action: 'create' }
  >
  return {
    uri: first.uri,
    cid: first.cid,
    commit: result.commit,
    seq: result.seq
  }
}

export const putPdsRecord = async (
  database: Database,
  {
    did,
    collection,
    rkey,
    record,
    swapCommit
  }: {
    did: string
    collection: string
    rkey: string
    record: Record<string, unknown>
    swapCommit?: string
  },
  options: { blobStore?: PdsBlobObjectStore } = {}
): Promise<{
  uri: string
  cid: string
  commit: { cid: string; rev: string } | null
  seq: number | null
}> => {
  if (!isValidDid(did)) {
    throw new PdsValidationError(`Invalid DID: ${did}`)
  }
  const swapCommitCid = parseOptionalCid(swapCommit, 'swapCommit')

  // Validate collection, rkey, and record payload up front before taking the lock.
  const preparedTemplate = (await preparePdsWrite({
    did,
    write: { action: 'update', collection, rkey, record }
  })) as PreparedPdsUpdate

  return withPdsRepoLock(database, did, async () => {
    const repoRow = await assertActiveRepoForWrite(database, did)
    const currentRootCid = parseCid(repoRow.rootCid as string)
    if (swapCommitCid && !currentRootCid.equals(swapCommitCid)) {
      throw new PdsInvalidSwapError(
        `Commit was at ${currentRootCid.toString()}`,
        currentRootCid.toString()
      )
    }

    const existing = await database.getPdsRecord({ did, collection, rkey })
    if (existing && existing.cid === preparedTemplate.cid.toString()) {
      return {
        uri: preparedTemplate.uri,
        cid: preparedTemplate.cid.toString(),
        commit: null,
        seq: null
      }
    }

    const prepared: PreparedPdsCreate | PreparedPdsUpdate = existing
      ? preparedTemplate
      : {
          ...preparedTemplate,
          action: WriteOpAction.Create
        }

    const applied = await commitPreparedWritesLocked(database, {
      did,
      preparedWrites: [prepared],
      swapCommitCid,
      blobStore: options.blobStore
    })
    return {
      uri: prepared.uri,
      cid: prepared.cid.toString(),
      commit: applied.commit,
      seq: applied.seq
    }
  })
}

export const deletePdsRecord = async (
  database: Database,
  {
    did,
    collection,
    rkey,
    swapCommit
  }: {
    did: string
    collection: string
    rkey: string
    swapCommit?: string
  },
  options: { blobStore?: PdsBlobObjectStore } = {}
): Promise<{
  deleted: boolean
  commit: { cid: string; rev: string } | null
  seq: number | null
}> => {
  if (!isValidDid(did)) {
    throw new PdsValidationError(`Invalid DID: ${did}`)
  }
  if (!isValidNsid(collection)) {
    throw new PdsValidationError(`Invalid collection NSID: ${collection}`)
  }
  if (!isValidRecordKey(rkey)) {
    throw new PdsValidationError(`Invalid record key: ${rkey}`)
  }

  const swapCommitCid = parseOptionalCid(swapCommit, 'swapCommit')

  return withPdsRepoLock(database, did, async () => {
    const repoRow = await assertActiveRepoForWrite(database, did)
    const currentRootCid = parseCid(repoRow.rootCid as string)
    if (swapCommitCid && !currentRootCid.equals(swapCommitCid)) {
      throw new PdsInvalidSwapError(
        `Commit was at ${currentRootCid.toString()}`,
        currentRootCid.toString()
      )
    }

    const existing = await database.getPdsRecord({ did, collection, rkey })
    if (!existing) {
      return { deleted: false, commit: null, seq: null }
    }

    const prepared: PreparedPdsWrite = {
      action: WriteOpAction.Delete,
      collection: collection as NsidString,
      rkey,
      uri: AtUri.make(did, collection, rkey).toString()
    }
    const applied = await commitPreparedWritesLocked(database, {
      did,
      preparedWrites: [prepared],
      swapCommitCid,
      blobStore: options.blobStore
    })
    return {
      deleted: true,
      commit: applied.commit,
      seq: applied.seq
    }
  })
}
