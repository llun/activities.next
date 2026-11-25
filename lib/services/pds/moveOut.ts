import { parseDidKey } from '@atproto/crypto'
import { isValidDid, isValidHandle, normalizeHandle } from '@atproto/syntax'
import type { Readable } from 'node:stream'

import { getPdsConfig, toWebDid } from '@/lib/config/blueskyPds'
import type { Database } from '@/lib/database/types'
import { readXrpcError } from '@/lib/services/bluesky/agent'
import type { StoredBlueskyMoveOutSession } from '@/lib/services/bluesky/client'
import { writeStoredBlueskySession } from '@/lib/services/bluesky/client'
import { isActorModerationBlocked } from '@/lib/services/guards/accountState'
import type { Actor } from '@/lib/types/domain/actor'
import type {
  HostedBlueskyAccountState,
  HostedBlueskyMoveOutSummary
} from '@/lib/utils/blueskyHosted'
import { logger } from '@/lib/utils/logger'
import {
  SafeRemoteFetchError,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import {
  getHostedBlueskyAccountState,
  requireHostedRepo,
  requireRotationKeypair,
  writeLiveRepo
} from './accounts'
import type { PdsBlobObjectStore } from './blobStorage'
import { readPdsBlob } from './blobs'
import { resolveEffectivePdsRepoStatus } from './effectiveStatus'
import {
  PdsAccountMovedError,
  PdsHostedAccountInactiveError,
  PdsHostedAccountNotFoundError,
  PdsIdentityMovedError,
  PdsMoveOutInProgressError,
  PdsMoveOutInvalidCredentialsError,
  PdsMoveOutInvalidServerUrlError,
  PdsMoveOutNotCopiedError,
  PdsMoveOutNotFoundError,
  PdsMoveOutRemoteError,
  PdsMoveOutSwitchedError,
  PdsValidationError
} from './errors'
import { formatPdsAccountEvent, formatPdsIdentityEvent } from './events'
import { loadPdsSigningKey } from './keys'
import { withPdsRepoLock } from './lock'
import {
  DEFAULT_BLOB_BATCH_LIMIT,
  MAX_BLOB_BATCH_LIMIT,
  MOVE_LOCK_MS,
  MOVE_LOCK_WAIT_MS,
  MOVE_REFRESH_LOCK_MS,
  REMOTE_JSON_TIMEOUT_MS,
  REMOTE_JSON_WORST_MS,
  REMOTE_UPLOAD_TIMEOUT_MS,
  REMOTE_UPLOAD_WORST_MS,
  deleteMoveOutSession,
  readMoveOutSession,
  revokeMoveOutTokens,
  updateMoveOutSession
} from './moveSession'
import { getMovedToHost, isPlcOperationPointingTo } from './moved'
import {
  PLC_DIRECTORY_TIMEOUT_MS,
  type PlcSignedOperation,
  cidForOperation,
  createUpdateOperation,
  getLastPlcOperation,
  submitPlcOperation
} from './plc'
import { consumeHostedBlueskyRateLimit } from './rateLimit'
import { assertPdsDomainEnabled, getPdsRepoCar } from './reads'
import { createServiceAuthToken } from './serviceAuth'
import { XRPC_CAR_CONTENT_TYPE } from './xrpc'

// Server side of moving a hosted Bluesky account out to another PDS (D2.3d).
// An in-progress move is stored encrypted in `bluesky_sessions` under the
// account's DID (`type: 'move-out'`). Every request to the destination PDS
// uses `safeRemoteFetch` with `maxRedirects: 0`, and the new account's
// password is sent only to `com.atproto.server.createAccount` and never
// stored, logged, or echoed in errors.

// Finish stops starting new blob pages after this, so the request that just
// made the irreversible switch reaches activateAccount well within the usual
// request limits; what is left is reported as missing.
const FINISH_BLOB_BUDGET_MS = 60_000

// Covers the finish sequence's network calls: the PLC read and submit; the
// recommended credentials; the repo re-send; the blob budget plus the page in
// flight when it runs out; the remaining-blob count, preferences, activate and
// revoke; and one token refresh.
const FINISH_LOCK_MS =
  // Two PLC calls, each up to twice its timeout.
  4 * PLC_DIRECTORY_TIMEOUT_MS +
  REMOTE_JSON_WORST_MS +
  REMOTE_UPLOAD_WORST_MS +
  FINISH_BLOB_BUDGET_MS +
  REMOTE_JSON_WORST_MS +
  DEFAULT_BLOB_BATCH_LIMIT * REMOTE_UPLOAD_WORST_MS +
  5 * REMOTE_JSON_WORST_MS +
  30_000
const REMOTE_MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_BLOB_PAGES = 100
const MAX_PLC_ROTATION_KEYS = 5
const MAX_REMOTE_ERROR_CODE_LENGTH = 80
const MAX_REMOTE_ERROR_MESSAGE_LENGTH = 200
const MAX_CID_LENGTH = 200

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface StartMoveOutResult {
  moveOut: HostedBlueskyMoveOutSummary
  state: HostedBlueskyAccountState
}

export interface SendMoveOutRepoResult {
  importedRev: string | null
  bytes: number
}

export interface CopyMoveOutBlobFailure {
  cid: string
  reason: string
}

export interface CopyMoveOutBlobsResult {
  copied: number
  failed: CopyMoveOutBlobFailure[]
  cursor: string | null
  done: boolean
}

export interface CopyMoveOutPreferencesResult {
  count: number
}

export interface MoveOutAccountStatus {
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

export interface MoveOutProgress {
  pdsUrl: string
  handle: string
  stage: 'started' | 'switched'
  importedRev: string | null
  localRev: string | null
  switchedAt: number | null
  status: MoveOutAccountStatus
}

export interface FinishMoveOutResult {
  movedTo: string
  handle: string
  /** Blobs the post-switch copy could not send, so the owner knows. */
  missingBlobs: number
  state: HostedBlueskyAccountState
}

export interface CancelMoveOutResult {
  cancelled: true
  pdsUrl: string
  handle: string
  remoteAccountRemains: true
  message: string
  state: HostedBlueskyAccountState
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stripHostPort = (authority: string): string => {
  if (authority.startsWith('[')) {
    const match = authority.match(/^(\[[^\]]+\])(?::\d+)?$/)
    return match ? match[1] : authority
  }
  return authority.replace(/:\d+$/, '')
}

const sanitizeRemoteText = (
  value: string | undefined,
  maxLength: number,
  redact?: string
): string | null => {
  if (!value) return null
  let cleaned = value
  if (redact && redact.length > 0) {
    cleaned = cleaned.split(redact).join('[redacted]')
  }
  cleaned = cleaned
    // Strip ASCII/C1 control characters (including CR/LF/tabs) before surfacing.
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  return cleaned.slice(0, maxLength)
}

const normalizeDestinationPdsUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim()
  if (
    !trimmed ||
    trimmed.includes('@') ||
    trimmed.includes('?') ||
    trimmed.includes('#')
  ) {
    throw new PdsMoveOutInvalidServerUrlError()
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new PdsMoveOutInvalidServerUrlError()
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new PdsMoveOutInvalidServerUrlError()
  }

  const pdsConfig = getPdsConfig()
  if (pdsConfig) {
    const targetHost = parsed.hostname.toLowerCase()
    const isOwnPds = Object.values(pdsConfig).some(
      (entry) => stripHostPort(entry.hostname).toLowerCase() === targetHost
    )
    if (isOwnPds) {
      throw new PdsMoveOutInvalidServerUrlError(
        'Choose a different Bluesky server than this one.'
      )
    }
  }

  return parsed.origin
}

const toMoveSummary = (
  session: StoredBlueskyMoveOutSession
): HostedBlueskyMoveOutSummary => ({
  pdsUrl: session.pdsUrl,
  handle: session.handle,
  stage: session.switchedAt !== null ? 'switched' : 'started'
})

const buildRemoteError = (
  nsid: string,
  statusCode: number,
  body: string,
  redact?: string
): PdsMoveOutRemoteError => {
  const parsed = readXrpcError(body)
  const remoteError = sanitizeRemoteText(
    parsed.error,
    MAX_REMOTE_ERROR_CODE_LENGTH,
    redact
  )
  const remoteMessage = sanitizeRemoteText(
    parsed.message,
    MAX_REMOTE_ERROR_MESSAGE_LENGTH,
    redact
  )
  const detail = [remoteError, remoteMessage].filter(Boolean).join(': ')
  const message = detail
    ? `Destination server refused ${nsid} (${statusCode}): ${detail}`
    : `Destination server refused ${nsid} (${statusCode}).`
  return new PdsMoveOutRemoteError(
    message,
    statusCode,
    remoteError,
    remoteMessage
  )
}

const buildXrpcUrl = (
  origin: string,
  nsid: string,
  params?: Record<string, string | number | undefined>
): string => {
  const search = new URLSearchParams()
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) search.append(key, String(value))
    }
  }
  const query = search.toString()
  const url = new URL(`/xrpc/${nsid}${query ? `?${query}` : ''}`, origin)
  if (url.origin !== origin) {
    throw new PdsMoveOutInvalidServerUrlError()
  }
  return url.href
}

