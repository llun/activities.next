import { type Cid, parseCid } from '@atproto/lex-data'
import { lexToJson } from '@atproto/lex-json'
import {
  type CarBlock,
  CidSet,
  cborToLexRecord,
  concatBytesAsync,
  def,
  getRecords,
  nodeDataDef,
  writeCarStream
} from '@atproto/repo'
import {
  AtUri,
  isValidDid,
  isValidHandle,
  isValidNsid,
  isValidRecordKey,
  normalizeHandle
} from '@atproto/syntax'

import { getPdsConfig } from '@/lib/config/blueskyPds'
import type { PdsRepo, PdsRepoStatus } from '@/lib/database/domains/pds/types'
import type { Database } from '@/lib/database/types'
import { isAccountConfirmationPending } from '@/lib/services/guards/accountState'
import type { Actor } from '@/lib/types/domain/actor'
import { normalizeServedDomainChoice } from '@/lib/utils/host'

import {
  PdsBlocksNotFoundError,
  PdsDisabledError,
  PdsRepoNotFoundError,
  PdsRepoUnavailableError,
  PdsValidationError
} from './errors'
import { PdsReadOnlyRepoStorage } from './storage'

const INVALID_HANDLE = 'handle.invalid'
export const CAR_BLOCK_PAGE_SIZE = 100
export const CAR_BLOCK_PAGE_MAX_BYTES = 2 * 1024 * 1024
export const LIST_RECORDS_MAX_BYTES = 2 * 1024 * 1024
export const LIST_RECORDS_BLOCK_PAGE_SIZE = 25

const clampPositiveInt = (
  value: number | undefined,
  fallback: number
): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

export const resolveEffectivePdsRepoStatus = (
  repo: Pick<PdsRepo, 'status'>,
  actor: Pick<Actor, 'suspendedAt' | 'deletionStatus' | 'account'> | null
): PdsRepoStatus => {
  if (repo.status === 'deleted') {
    return 'deleted'
  }
  if (
    repo.status === 'takendown' ||
    actor?.suspendedAt != null ||
    actor?.account?.disabledAt != null
  ) {
    return 'takendown'
  }
  if (
    repo.status === 'deactivated' ||
    !actor ||
    !actor.account ||
    Boolean(actor.deletionStatus) ||
    actor.account.approvedAt == null ||
    isAccountConfirmationPending(actor.account)
  ) {
    return 'deactivated'
  }
  return 'active'
}

export const assertPdsDomainEnabled = (domain: string): string => {
  const normalizedDomain = normalizeServedDomainChoice(domain)
  const pdsConfig = getPdsConfig()
  const domainConfig = normalizedDomain
    ? pdsConfig?.[normalizedDomain]
    : undefined
  if (!normalizedDomain || !domainConfig?.enabled) {
    throw new PdsDisabledError(domain)
  }
  return normalizedDomain
}

const getAvailableRepoWithActor = async (
  database: Database,
  did: string,
  {
    allowUnavailable = false,
    requireEnabled = false,
    domain
  }: {
    allowUnavailable?: boolean
    requireEnabled?: boolean
    domain?: string
  } = {}
): Promise<{ repo: PdsRepo; actor: Actor | null }> => {
  const repo = await database.getPdsRepo({ did })
  if (!repo || (domain !== undefined && repo.domain !== domain)) {
    throw new PdsRepoNotFoundError(did)
  }
  if (requireEnabled) {
    assertPdsDomainEnabled(repo.domain)
  }
  const actor = await database.getActorFromId({ id: repo.actorId })
  const effectiveStatus = resolveEffectivePdsRepoStatus(repo, actor)
  if (!allowUnavailable && effectiveStatus !== 'active') {
    throw new PdsRepoUnavailableError(did, effectiveStatus)
  }
  return {
    repo:
      effectiveStatus === repo.status
        ? repo
        : { ...repo, status: effectiveStatus },
    actor
  }
}