const fetchDestination = async ({
  origin,
  nsid,
  method,
  params,
  headers = {},
  body,
  bodyBytes,
  timeoutMs = REMOTE_JSON_TIMEOUT_MS
}: {
  origin: string
  nsid: string
  method: 'GET' | 'POST'
  params?: Record<string, string | number | undefined>
  headers?: Record<string, string>
  body?: string
  bodyBytes?: Uint8Array
  timeoutMs?: number
}): Promise<{ statusCode: number; body: string }> => {
  const url = buildXrpcUrl(origin, nsid, params)
  try {
    const result = await safeRemoteFetch({
      url,
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      ...(bodyBytes !== undefined ? { bodyBytes } : {}),
      maxRedirects: 0,
      allowCrossHostRedirects: false,
      maxBodyBytes: REMOTE_MAX_BODY_BYTES,
      timeoutInMilliseconds: timeoutMs
    })
    return { statusCode: result.statusCode, body: result.body }
  } catch (error) {
    if (error instanceof SafeRemoteFetchError) {
      if (
        error.code === 'ERR_TOO_MANY_REDIRECTS' ||
        error.code === 'ERR_CROSS_HOST_REDIRECT'
      ) {
        throw new PdsMoveOutRemoteError(
          'The destination server tried to redirect the request, which is not allowed.',
          0,
          null,
          null,
          { cause: error }
        )
      }
      if (error.code === 'ERR_UNSAFE_REMOTE_URL') {
        throw new PdsMoveOutRemoteError(
          'The destination server address is not allowed.',
          0,
          null,
          null,
          { cause: error }
        )
      }
    }
    throw new PdsMoveOutRemoteError(
      'Could not reach the destination server.',
      0,
      null,
      null,
      { cause: error }
    )
  }
}

const parseJsonBody = (nsid: string, body: string): unknown => {
  try {
    return JSON.parse(body)
  } catch {
    throw new PdsMoveOutRemoteError(
      `Destination server returned an invalid response for ${nsid}.`
    )
  }
}

const isExpiredTokenResponse = (response: {
  statusCode: number
  body: string
}): boolean =>
  (response.statusCode === 400 || response.statusCode === 401) &&
  readXrpcError(response.body).error === 'ExpiredToken'

const refreshMoveOutTokens = async (
  database: Database,
  did: string,
  staleAccessJwt: string
): Promise<StoredBlueskyMoveOutSession> =>
  withPdsRepoLock(
    database,
    `move-refresh:${did}`,
    async () => {
      const current = await readMoveOutSession(database, did)
      if (!current) throw new PdsMoveOutNotFoundError()
      if (current.accessJwt !== staleAccessJwt) return current

      const nsid = 'com.atproto.server.refreshSession'
      const response = await fetchDestination({
        origin: current.pdsUrl,
        nsid,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${current.refreshJwt}`
        }
      })
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw buildRemoteError(nsid, response.statusCode, response.body)
      }
      const parsed = parseJsonBody(nsid, response.body)
      if (
        !isRecord(parsed) ||
        typeof parsed.accessJwt !== 'string' ||
        !parsed.accessJwt ||
        typeof parsed.refreshJwt !== 'string' ||
        !parsed.refreshJwt ||
        (parsed.did !== undefined && parsed.did !== did)
      ) {
        throw new PdsMoveOutRemoteError(
          'Destination server returned invalid tokens when refreshing the move session.'
        )
      }
      // Write only if the row is still the move-out session this refresh used:
      // a cancel that landed meanwhile must not be undone.
      const latest = await readMoveOutSession(database, did)
      if (!latest) throw new PdsMoveOutNotFoundError()
      if (latest.refreshJwt !== current.refreshJwt) return latest
      const next: StoredBlueskyMoveOutSession = {
        ...latest,
        accessJwt: parsed.accessJwt,
        refreshJwt: parsed.refreshJwt
      }
      await writeStoredBlueskySession(database, did, next)
      return next
    },
    { ttlMs: MOVE_REFRESH_LOCK_MS, waitMs: MOVE_LOCK_WAIT_MS }
  )

const requestWithMoveAuth = async ({
  database,
  did,
  session,
  nsid,
  method,
  params,
  contentType,
  body,
  bodyBytes,
  timeoutMs
}: {
  database: Database
  did: string
  session: StoredBlueskyMoveOutSession
  nsid: string
  method: 'GET' | 'POST'
  params?: Record<string, string | number | undefined>
  contentType?: string
  body?: string
  bodyBytes?: Uint8Array
  timeoutMs?: number
}): Promise<{
  statusCode: number
  body: string
  session: StoredBlueskyMoveOutSession
}> => {
  const send = (activeSession: StoredBlueskyMoveOutSession) =>
    fetchDestination({
      origin: activeSession.pdsUrl,
      nsid,
      method,
      params,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${activeSession.accessJwt}`,
        ...(contentType ? { 'Content-Type': contentType } : {})
      },
      body,
      bodyBytes,
      timeoutMs
    })

  let activeSession = session
  let response = await send(activeSession)
  if (isExpiredTokenResponse(response)) {
    activeSession = await refreshMoveOutTokens(
      database,
      did,
      activeSession.accessJwt
    )
    response = await send(activeSession)
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw buildRemoteError(nsid, response.statusCode, response.body)
  }
  return {
    statusCode: response.statusCode,
    body: response.body,
    session: activeSession
  }
}

const readStreamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

const exportRepoCarSnapshot = async (
  database: Database,
  did: string,
  { allowUnavailable = false }: { allowUnavailable?: boolean } = {}
): Promise<{ rev: string | null; carBytes: Uint8Array }> =>
  withPdsRepoLock(database, did, async () => {
    const current = await database.getPdsRepo({ did })
    if (!current || current.status === 'deleted') {
      throw new PdsHostedAccountNotFoundError()
    }
    // Only the post-switch re-send may export a deactivated repo: the switch
    // deactivates it here before that send.
    const carBytes = await getPdsRepoCar(database, { did, allowUnavailable })
    return { rev: current.rev, carBytes }
  })

const uploadRepoCar = async (
  database: Database,
  did: string,
  session: StoredBlueskyMoveOutSession,
  { allowUnavailable = false }: { allowUnavailable?: boolean } = {}
): Promise<{
  importedRev: string | null
  bytes: number
  session: StoredBlueskyMoveOutSession
}> => {
  const { rev, carBytes } = await exportRepoCarSnapshot(database, did, {
    allowUnavailable
  })
  await requestWithMoveAuth({
    database,
    did,
    session,
    nsid: 'com.atproto.repo.importRepo',
    method: 'POST',
    contentType: XRPC_CAR_CONTENT_TYPE,
    bodyBytes: carBytes,
    timeoutMs: REMOTE_UPLOAD_TIMEOUT_MS
  })
  const persisted = await updateMoveOutSession(database, did, {
    importedRev: rev
  })
  return { importedRev: rev, bytes: carBytes.byteLength, session: persisted }
}

type ValidatedRecommendedCredentials = {
  pdsEndpoint: string
  signingKeyDid: string
  handle: string
  rotationKeys: string[]
}

const validateRecommendedDidCredentials = (
  raw: unknown,
  expectedPdsUrl: string,
  expectedHandle: string
): ValidatedRecommendedCredentials => {
  if (!isRecord(raw)) {
    throw new PdsMoveOutInvalidCredentialsError(
      'Destination server returned invalid recommended DID credentials.'
    )
  }

  // 1. services.atproto_pds.endpoint must match the stored pdsUrl origin.
  const services = raw.services
  const pdsService = isRecord(services) ? services.atproto_pds : null
  if (
    !isRecord(pdsService) ||
    pdsService.type !== 'AtprotoPersonalDataServer' ||
    typeof pdsService.endpoint !== 'string'
  ) {
    throw new PdsMoveOutInvalidCredentialsError(
      'Destination server credentials are missing a valid atproto_pds service.'
    )
  }
  let endpointUrl: URL
  try {
    endpointUrl = new URL(pdsService.endpoint)
  } catch {
    throw new PdsMoveOutInvalidCredentialsError(
      'Destination server credentials contain an invalid PDS endpoint URL.'
    )
  }
  if (
    endpointUrl.protocol !== 'https:' ||
    endpointUrl.username !== '' ||
    endpointUrl.password !== '' ||
    (endpointUrl.pathname !== '/' && endpointUrl.pathname !== '') ||
    endpointUrl.search !== '' ||
    endpointUrl.hash !== '' ||
    endpointUrl.origin !== expectedPdsUrl
  ) {
    throw new PdsMoveOutInvalidCredentialsError(
      'Destination server credentials point to a different PDS origin than requested.'
    )
  }

  // 2. verificationMethods.atproto must be a supported did:key.
  const verificationMethods = raw.verificationMethods
  const signingKeyDid = isRecord(verificationMethods)
    ? verificationMethods.atproto
    : null
  if (typeof signingKeyDid !== 'string') {
    throw new PdsMoveOutInvalidCredentialsError(
      'Destination server credentials are missing the atproto signing key.'
    )
  }
  try {
    parseDidKey(signingKeyDid)
  } catch {
    throw new PdsMoveOutInvalidCredentialsError(
      'Destination server credentials contain an invalid atproto signing key.'
    )
  }

  // 3. alsoKnownAs must be [`at://<handle>`].
  const alsoKnownAs = raw.alsoKnownAs
  const expectedAlias = `at://${expectedHandle.toLowerCase()}`
  if (
    !Array.isArray(alsoKnownAs) ||
    alsoKnownAs.length !== 1 ||
    typeof alsoKnownAs[0] !== 'string' ||
    alsoKnownAs[0].toLowerCase() !== expectedAlias
  ) {
    throw new PdsMoveOutInvalidCredentialsError(
      'Destination server credentials do not match the expected handle.'
    )
  }

  // 4. rotationKeys must be a non-empty list of valid did:keys.
  const rotationKeys = raw.rotationKeys
  if (!Array.isArray(rotationKeys) || rotationKeys.length === 0) {
    throw new PdsMoveOutInvalidCredentialsError(
      'Destination server credentials are missing rotation keys.'
    )
  }
  const validatedKeys: string[] = []
  for (const key of rotationKeys) {
    if (typeof key !== 'string') {
      throw new PdsMoveOutInvalidCredentialsError(
        'Destination server credentials contain an invalid rotation key.'
      )
    }
    try {
      parseDidKey(key)
    } catch {
      throw new PdsMoveOutInvalidCredentialsError(
        'Destination server credentials contain an invalid rotation key.'
      )
    }
    validatedKeys.push(key)
  }

  return {
    pdsEndpoint: endpointUrl.origin,
    signingKeyDid,
    handle: expectedHandle,
    rotationKeys: validatedKeys
  }
}