const getAvailableRepo = async (
  database: Database,
  did: string,
  options: {
    allowUnavailable?: boolean
    requireEnabled?: boolean
    domain?: string
  } = {}
): Promise<PdsRepo> =>
  (await getAvailableRepoWithActor(database, did, options)).repo

/**
 * Resolves a DID or current `<username>.<domain>` handle to a PDS repo DID on
 * `domain`. Retired handles in `actor_handles` are never resolved: the actor's
 * current `username` and `domain` must match the requested handle.
 */
export const resolvePdsRepoDidForDomain = async (
  database: Database,
  { repo: repoIdentifier, domain }: { repo: string; domain: string }
): Promise<string> => {
  if (isValidDid(repoIdentifier)) {
    return repoIdentifier
  }

  if (!isValidHandle(repoIdentifier)) {
    throw new PdsRepoNotFoundError(repoIdentifier)
  }

  const normalized = normalizeHandle(repoIdentifier)
  const normalizedDomain = domain.toLowerCase()
  const suffix = `.${normalizedDomain}`
  if (!normalized.endsWith(suffix)) {
    throw new PdsRepoNotFoundError(repoIdentifier)
  }

  const username = normalized.slice(0, -suffix.length)
  if (!username || username.includes('.')) {
    throw new PdsRepoNotFoundError(repoIdentifier)
  }

  const actor = await database.getActorFromUsername({
    username,
    domain: normalizedDomain
  })
  if (
    !actor ||
    actor.username.toLowerCase() !== username ||
    actor.domain.toLowerCase() !== normalizedDomain
  ) {
    throw new PdsRepoNotFoundError(repoIdentifier)
  }

  const repo = await database.getPdsRepo({ actorId: actor.id })
  if (!repo || repo.domain !== normalizedDomain) {
    throw new PdsRepoNotFoundError(repoIdentifier)
  }

  return repo.did
}

export const assertPdsRepoAvailable = async (
  database: Database,
  {
    did,
    domain,
    allowUnavailable = false,
    requireEnabled = false
  }: {
    did: string
    domain?: string
    allowUnavailable?: boolean
    requireEnabled?: boolean
  }
): Promise<PdsRepo> =>
  getAvailableRepo(database, did, {
    allowUnavailable,
    requireEnabled,
    domain
  })

const iterateBlocksSince = async function* (
  database: Database,
  did: string,
  since: string,
  {
    pageSize = CAR_BLOCK_PAGE_SIZE,
    maxPageBytes = CAR_BLOCK_PAGE_MAX_BYTES
  }: { pageSize?: number; maxPageBytes?: number } = {}
): AsyncIterable<CarBlock> {
  const effectivePageSize = clampPositiveInt(pageSize, CAR_BLOCK_PAGE_SIZE)
  const effectiveMaxPageBytes = clampPositiveInt(
    maxPageBytes,
    CAR_BLOCK_PAGE_MAX_BYTES
  )
  let cursor: string | undefined
  do {
    const page = await database.listPdsBlocks({
      did,
      sinceRev: since,
      cursor,
      limit: effectivePageSize,
      maxBytes: effectiveMaxPageBytes
    })
    for (const block of page.blocks) {
      yield {
        cid: parseCid(block.cid),
        bytes: block.bytes
      }
    }
    cursor = page.cursor
  } while (cursor)
}