/**
 * The next rotation keys: the directory's last operation's keys except this
 * server's, in their order, then the destination's recommended keys, deduped
 * and capped. The owner's recovery key is whatever the directory already
 * lists first, so it stays first without being read from `pds_repos`.
 */
const buildNextRotationKeys = ({
  lastRotationKeys,
  recommendedRotationKeys,
  serverRotationKeyDid
}: {
  lastRotationKeys: string[]
  recommendedRotationKeys: string[]
  serverRotationKeyDid: string
}): string[] => {
  const result: string[] = []
  const seen = new Set<string>()
  const add = (key: string) => {
    if (key === serverRotationKeyDid || seen.has(key)) return
    seen.add(key)
    result.push(key)
  }
  for (const key of lastRotationKeys) add(key)
  for (const key of recommendedRotationKeys) add(key)
  if (result.length === 0) {
    throw new PdsMoveOutInvalidCredentialsError(
      'Destination server credentials did not provide a usable rotation key.'
    )
  }
  return result.slice(0, MAX_PLC_ROTATION_KEYS)
}

/**
 * The actor the caller passed may be stale by the time a step holds the lock:
 * a suspension or deletion that landed meanwhile must be seen, so every step
 * re-reads it and judges the repo's effective status against that.
 */
const requireFreshActor = async (
  database: Database,
  actor: Actor
): Promise<Actor> => {
  const fresh = await database.getActorFromId({ id: actor.id })
  if (!fresh) throw new PdsHostedAccountNotFoundError()
  return fresh
}

/**
 * Starts moving the actor's hosted Bluesky account to another PDS:
 * creates a deactivated account for the same DID on the destination PDS using
 * a short-lived ES256K service-auth JWT signed by the local repo key, and
 * stores the resulting move session encrypted in `bluesky_sessions`.
 */