const fetchAndYieldLeafBatch = async function* (
  database: Database,
  storage: PdsReadOnlyRepoStorage,
  did: string,
  leafCids: Cid[],
  maxPageBytes: number
): AsyncIterable<CarBlock> {
  if (leafCids.length === 0) return

  const sizeRows = await database.getPdsBlockSizes({
    did,
    cids: leafCids.map((cid) => cid.toString())
  })
  const sizeByCid = new Map(
    sizeRows.map((row) => [row.cid, Number(row.byteLength)])
  )

  const missing: string[] = []
  for (const cid of leafCids) {
    const cidStr = cid.toString()
    if (!sizeByCid.has(cidStr)) {
      missing.push(cidStr)
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing MST leaf blocks for ${did}: ${missing.length}`)
  }

  // Partition into sub-batches whose combined byte length fits within
  // `maxPageBytes` (always admitting at least one block so large records still
  // make progress).
  let subBatch: Cid[] = []
  let subBatchBytes = 0

  const flushSubBatch = async function* (): AsyncIterable<CarBlock> {
    if (subBatch.length === 0) return
    const got = await storage.getBlocks(subBatch)
    if (got.missing.length > 0) {
      throw new Error(
        `Missing MST leaf blocks for ${did}: ${got.missing.length}`
      )
    }
    for (const block of got.blocks.entries()) {
      yield { cid: block.cid, bytes: block.bytes }
    }
    subBatch = []
    subBatchBytes = 0
  }

  for (const cid of leafCids) {
    const blockBytes = sizeByCid.get(cid.toString()) ?? 0
    if (subBatch.length > 0 && subBatchBytes + blockBytes > maxPageBytes) {
      yield* flushSubBatch()
    }
    subBatch.push(cid)
    subBatchBytes += blockBytes
  }
  yield* flushSubBatch()
}

/**
 * Streams a full repository CAR without holding the whole repo in memory:
 * uses a non-caching read-only blockstore, walks the MST iteratively with an
 * explicit O(depth) stack (checking visited MST CIDs against cycles), and
 * fetches record leaf blocks in batches bounded by both block count and byte
 * size.
 */
const iterateFullRepoBlocks = async function* (
  database: Database,
  did: string,
  rootCid: Cid,
  {
    pageSize = CAR_BLOCK_PAGE_SIZE,
    maxPageBytes = CAR_BLOCK_PAGE_MAX_BYTES
  }: { pageSize?: number; maxPageBytes?: number } = {}
): AsyncIterable<CarBlock> {
  const effectivePageSize = clampPositiveInt(pageSize, CAR_BLOCK_PAGE_SIZE)
  const effectiveMaxPageBytes = clampPositiveInt(
    maxPageBytes,
    CAR_BLOCK_PAGE_MAX_BYTES
  )
  const storage = new PdsReadOnlyRepoStorage(database, did)
  const commit = await storage.readObjAndBytes(rootCid, def.commit)
  yield { cid: rootCid, bytes: commit.bytes }

  const seenMst = new CidSet()
  const seenLeaves = new CidSet()
  const stack: Cid[] = [commit.obj.data]
  seenMst.markVisited(commit.obj.data)

  let pendingLeaves: Cid[] = []

  while (stack.length > 0) {
    const mstCid = stack.pop()!
    const node = await storage.readObjAndBytes(mstCid, nodeDataDef)
    yield { cid: mstCid, bytes: node.bytes }

    const childMstCids: Cid[] = []
    if (node.obj.l) {
      seenMst.markVisited(node.obj.l)
      childMstCids.push(node.obj.l)
    }
    for (const entry of node.obj.e) {
      if (!seenLeaves.has(entry.v)) {
        seenLeaves.add(entry.v)
        pendingLeaves.push(entry.v)
      }
      if (entry.t) {
        seenMst.markVisited(entry.t)
        childMstCids.push(entry.t)
      }
    }

    for (let i = childMstCids.length - 1; i >= 0; i -= 1) {
      stack.push(childMstCids[i])
    }

    while (pendingLeaves.length >= effectivePageSize) {
      const batch = pendingLeaves.splice(0, effectivePageSize)
      yield* fetchAndYieldLeafBatch(
        database,
        storage,
        did,
        batch,
        effectiveMaxPageBytes
      )
    }
  }

  if (pendingLeaves.length > 0) {
    yield* fetchAndYieldLeafBatch(
      database,
      storage,
      did,
      pendingLeaves,
      effectiveMaxPageBytes
    )
  }
}

export const getPdsRepoCarStream = async (
  database: Database,
  {
    did,
    since,
    domain,
    allowUnavailable = false,
    pageSize = CAR_BLOCK_PAGE_SIZE,
    maxPageBytes = CAR_BLOCK_PAGE_MAX_BYTES
  }: {
    did: string
    since?: string
    domain?: string
    allowUnavailable?: boolean
    pageSize?: number
    maxPageBytes?: number
  }
): Promise<AsyncIterable<Uint8Array>> => {
  const repo = await getAvailableRepo(database, did, {
    allowUnavailable,
    domain
  })
  if (!repo.rootCid) {
    throw new PdsRepoNotFoundError(did)
  }
  const rootCid = parseCid(repo.rootCid)
  if (since) {
    return writeCarStream(
      rootCid,
      iterateBlocksSince(database, did, since, { pageSize, maxPageBytes })
    )
  }
  return writeCarStream(
    rootCid,
    iterateFullRepoBlocks(database, did, rootCid, { pageSize, maxPageBytes })
  )
}

export const getPdsRepoCar = async (
  database: Database,
  params: {
    did: string
    since?: string
    domain?: string
    allowUnavailable?: boolean
    pageSize?: number
    maxPageBytes?: number
  }
): Promise<Uint8Array> =>
  concatBytesAsync(await getPdsRepoCarStream(database, params))

export const getPdsBlocksCarStream = async (
  database: Database,
  {
    did,
    cids,
    domain,
    allowUnavailable = false,
    maxPageBytes = CAR_BLOCK_PAGE_MAX_BYTES
  }: {
    did: string
    cids: string[]
    domain?: string
    allowUnavailable?: boolean
    maxPageBytes?: number
  }
): Promise<AsyncIterable<Uint8Array>> => {
  await getAvailableRepo(database, did, { allowUnavailable, domain })
  const seen = new Set<string>()
  const uniqueCids: Cid[] = []
  for (const raw of cids) {
    let parsed: Cid
    try {
      parsed = parseCid(raw)
    } catch (error) {
      throw new PdsValidationError(`Invalid CID: ${raw}`, 'InvalidRequest', {
        cause: error
      })
    }
    const key = parsed.toString()
    if (!seen.has(key)) {
      seen.add(key)
      uniqueCids.push(parsed)
    }
  }

  const sizeRows = await database.getPdsBlockSizes({
    did,
    cids: uniqueCids.map((cid) => cid.toString())
  })
  const sizeByCid = new Map(
    sizeRows.map((row) => [row.cid, Number(row.byteLength)])
  )

  const missing: string[] = []
  for (const cid of uniqueCids) {
    const cidStr = cid.toString()
    if (!sizeByCid.has(cidStr)) {
      missing.push(cidStr)
    }
  }
  if (missing.length > 0) {
    throw new PdsBlocksNotFoundError(missing)
  }

  const effectiveMaxPageBytes = clampPositiveInt(
    maxPageBytes,
    CAR_BLOCK_PAGE_MAX_BYTES
  )

  // Partition into byte-bounded pages using pre-fetched block sizes so
  // `sync.getBlocks` streams without buffering every block in memory (and HEAD
  // requests close the lazy stream without reading any block bytes).
  const pages: Cid[][] = []
  let currentPage: Cid[] = []
  let currentPageBytes = 0
  for (const cid of uniqueCids) {
    const blockBytes = sizeByCid.get(cid.toString()) ?? 0
    if (
      currentPage.length > 0 &&
      currentPageBytes + blockBytes > effectiveMaxPageBytes
    ) {
      pages.push(currentPage)
      currentPage = []
      currentPageBytes = 0
    }
    currentPage.push(cid)
    currentPageBytes += blockBytes
  }
  if (currentPage.length > 0) {
    pages.push(currentPage)
  }

  const storage = new PdsReadOnlyRepoStorage(database, did)
  const iterateBlocks = async function* (): AsyncIterable<CarBlock> {
    for (const page of pages) {
      const got = await storage.getBlocks(page)
      if (got.missing.length > 0) {
        throw new PdsBlocksNotFoundError(
          got.missing.map((cid) => cid.toString())
        )
      }
      for (const block of got.blocks.entries()) {
        yield { cid: block.cid, bytes: block.bytes }
      }
    }
  }

  return writeCarStream(null, iterateBlocks())
}

export const getPdsBlocksCar = async (
  database: Database,
  params: {
    did: string
    cids: string[]
    domain?: string
    allowUnavailable?: boolean
    maxPageBytes?: number
  }
): Promise<Uint8Array> =>
  concatBytesAsync(await getPdsBlocksCarStream(database, params))

export const getPdsRecordProofCarStream = async (
  database: Database,
  {
    did,
    collection,
    rkey,
    domain,
    allowUnavailable = false
  }: {
    did: string
    collection: string
    rkey: string
    domain?: string
    allowUnavailable?: boolean
  }
): Promise<AsyncIterable<Uint8Array>> => {
  if (!isValidNsid(collection)) {
    throw new PdsValidationError(`Invalid collection NSID: ${collection}`)
  }
  if (!isValidRecordKey(rkey)) {
    throw new PdsValidationError(`Invalid record key: ${rkey}`)
  }
  const repo = await getAvailableRepo(database, did, {
    allowUnavailable,
    domain
  })
  if (!repo.rootCid) {
    throw new PdsRepoNotFoundError(did)
  }
  const storage = new PdsReadOnlyRepoStorage(database, did)
  return getRecords(storage, parseCid(repo.rootCid), [{ collection, rkey }])
}

export const getPdsRecordProofCar = async (
  database: Database,
  params: {
    did: string
    collection: string
    rkey: string
    domain?: string
    allowUnavailable?: boolean
  }
): Promise<Uint8Array> =>
  concatBytesAsync(await getPdsRecordProofCarStream(database, params))

export const getPdsLatestCommit = async (
  database: Database,
  {
    did,
    domain,
    allowUnavailable = false
  }: { did: string; domain?: string; allowUnavailable?: boolean }
): Promise<{ cid: string; rev: string }> => {
  const repo = await getAvailableRepo(database, did, {
    allowUnavailable,
    domain
  })
  if (!repo.rootCid || !repo.rev) {
    throw new PdsRepoNotFoundError(did)
  }
  return { cid: repo.rootCid, rev: repo.rev }
}

export type PdsRepoStatusView = {
  did: string
  active: boolean
  status?: Exclude<PdsRepoStatus, 'active'>
  rev?: string
}

export const getPdsRepoStatus = async (
  database: Database,
  { did, domain }: { did: string; domain?: string }
): Promise<PdsRepoStatusView> => {
  const repo = await getAvailableRepo(database, did, {
    allowUnavailable: true,
    domain
  })
  const active = repo.status === 'active'
  return {
    did: repo.did,
    active,
    ...(!active
      ? { status: repo.status as Exclude<PdsRepoStatus, 'active'> }
      : {}),
    ...(active && repo.rev ? { rev: repo.rev } : {})
  }
}

export type PdsRepoListItem = {
  did: string
  head: string
  rev: string
  active: boolean
  status?: Exclude<PdsRepoStatus, 'active'>
}

export const listPdsRepos = async (
  database: Database,
  params: { domain?: string; cursor?: string; limit?: number } = {}
): Promise<{ repos: PdsRepoListItem[]; cursor?: string }> => {
  const page = await database.listPdsRepos(params)
  const actors =
    page.repos.length > 0
      ? await database.getActorsFromIds({
          ids: page.repos.map((repo) => repo.actorId)
        })
      : []
  const actorById = new Map(actors.map((actor) => [actor.id, actor]))
  return {
    repos: page.repos.map((repo) => {
      const effectiveStatus = resolveEffectivePdsRepoStatus(
        repo,
        actorById.get(repo.actorId) ?? null
      )
      const active = effectiveStatus === 'active'
      return {
        did: repo.did,
        head: repo.rootCid ?? '',
        rev: repo.rev ?? '',
        active,
        ...(!active
          ? { status: effectiveStatus as Exclude<PdsRepoStatus, 'active'> }
          : {})
      }
    }),
    cursor: page.cursor
  }
}

export type PdsRepoDescription = {
  handle: string
  did: string
  didDoc: Record<string, unknown>
  collections: string[]
  handleIsCorrect: boolean
}

/**
 * Builds the `com.atproto.repo.describeRepo` view for a PDS repository.
 *
 * `collections` is bounded to at most 1,000 distinct collections (ordered
 * ascending) via `listPdsCollections`.
 */
export const describePdsRepo = async (
  database: Database,
  {
    did,
    domain,
    handle,
    didDoc
  }: {
    did: string
    domain?: string
    handle?: string
    didDoc?: Record<string, unknown>
  }
): Promise<PdsRepoDescription> => {
  const { repo, actor } = await getAvailableRepoWithActor(database, did, {
    domain
  })
  const collections = await database.listPdsCollections({ did })

  const candidateHandle =
    handle ?? (actor ? `${actor.username}.${repo.domain}` : undefined)
  const lowercasedHandle = candidateHandle?.toLowerCase()
  const validHandle =
    lowercasedHandle && isValidHandle(lowercasedHandle)
      ? lowercasedHandle
      : undefined
  const effectiveHandle = validHandle ?? INVALID_HANDLE

  let resolvedDidDoc = didDoc
  if (!resolvedDidDoc) {
    const publicKeyMultibase = repo.signingKeyDid.replace(/^did:key:/, '')
    const pdsDomainConfig = getPdsConfig()?.[repo.domain]
    resolvedDidDoc = {
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/multikey/v1'
      ],
      id: repo.did,
      ...(validHandle ? { alsoKnownAs: [`at://${validHandle}`] } : {}),
      verificationMethod: [
        {
          id: `${repo.did}#atproto`,
          type: 'Multikey',
          controller: repo.did,
          publicKeyMultibase
        }
      ],
      ...(pdsDomainConfig?.hostname
        ? {
            service: [
              {
                id: '#atproto_pds',
                type: 'AtprotoPersonalDataServer',
                serviceEndpoint: `https://${pdsDomainConfig.hostname}`
              }
            ]
          }
        : {})
    }
  }

  return {
    handle: effectiveHandle,
    did: repo.did,
    didDoc: resolvedDidDoc,
    collections,
    handleIsCorrect: Boolean(validHandle)
  }
}

export type PdsRecordValueView = {
  uri: string
  cid: string
  value: Record<string, unknown>
}

export const getPdsRecordValue = async (
  database: Database,
  {
    did,
    collection,
    rkey,
    cid,
    domain
  }: {
    did: string
    collection: string
    rkey: string
    cid?: string
    domain?: string
  }
): Promise<PdsRecordValueView | null> => {
  if (!isValidNsid(collection)) {
    throw new PdsValidationError(`Invalid collection NSID: ${collection}`)
  }
  if (!isValidRecordKey(rkey)) {
    throw new PdsValidationError(`Invalid record key: ${rkey}`)
  }

  await getAvailableRepo(database, did, { domain })

  const record = await database.getPdsRecord({ did, collection, rkey })
  if (!record) return null
  if (cid && record.cid !== cid) return null

  const blocks = await database.getPdsBlocks({ did, cids: [record.cid] })
  const block = blocks[0]
  if (!block) return null

  const value = lexToJson(cborToLexRecord(block.bytes)) as Record<
    string,
    unknown
  >
  return {
    uri: AtUri.make(did, collection, rkey).toString(),
    cid: record.cid,
    value
  }
}

export const listPdsRecordValues = async (
  database: Database,
  {
    did,
    collection,
    cursor,
    limit,
    reverse,
    domain,
    maxBytes = LIST_RECORDS_MAX_BYTES,
    blockPageSize = LIST_RECORDS_BLOCK_PAGE_SIZE
  }: {
    did: string
    collection: string
    cursor?: string
    limit?: number
    reverse?: boolean
    domain?: string
    maxBytes?: number
    blockPageSize?: number
  }
): Promise<{ records: PdsRecordValueView[]; cursor?: string }> => {
  if (!isValidNsid(collection)) {
    throw new PdsValidationError(`Invalid collection NSID: ${collection}`)
  }

  await getAvailableRepo(database, did, { domain })

  const page = await database.listPdsRecords({
    did,
    collection,
    cursor,
    limit,
    reverse
  })

  if (page.records.length === 0) {
    return { records: [], cursor: page.cursor }
  }

  const effectiveMaxBytes = clampPositiveInt(maxBytes, LIST_RECORDS_MAX_BYTES)
  const effectiveBlockPageSize = clampPositiveInt(
    blockPageSize,
    LIST_RECORDS_BLOCK_PAGE_SIZE
  )

  const sizeRows = await database.getPdsBlockSizes({
    did,
    cids: page.records.map((record) => record.cid)
  })
  const sizeByCid = new Map(
    sizeRows.map((row) => [row.cid, Number(row.byteLength)])
  )

  // Select the prefix of records whose block bytes fit within the byte budget
  // (always admitting at least the first present record so large records still
  // make forward progress).
  const selectedRecords: typeof page.records = []
  let plannedBytes = 0
  let stoppedEarly = false

  for (const record of page.records) {
    const blockBytes = sizeByCid.get(record.cid)
    if (blockBytes === undefined) continue
    if (
      selectedRecords.length > 0 &&
      plannedBytes + blockBytes > effectiveMaxBytes
    ) {
      stoppedEarly = true
      break
    }
    selectedRecords.push(record)
    plannedBytes += blockBytes
  }

  if (selectedRecords.length === 0) {
    return { records: [], cursor: page.cursor }
  }

  const records: PdsRecordValueView[] = []
  let returnedBytes = 0
  let lastReturnedRkey: string | undefined

  for (
    let offset = 0;
    offset < selectedRecords.length;
    offset += effectiveBlockPageSize
  ) {
    const chunk = selectedRecords.slice(offset, offset + effectiveBlockPageSize)
    const blocks = await database.getPdsBlocks({
      did,
      cids: chunk.map((record) => record.cid)
    })
    const blockByCid = new Map(blocks.map((block) => [block.cid, block.bytes]))

    let hitBudgetDuringDecode = false
    for (const record of chunk) {
      const bytes = blockByCid.get(record.cid)
      if (!bytes) continue
      if (
        records.length > 0 &&
        returnedBytes + bytes.byteLength > effectiveMaxBytes
      ) {
        stoppedEarly = true
        hitBudgetDuringDecode = true
        break
      }
      records.push({
        uri: AtUri.make(did, record.collection, record.rkey).toString(),
        cid: record.cid,
        value: lexToJson(cborToLexRecord(bytes)) as Record<string, unknown>
      })
      returnedBytes += bytes.byteLength
      lastReturnedRkey = record.rkey
    }
    if (hitBudgetDuringDecode) break
  }

  return {
    records,
    cursor: stoppedEarly
      ? (lastReturnedRkey ?? selectedRecords[selectedRecords.length - 1]?.rkey)
      : page.cursor
  }
}

export const listPdsBlobCids = async (
  database: Database,
  {
    did,
    since,
    cursor,
    limit,
    domain,
    allowUnavailable = false
  }: {
    did: string
    since?: string
    cursor?: string
    limit?: number
    domain?: string
    allowUnavailable?: boolean
  }
): Promise<{ cids: string[]; cursor?: string }> => {
  await getAvailableRepo(database, did, { allowUnavailable, domain })
  const page = await database.listPdsBlobs({ did, since, cursor, limit })
  return {
    cids: page.blobs.map((blob) => blob.cid),
    cursor: page.cursor
  }
}