export const startMoveOut = async ({
  database,
  actor,
  pdsUrl,
  handle,
  email,
  password,
  inviteCode
}: {
  database: Database
  actor: Actor
  pdsUrl: string
  handle: string
  email: string
  password: string
  inviteCode?: string
}): Promise<StartMoveOutResult> => {
  const normalizedPdsUrl = normalizeDestinationPdsUrl(pdsUrl)
  const normalizedHandle = normalizeHandle(handle.trim())
  if (!isValidHandle(normalizedHandle)) {
    throw new PdsValidationError(
      'Enter a valid handle for the new Bluesky server.'
    )
  }
  const normalizedEmail = email.trim()
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw new PdsValidationError('Enter a valid email address.')
  }
  if (!password) {
    throw new PdsValidationError('Enter a password for the new account.')
  }
  const normalizedInviteCode = inviteCode?.trim() || undefined

  // Ensure this server can sign the PLC update at the end of the move before
  // creating an account on the destination PDS.
  await requireRotationKeypair()

  const moveOut = await withPdsRepoLock(
    database,
    `actor:${actor.id}`,
    async () => {
      const currentActor = await requireFreshActor(database, actor)
      const repo = await requireHostedRepo(database, currentActor)
      if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()
      assertPdsDomainEnabled(repo.domain)
      const movedTo = getMovedToHost(repo)
      if (movedTo) throw new PdsAccountMovedError(movedTo)
      if (resolveEffectivePdsRepoStatus(repo, currentActor) !== 'active') {
        throw new PdsHostedAccountInactiveError(
          'Turn the Bluesky account on before moving it.'
        )
      }

      const existing = await readMoveOutSession(database, repo.did)
      if (existing) throw new PdsMoveOutInProgressError()

      await consumeHostedBlueskyRateLimit(database, actor.id, 'move')

      const describeNsid = 'com.atproto.server.describeServer'
      const describeRes = await fetchDestination({
        origin: normalizedPdsUrl,
        nsid: describeNsid,
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
      if (describeRes.statusCode < 200 || describeRes.statusCode >= 300) {
        throw buildRemoteError(
          describeNsid,
          describeRes.statusCode,
          describeRes.body
        )
      }
      const described = parseJsonBody(describeNsid, describeRes.body)
      if (
        !isRecord(described) ||
        typeof described.did !== 'string' ||
        !isValidDid(described.did)
      ) {
        throw new PdsMoveOutRemoteError(
          'Destination server did not return a valid server DID.'
        )
      }
      const destDid = described.did.split('#')[0]
      const ownPdsConfig = getPdsConfig()
      if (
        ownPdsConfig &&
        Object.values(ownPdsConfig).some((entry) => entry.did === destDid)
      ) {
        throw new PdsMoveOutInvalidServerUrlError(
          'Choose a different Bluesky server than this one.'
        )
      }
      // The service-auth token is addressed to the DID the destination claims.
      // A hostile host could claim another PDS's DID and replay the token
      // there, so the DID must be the one its own hostname answers as.
      const destinationHost = new URL(normalizedPdsUrl).host
      if (destDid !== toWebDid(destinationHost)) {
        throw new PdsMoveOutRemoteError(
          `That server didn't identify itself as ${destinationHost}.`
        )
      }

      const encryptedSigningKey = await database.getPdsRepoSigningKey({
        did: repo.did
      })
      if (!encryptedSigningKey) throw new PdsHostedAccountNotFoundError()
      const signingKeypair = await loadPdsSigningKey({
        did: repo.did,
        signingKey: encryptedSigningKey
      })

      const createNsid = 'com.atproto.server.createAccount'
      const serviceJwt = await createServiceAuthToken({
        keypair: signingKeypair,
        iss: repo.did,
        aud: destDid,
        lxm: createNsid
      })

      const createBody = JSON.stringify({
        did: repo.did,
        handle: normalizedHandle,
        email: normalizedEmail,
        password,
        ...(normalizedInviteCode ? { inviteCode: normalizedInviteCode } : {})
      })
      const createRes = await fetchDestination({
        origin: normalizedPdsUrl,
        nsid: createNsid,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${serviceJwt}`,
          'Content-Type': 'application/json'
        },
        body: createBody
      })
      if (createRes.statusCode < 200 || createRes.statusCode >= 300) {
        throw buildRemoteError(
          createNsid,
          createRes.statusCode,
          createRes.body,
          password
        )
      }
      const created = parseJsonBody(createNsid, createRes.body)
      if (
        !isRecord(created) ||
        typeof created.accessJwt !== 'string' ||
        !created.accessJwt ||
        typeof created.refreshJwt !== 'string' ||
        !created.refreshJwt ||
        (created.did !== undefined && created.did !== repo.did)
      ) {
        throw new PdsMoveOutRemoteError(
          'Destination server returned an invalid account creation response.'
        )
      }
      // The account must answer the handle the owner typed; a different one
      // would leave the move pointing at a handle they did not choose.
      if (
        typeof created.handle === 'string' &&
        normalizeHandle(created.handle) !== normalizedHandle
      ) {
        throw new PdsMoveOutRemoteError(
          'The destination server created the account with a different handle.'
        )
      }

      const session: StoredBlueskyMoveOutSession = {
        type: 'move-out',
        pdsUrl: normalizedPdsUrl,
        destDid,
        handle: normalizedHandle,
        accessJwt: created.accessJwt,
        refreshJwt: created.refreshJwt,
        importedRev: null,
        switchedAt: null
      }
      await writeStoredBlueskySession(database, repo.did, session)
      return toMoveSummary(session)
    },
    { ttlMs: MOVE_LOCK_MS, waitMs: MOVE_LOCK_WAIT_MS }
  )

  return {
    moveOut,
    state: await getHostedBlueskyAccountState({ database, actor })
  }
}

/**
 * Exports the local repo as a CAR and imports it into the destination PDS,
 * recording the exported `importedRev` in the stored move session.
 */
export const sendMoveOutRepo = async ({
  database,
  actor
}: {
  database: Database
  actor: Actor
}): Promise<SendMoveOutRepoResult> =>
  withPdsRepoLock(
    database,
    `actor:${actor.id}`,
    async () => {
      const currentActor = await requireFreshActor(database, actor)
      const repo = await requireHostedRepo(database, currentActor)
      if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()
      const move = await readMoveOutSession(database, repo.did)
      if (!move) throw new PdsMoveOutNotFoundError()
      if (
        move.switchedAt !== null ||
        isPlcOperationPointingTo(repo.plcOperation, move.pdsUrl)
      ) {
        throw new PdsMoveOutSwitchedError(
          'This account has already switched to the new server.'
        )
      }
      if (resolveEffectivePdsRepoStatus(repo, currentActor) !== 'active') {
        throw new PdsHostedAccountInactiveError(
          'Turn the Bluesky account on before copying its repository.'
        )
      }
      assertPdsDomainEnabled(repo.domain)
      await requireRotationKeypair()
      const { importedRev, bytes } = await uploadRepoCar(
        database,
        repo.did,
        move
      )
      return { importedRev, bytes }
    },
    { ttlMs: MOVE_LOCK_MS, waitMs: MOVE_LOCK_WAIT_MS }
  )

type BlobBatchResult = CopyMoveOutBlobsResult & {
  session: StoredBlueskyMoveOutSession
}

/**
 * Copies one page of missing blobs. Individual blob failures are returned in
 * `failed` without stopping the page. The caller holds the repo lock.
 *
 * The page stops taking new entries once its wall-clock budget is spent and
 * hands the input cursor back with `done: false`: the next call re-lists what
 * is still missing, so a slow destination cannot hold the lock for a whole
 * page of uploads.
 */
const copyBlobBatch = async (
  database: Database,
  did: string,
  session: StoredBlueskyMoveOutSession,
  {
    cursor,
    limit,
    store,
    allowUnavailable = false
  }: {
    cursor?: string
    limit: number
    store?: PdsBlobObjectStore
    allowUnavailable?: boolean
  }
): Promise<BlobBatchResult> => {
  const listNsid = 'com.atproto.repo.listMissingBlobs'
  const listRes = await requestWithMoveAuth({
    database,
    did,
    session,
    nsid: listNsid,
    method: 'GET',
    params: {
      limit,
      ...(cursor ? { cursor } : {})
    }
  })
  let move = listRes.session

  const parsed = parseJsonBody(listNsid, listRes.body)
  if (!isRecord(parsed) || !Array.isArray(parsed.blobs)) {
    throw new PdsMoveOutRemoteError(
      'Destination server returned an invalid missing-blobs list.'
    )
  }

  const nextCursor =
    typeof parsed.cursor === 'string' && parsed.cursor.length > 0
      ? parsed.cursor
      : null
  // An empty page or a cursor that did not move ends the copy: a server that
  // keeps answering the same page must not loop forever.
  const done =
    parsed.blobs.length === 0 || nextCursor === null || nextCursor === cursor

  const seenCids = new Set<string>()
  let copied = 0
  const failed: CopyMoveOutBlobFailure[] = []

  for (const entry of parsed.blobs.slice(0, limit)) {
    const cid =
      isRecord(entry) && typeof entry.cid === 'string' ? entry.cid : null
    if (!cid || seenCids.has(cid)) continue
    seenCids.add(cid)
    const reportedCid = cid.slice(0, MAX_CID_LENGTH)

    try {
      const blob = await readPdsBlob(
        database,
        { did, cid },
        { store, allowUnavailable }
      )
      if (!blob) {
        failed.push({
          cid: reportedCid,
          reason: 'Blob not found on this server.'
        })
        continue
      }
      const bytes = await readStreamToBuffer(blob.stream)
      const uploadRes = await requestWithMoveAuth({
        database,
        did,
        session: move,
        nsid: 'com.atproto.repo.uploadBlob',
        method: 'POST',
        contentType: blob.mimeType,
        bodyBytes: bytes,
        timeoutMs: REMOTE_UPLOAD_TIMEOUT_MS
      })
      move = uploadRes.session
      copied += 1
    } catch (error) {
      if (error instanceof PdsMoveOutRemoteError) {
        failed.push({ cid: reportedCid, reason: error.message })
      } else {
        logger.error({
          message: 'Could not read a blob to copy to the destination server',
          did,
          cid: reportedCid,
          err: toLoggableError(error)
        })
        failed.push({
          cid: reportedCid,
          reason: "Couldn't read this file on this server."
        })
      }
    }
  }

  return { copied, failed, cursor: nextCursor, done, session: move }
}

/**
 * Copies one batch of missing blobs from this PDS to the destination PDS.
 * Individual blob failures are returned in `failed` without stopping the batch.
 */
export const copyMoveOutBlobs = async ({
  database,
  actor,
  cursor,
  limit = DEFAULT_BLOB_BATCH_LIMIT,
  store
}: {
  database: Database
  actor: Actor
  cursor?: string
  limit?: number
  store?: PdsBlobObjectStore
}): Promise<CopyMoveOutBlobsResult> =>
  withPdsRepoLock(
    database,
    `actor:${actor.id}`,
    async () => {
      const currentActor = await requireFreshActor(database, actor)
      const repo = await requireHostedRepo(database, currentActor)
      if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()
      const move = await readMoveOutSession(database, repo.did)
      if (!move) throw new PdsMoveOutNotFoundError()
      if (
        move.switchedAt !== null ||
        isPlcOperationPointingTo(repo.plcOperation, move.pdsUrl)
      ) {
        throw new PdsMoveOutSwitchedError(
          'This account has already switched to the new server.'
        )
      }
      if (resolveEffectivePdsRepoStatus(repo, currentActor) !== 'active') {
        throw new PdsHostedAccountInactiveError(
          'Turn the Bluesky account on before copying media.'
        )
      }
      assertPdsDomainEnabled(repo.domain)
      await requireRotationKeypair()

      const effectiveLimit = Math.min(
        MAX_BLOB_BATCH_LIMIT,
        Math.max(
          1,
          Math.floor(Number.isFinite(limit) ? limit : DEFAULT_BLOB_BATCH_LIMIT)
        )
      )

      const batch = await copyBlobBatch(database, repo.did, move, {
        cursor,
        limit: effectiveLimit,
        store
      })
      return {
        copied: batch.copied,
        failed: batch.failed,
        cursor: batch.cursor,
        done: batch.done
      }
    },
    { ttlMs: MOVE_LOCK_MS, waitMs: MOVE_LOCK_WAIT_MS }
  )

/**
 * Copies the account's local Bluesky preferences to the destination PDS.
 */
export const copyMoveOutPreferences = async ({
  database,
  actor
}: {
  database: Database
  actor: Actor
}): Promise<CopyMoveOutPreferencesResult> =>
  withPdsRepoLock(
    database,
    `actor:${actor.id}`,
    async () => {
      const currentActor = await requireFreshActor(database, actor)
      const repo = await requireHostedRepo(database, currentActor)
      if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()
      const move = await readMoveOutSession(database, repo.did)
      if (!move) throw new PdsMoveOutNotFoundError()
      if (
        move.switchedAt !== null ||
        isPlcOperationPointingTo(repo.plcOperation, move.pdsUrl)
      ) {
        throw new PdsMoveOutSwitchedError(
          'This account has already switched to the new server.'
        )
      }
      if (resolveEffectivePdsRepoStatus(repo, currentActor) !== 'active') {
        throw new PdsHostedAccountInactiveError(
          'Turn the Bluesky account on before copying preferences.'
        )
      }
      assertPdsDomainEnabled(repo.domain)
      await requireRotationKeypair()

      const preferences =
        (await database.getPdsPreferences({ did: repo.did })) ?? []
      await requestWithMoveAuth({
        database,
        did: repo.did,
        session: move,
        nsid: 'app.bsky.actor.putPreferences',
        method: 'POST',
        contentType: 'application/json',
        body: JSON.stringify({ preferences })
      })
      return { count: preferences.length }
    },
    { ttlMs: MOVE_LOCK_MS, waitMs: MOVE_LOCK_WAIT_MS }
  )

const toFiniteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * Reads the destination server's `com.atproto.server.checkAccountStatus`
 * together with the stored move metadata (never exposing tokens). Returns
 * `null` when no move is in progress for this actor.
 */
export const getMoveOutProgress = async ({
  database,
  actor
}: {
  database: Database
  actor: Actor
}): Promise<MoveOutProgress | null> => {
  const repo = await database.getPdsRepo({ actorId: actor.id })
  if (!repo || repo.status === 'deleted') return null
  const move = await readMoveOutSession(database, repo.did)
  if (!move) return null

  const statusNsid = 'com.atproto.server.checkAccountStatus'
  const response = await requestWithMoveAuth({
    database,
    did: repo.did,
    session: move,
    nsid: statusNsid,
    method: 'GET'
  })
  const parsed = parseJsonBody(statusNsid, response.body)
  if (!isRecord(parsed)) {
    throw new PdsMoveOutRemoteError(
      'Destination server returned an invalid account status response.'
    )
  }

  return {
    pdsUrl: move.pdsUrl,
    handle: move.handle,
    stage:
      move.switchedAt !== null ||
      isPlcOperationPointingTo(repo.plcOperation, move.pdsUrl)
        ? 'switched'
        : 'started',
    importedRev: move.importedRev,
    localRev: repo.rev,
    switchedAt: move.switchedAt,
    status: {
      activated: Boolean(parsed.activated),
      validDid: Boolean(parsed.validDid),
      repoCommit:
        typeof parsed.repoCommit === 'string' ? parsed.repoCommit : null,
      repoRev: typeof parsed.repoRev === 'string' ? parsed.repoRev : null,
      repoBlocks: toFiniteNumber(parsed.repoBlocks),
      indexedRecords: toFiniteNumber(parsed.indexedRecords),
      privateStateValues: toFiniteNumber(parsed.privateStateValues),
      expectedBlobs: toFiniteNumber(parsed.expectedBlobs),
      importedBlobs: toFiniteNumber(parsed.importedBlobs)
    }
  }
}

/**
 * One last list, capped at a page, so a finish that ran out of its blob budget
 * can still tell the owner how many files are missing.
 */
const countMissingBlobs = async (
  database: Database,
  did: string,
  session: StoredBlueskyMoveOutSession
): Promise<{ count: number; session: StoredBlueskyMoveOutSession }> => {
  const nsid = 'com.atproto.repo.listMissingBlobs'
  try {
    const response = await requestWithMoveAuth({
      database,
      did,
      session,
      nsid,
      method: 'GET',
      // The protocol's largest page: counting reads no blob bytes.
      params: { limit: 1000 }
    })
    const parsed = parseJsonBody(nsid, response.body)
    return {
      count:
        isRecord(parsed) && Array.isArray(parsed.blobs)
          ? parsed.blobs.length
          : 0,
      session: response.session
    }
  } catch (error) {
    logger.warn({
      message: 'Could not count the blobs left to copy at the switch',
      did,
      err: toLoggableError(error)
    })
    // The copy stopped before `done`, so at least one file is still missing.
    return { count: 1, session }
  }
}

/**
 * Finishes moving the hosted Bluesky account out:
 * 1. Fetches and validates `com.atproto.identity.getRecommendedDidCredentials`.
 * 2. Chains a PLC update taking the directory's last operation's rotation keys
 *    except this server's, then the destination's, and the destination's
 *    signing key, PDS endpoint and handle.
 * 3. Runs the local switch (idempotently): stores the operation, clears the
 *    local handle, sets status to `deactivated`, and emits `#identity` and
 *    `#account` (`active: false`, `status: 'deactivated'`).
 * 4. Re-sends the repo if its rev changed, then copies its missing blobs,
 *    counting the ones it could not send.
 * 5. Calls `activateAccount` on the destination PDS, removes the hosted
 *    `bluesky_accounts` row, deletes the stored move session, and revokes the
 *    destination session.
 *
 * Retryable: a retry after a crash mid-switch completes the local switch and
 * the rest without repeating the PLC submit.
 *
 * Callers (the API route) must verify the account's current password first.
 */
export const finishMoveOut = async ({
  database,
  actor,
  store
}: {
  database: Database
  actor: Actor
  store?: PdsBlobObjectStore
}): Promise<FinishMoveOutResult> => {
  const result = await withPdsRepoLock(
    database,
    `actor:${actor.id}`,
    async () => {
      const currentActor = await requireFreshActor(database, actor)
      const repo = await requireHostedRepo(database, currentActor)
      if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()
      let move = await readMoveOutSession(database, repo.did)
      if (!move) throw new PdsMoveOutNotFoundError()
      // Captured for the switch closure: `move` is reassigned as tokens and
      // progress change, but the destination URL and handle do not.
      const movePdsUrl = move.pdsUrl
      const moveHandle = move.handle

      const alreadySwitched =
        move.switchedAt !== null ||
        isPlcOperationPointingTo(repo.plcOperation, move.pdsUrl)

      let operation: PlcSignedOperation | null = null
      if (!alreadySwitched) {
        // The switch would leave the destination with an empty repo.
        if (move.importedRev === null) throw new PdsMoveOutNotCopiedError()
        if (resolveEffectivePdsRepoStatus(repo, currentActor) !== 'active') {
          throw new PdsHostedAccountInactiveError(
            'Turn the Bluesky account on before finishing the move.'
          )
        }
        assertPdsDomainEnabled(repo.domain)
        const rotationKeypair = await requireRotationKeypair()
        const serverKeyDid = rotationKeypair.did()

        const credsNsid = 'com.atproto.identity.getRecommendedDidCredentials'
        const credsRes = await requestWithMoveAuth({
          database,
          did: repo.did,
          session: move,
          nsid: credsNsid,
          method: 'GET'
        })
        move = credsRes.session
        const credentials = validateRecommendedDidCredentials(
          parseJsonBody(credsNsid, credsRes.body),
          move.pdsUrl,
          move.handle
        )

        const last = await getLastPlcOperation(repo.did)
        const nextRotationKeys = buildNextRotationKeys({
          lastRotationKeys: last.rotationKeys,
          recommendedRotationKeys: credentials.rotationKeys,
          serverRotationKeyDid: serverKeyDid
        })

        if (last.rotationKeys.includes(serverKeyDid)) {
          operation = await createUpdateOperation({
            previous: last,
            previousCid: await cidForOperation(last),
            changes: {
              rotationKeys: nextRotationKeys,
              verificationMethods: { atproto: credentials.signingKeyDid },
              alsoKnownAs: [`at://${credentials.handle}`],
              services: {
                atproto_pds: {
                  type: 'AtprotoPersonalDataServer',
                  endpoint: credentials.pdsEndpoint
                }
              }
            },
            rotationKeypair
          })
          await submitPlcOperation(repo.did, operation)
        } else if (
          isPlcOperationPointingTo(JSON.stringify(last), move.pdsUrl)
        ) {
          // A previous finish attempt already landed the PLC update before
          // persisting it locally; adopt it and finish the local switch.
          operation = last
        } else {
          throw new PdsIdentityMovedError()
        }
      }

      // The local switch is idempotent: complete it whenever the row is still
      // active or its stored operation does not yet point at the destination.
      await writeLiveRepo(database, repo.did, async (current) => {
        const storedPointsToDestination = isPlcOperationPointingTo(
          current.plcOperation,
          movePdsUrl
        )
        if (current.status !== 'active' && storedPointsToDestination) {
          return false
        }
        const operationJson = operation
          ? JSON.stringify(operation)
          : current.plcOperation
        if (!isPlcOperationPointingTo(operationJson, movePdsUrl)) return false
        await database.updatePdsRepoIdentity({
          did: repo.did,
          plcOperation: operationJson,
          // The handle now belongs to the destination; clearing it frees a
          // bare-domain handle for a relinked account.
          handle: null
        })
        await database.updatePdsRepoStatus({
          did: repo.did,
          status: 'deactivated'
        })
        await database.appendPdsEvent({
          did: repo.did,
          type: 'identity',
          payload: formatPdsIdentityEvent({
            did: repo.did,
            handle: moveHandle
          })
        })
        await database.appendPdsEvent({
          did: repo.did,
          type: 'account',
          payload: formatPdsAccountEvent({
            did: repo.did,
            active: false,
            status: 'deactivated'
          })
        })
        return true
      })

      if (move.switchedAt === null) {
        move = await updateMoveOutSession(database, repo.did, {
          switchedAt: Date.now()
        })
      }

      // The repo is deactivated now, so nothing more can be written here: send
      // whatever changed since the last import, then its new blobs, before the
      // destination account is turned on.
      const latestRepo = await database.getPdsRepo({ did: repo.did })
      if (!latestRepo || latestRepo.status === 'deleted') {
        throw new PdsHostedAccountNotFoundError()
      }
      let missingBlobs = 0
      // Only the move's own switch may open the copy here: a repo taken down
      // since, or an actor suspended or disabled, sends nothing more.
      const copyAllowed =
        latestRepo.status === 'deactivated' &&
        !isActorModerationBlocked(currentActor)
      if (copyAllowed) {
        if (latestRepo.rev !== move.importedRev) {
          const uploaded = await uploadRepoCar(database, repo.did, move, {
            allowUnavailable: true
          })
          move = uploaded.session
        }
        // Finish does not trust the page to have run every copy step: it copies
        // whatever the destination still lacks, then the preferences.
        const copyDeadline = Date.now() + FINISH_BLOB_BUDGET_MS
        const failedCids = new Set<string>()
        let cursor: string | undefined
        let copyDone = false
        for (
          let page = 0;
          page < MAX_BLOB_PAGES && Date.now() <= copyDeadline;
          page += 1
        ) {
          // A suspension or disable that lands mid-copy stops it.
          const pageActor = await database.getActorFromId({ id: actor.id })
          if (!pageActor || isActorModerationBlocked(pageActor)) break
          const batch = await copyBlobBatch(database, repo.did, move, {
            cursor,
            limit: DEFAULT_BLOB_BATCH_LIMIT,
            store,
            // The switch deactivated the repo here; its blobs still copy.
            allowUnavailable: true
          })
          move = batch.session
          for (const failure of batch.failed) failedCids.add(failure.cid)
          if (batch.done) {
            copyDone = true
            break
          }
          cursor = batch.cursor ?? undefined
        }
        if (copyDone) {
          missingBlobs = failedCids.size
        } else {
          // Stopped early: everything still missing, failures included.
          const remaining = await countMissingBlobs(database, repo.did, move)
          move = remaining.session
          missingBlobs = Math.max(failedCids.size, remaining.count)
        }
        const preferencesRes = await requestWithMoveAuth({
          database,
          did: repo.did,
          session: move,
          nsid: 'app.bsky.actor.putPreferences',
          method: 'POST',
          contentType: 'application/json',
          body: JSON.stringify({
            preferences:
              (await database.getPdsPreferences({ did: repo.did })) ?? []
          })
        })
        move = preferencesRes.session
      }

      const activateRes = await requestWithMoveAuth({
        database,
        did: repo.did,
        session: move,
        nsid: 'com.atproto.server.activateAccount',
        method: 'POST'
      })
      move = activateRes.session

      // The account delete removes the DID's session row too, so the move goes
      // first: the row it returns is the one whose tokens are revoked, fresher
      // than this call's copy if a refresh rotated them.
      const deletedMove = await deleteMoveOutSession(database, repo.did)
      await database.deleteBlueskyAccount({
        actorId: actor.id,
        hostedDid: repo.did
      })
      await revokeMoveOutTokens(deletedMove)

      return {
        movedTo: new URL(move.pdsUrl).host,
        handle: move.handle,
        missingBlobs
      }
    },
    { ttlMs: FINISH_LOCK_MS, waitMs: MOVE_LOCK_WAIT_MS }
  )

  return {
    ...result,
    state: await getHostedBlueskyAccountState({ database, actor })
  }
}

/**
 * Cancels an in-progress move before the PLC switch, removing the stored move
 * session while leaving the hosted account on this server untouched.
 */
export const cancelMoveOut = async ({
  database,
  actor
}: {
  database: Database
  actor: Actor
}): Promise<CancelMoveOutResult> => {
  const cancelled = await withPdsRepoLock(
    database,
    `actor:${actor.id}`,
    async () => {
      const currentActor = await requireFreshActor(database, actor)
      const repo = await requireHostedRepo(database, currentActor)
      if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()
      const move = await readMoveOutSession(database, repo.did)
      if (!move) throw new PdsMoveOutNotFoundError()
      if (
        move.switchedAt !== null ||
        isPlcOperationPointingTo(repo.plcOperation, move.pdsUrl)
      ) {
        throw new PdsMoveOutSwitchedError()
      }
      // Cancelling signs nothing, so it needs neither the rotation key nor an
      // enabled domain: the owner must be able to back out either way.
      // The stored operation can lag the directory: a switch that landed there
      // but not here must still refuse the cancel.
      const last = await getLastPlcOperation(repo.did)
      if (isPlcOperationPointingTo(JSON.stringify(last), move.pdsUrl)) {
        throw new PdsMoveOutSwitchedError()
      }

      // Revoke the row that was actually deleted: a refresh may have rotated
      // its tokens since this call read the move.
      const deleted = await deleteMoveOutSession(database, repo.did)
      return { pdsUrl: move.pdsUrl, handle: move.handle, session: deleted }
    },
    { ttlMs: MOVE_LOCK_MS, waitMs: MOVE_LOCK_WAIT_MS }
  )

  await revokeMoveOutTokens(cancelled.session)

  return {
    cancelled: true,
    pdsUrl: cancelled.pdsUrl,
    handle: cancelled.handle,
    remoteAccountRemains: true,
    message:
      'Move cancelled. Your Bluesky account on this server is unchanged. The inactive account created on the destination server remains there.',
    state: await getHostedBlueskyAccountState({ database, actor })
  }
}
