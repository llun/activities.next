import { Secp256k1Keypair, parseDidKey } from '@atproto/crypto'
import { isValidHandle, normalizeHandle } from '@atproto/syntax'

import {
  type BlueskyPdsConfig,
  type BlueskyPdsDomainConfig,
  getPdsConfig,
  getPdsRotationKeyHex,
  isPdsAllowed
} from '@/lib/config/blueskyPds'
import type { PdsRepo } from '@/lib/database/domains/pds/types'
import type { Database } from '@/lib/database/types'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'
import { getClaimableHost } from '@/lib/services/bluesky/claimableHost'
import { createBlueskyIdentityResolver } from '@/lib/services/bluesky/identityResolver'
import { getLocalDomainMatcher } from '@/lib/services/domains/localDomains'
import {
  isActorConfirmationPending,
  isActorModerationBlocked
} from '@/lib/services/guards/accountState'
import type { Actor } from '@/lib/types/domain/actor'
import type {
  HostedBlueskyAccountState,
  HostedBlueskyHandleChoice,
  HostedBlueskyRepoSummary
} from '@/lib/utils/blueskyHosted'
import { normalizeServedDomainChoice } from '@/lib/utils/host'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { deletePdsBlobFilesBestEffort } from './blobStorage'
import { resolveEffectivePdsRepoStatus } from './effectiveStatus'
import {
  PdsConfirmHandleMismatchError,
  PdsDisabledError,
  PdsHandleNotAllowedError,
  PdsHandleNotResolvedError,
  PdsHandleTakenError,
  PdsHostedAccountExistsError,
  PdsHostedAccountInactiveError,
  PdsHostedAccountLinkedError,
  PdsHostedAccountNotFoundError,
  PdsIdentityMovedError,
  PdsNotAllowedError,
  PdsRecoveryKeyInvalidError,
  PdsRotationKeyMissingError,
  PdsValidationError
} from './errors'
import { formatPdsAccountEvent, formatPdsIdentityEvent } from './events'
import { isReservedPdsSubdomainHandle } from './host'
import { createPdsSigningKey } from './keys'
import { withPdsRepoLock } from './lock'
import {
  PLC_DIRECTORY_TIMEOUT_MS,
  type PlcOperationChanges,
  type PlcSignedOperation,
  cidForOperation,
  createGenesisOperation,
  createUpdateOperation,
  getLastPlcOperation,
  submitPlcOperation
} from './plc'
import { consumeHostedBlueskyRateLimit } from './rateLimit'
import { createPdsRepo } from './repo'

// The hosted-account service behind Settings › Bluesky (D2.3a): creating a
// did:plc account on the embedded PDS, turning it off and on, changing its
// handle, adding a recovery key and deleting it. Every write that touches repo
// state takes the per-DID lock.

const stripPort = (hostname: string): string => hostname.replace(/:\d+$/, '')

type HostedAccountContext = {
  domain: string
  entry: BlueskyPdsDomainConfig
  config: BlueskyPdsConfig
  pdsEnabled: boolean
  allowed: boolean
  blocked: boolean
  available: boolean
}

const resolveHostedAccountContext = (
  actor: Actor
): HostedAccountContext | null => {
  const domain = normalizeServedDomainChoice(actor.domain)
  if (!domain) return null
  const config = getPdsConfig()
  const entry = config?.[domain]
  if (!entry) return null

  const allowed = isPdsAllowed({
    email: actor.account?.email,
    actorUsernameAtDomain: `${actor.username}@${domain}`,
    domain,
    config
  })
  const blocked =
    isActorModerationBlocked(actor) ||
    isActorConfirmationPending(actor) ||
    actor.account?.approvedAt == null ||
    Boolean(actor.deletionStatus)

  return {
    domain,
    entry,
    config,
    pdsEnabled: entry.enabled,
    allowed,
    blocked,
    available: entry.enabled && allowed && !blocked
  }
}

// The gate every hosted-account write passes: PDS enabled on the actor's
// domain, the actor allowlisted, and not blocked (unconfirmed, unapproved,
// suspended, disabled or being deleted).
const requireUsableHostedContext = (actor: Actor): HostedAccountContext => {
  const context = resolveHostedAccountContext(actor)
  if (!context || !context.pdsEnabled) {
    throw new PdsDisabledError(actor.domain)
  }
  if (!context.allowed || context.blocked) {
    throw new PdsNotAllowedError(actor.id)
  }
  return context
}

// The card shows the effective status, so a suspended or disabled profile's
// account reads as suspended and a deleting or unapproved one's as off.
const summarizeRepo = (
  repo: PdsRepo | null,
  actor: Actor
): HostedBlueskyRepoSummary | null =>
  repo && repo.status !== 'deleted'
    ? {
        did: repo.did,
        handle: repo.handle,
        status: resolveEffectivePdsRepoStatus(repo, actor),
        recoveryKeyDid: repo.recoveryKeyDid
      }
    : null

const pdsSubdomainHandle = (actor: Actor, entry: BlueskyPdsDomainConfig) =>
  `${actor.username}.${stripPort(entry.hostname)}`.toLowerCase()

const getHandleChoices = async (
  database: Database,
  actor: Actor,
  { entry, config }: Pick<HostedAccountContext, 'entry' | 'config'>
): Promise<HostedBlueskyHandleChoice[]> => {
  const choices: HostedBlueskyHandleChoice[] = []
  // The bare served domain, for an actor who may hold it by the same rule as
  // a linked account's claim (an active admin's actor on that domain) while
  // no other admin's claim and no other live hosted account holds it. A served
  // domain is the point here, so the subdomain reservation does not apply.
  const host = getClaimableHost(actor)
  if (
    host &&
    isValidHandle(host) &&
    (await database.canHoldInstanceHandle({ actorId: actor.id, host }))
  ) {
    const holder = await database.getPdsRepoByHandle({ handle: host })
    if (!holder || holder.actorId === actor.id) {
      choices.push({ handle: host, kind: 'instance' })
    }
  }
  // `<username>.<PDS host>`, unless the username makes it an invalid handle
  // (an `_` or `~`) or another host owns that name.
  const pdsHandle = pdsSubdomainHandle(actor, entry)
  const isServedDomain = await getLocalDomainMatcher(database)
  if (
    isValidHandle(pdsHandle) &&
    !isReservedPdsSubdomainHandle(pdsHandle, isServedDomain, config)
  ) {
    choices.push({ handle: pdsHandle, kind: 'pds' })
  }
  return choices
}

const requireHostedRepo = async (
  database: Database,
  actor: Actor
): Promise<PdsRepo> => {
  const repo = await database.getPdsRepo({ actorId: actor.id })
  if (!repo) throw new PdsHostedAccountNotFoundError()
  return repo
}

const requireRotationKeypair = async (): Promise<Secp256k1Keypair> => {
  const hex = getPdsRotationKeyHex()
  if (!hex) throw new PdsRotationKeyMissingError()
  return Secp256k1Keypair.import(Buffer.from(hex, 'hex'))
}

/**
 * Builds a server-signed update chained on the directory's last operation,
 * not the stored one: a submit whose local write failed, or an operation the
 * owner signed with their recovery key, would otherwise fork the chain. The
 * update copies the fetched operation's fields, so only `changes` differ.
 */
const createChainedUpdate = async (
  did: string,
  rotationKeypair: Secp256k1Keypair,
  changes: PlcOperationChanges
): Promise<PlcSignedOperation> => {
  // Trusted as given: the configured directory over TLS verifies the chain.
  const last = await getLastPlcOperation(did)
  if (!last.rotationKeys.includes(rotationKeypair.did())) {
    throw new PdsIdentityMovedError()
  }
  return createUpdateOperation({
    previous: last,
    previousCid: await cidForOperation(last),
    changes,
    rotationKeypair
  })
}

// A live repo on any domain holding the handle, other than `ownDid`'s,
// refuses it, before any PLC operation: the unique index on live handles is
// global. The index still backs this up against a race.
const assertHandleFree = async (
  database: Database,
  handle: string,
  ownDid: string | null
): Promise<void> => {
  const holder = await database.getPdsRepoByHandle({ handle })
  if (holder && holder.did !== ownDid) throw new PdsHandleTakenError()
}

const isHandleTakenError = (error: unknown): boolean =>
  isUniqueConstraintError(error) &&
  /pds_repos_handle_live_unique|pds_repos\.handle/.test(
    `${(error as { constraint?: string }).constraint ?? ''} ${
      (error as { message?: string }).message ?? ''
    }`
  )

// Runs a repo write under the per-DID lock, re-reading the repo there: a
// delete that landed after the caller's read leaves a tombstone, which no
// write may touch. `write` answers whether it changed the row.
const writeLiveRepo = (
  database: Database,
  did: string,
  write: () => Promise<boolean>
): Promise<boolean> =>
  withPdsRepoLock(database, did, async () => {
    const current = await database.getPdsRepo({ did })
    if (!current || current.status === 'deleted') return false
    return write()
  })

const normalizeHandleInput = (handle: string): string => {
  const normalized = normalizeHandle(handle.trim())
  if (!isValidHandle(normalized)) {
    throw new PdsValidationError(
      'Enter a valid handle, like alice.example.com.'
    )
  }
  return normalized
}

// Resolves a handle to its DID through DNS `_atproto` TXT or HTTPS
// `/.well-known/atproto-did`, the same resolver Settings › Other networks uses.
const resolveHandleDid = async (handle: string): Promise<string | null> => {
  try {
    const identity = await createBlueskyIdentityResolver().resolve(handle)
    return identity.did
  } catch (error) {
    logger.info({
      message: 'Hosted Bluesky handle did not resolve',
      handle,
      err: toLoggableError(error)
    })
    return null
  }
}

/**
 * The Settings › Bluesky card state: whether it should show, the PDS hostname,
 * the hosted repo (if any), the handles a new account may take and whether a
 * rotation key is configured.
 */
export const getHostedBlueskyAccountState = async ({
  database,
  actor
}: {
  database: Database
  actor: Actor
}): Promise<HostedBlueskyAccountState> => {
  const context = resolveHostedAccountContext(actor)
  const repo = await database.getPdsRepo({ actorId: actor.id })
  const rotationKeyConfigured = getPdsRotationKeyHex() !== null

  if (!context) {
    return {
      available: false,
      pdsHostname: null,
      rotationKeyConfigured,
      repo: summarizeRepo(repo, actor),
      handleChoices: [],
      customHandleAllowed: false
    }
  }

  return {
    available: context.available,
    pdsHostname: context.entry.hostname,
    rotationKeyConfigured,
    repo: summarizeRepo(repo, actor),
    handleChoices: await getHandleChoices(database, actor, context),
    customHandleAllowed: Boolean(repo && repo.status !== 'deleted')
  }
}

/**
 * Creates a hosted did:plc account: a signing key, a genesis operation naming
 * the PDS host, the signing key, the handle and the server rotation key,
 * submitted to the PLC directory, then the local repo with `#identity` and
 * `#account` active.
 *
 * The PLC submit happens before any local write, so a directory failure leaves
 * nothing behind. If the local create fails after the submit, the DID is
 * already registered at PLC and a retry derives a new one from a new genesis
 * operation, orphaning the first; the error is logged with the DID.
 */
export const createHostedBlueskyAccount = async ({
  database,
  actor,
  handle
}: {
  database: Database
  actor: Actor
  handle: string
}): Promise<HostedBlueskyAccountState> => {
  const context = requireUsableHostedContext(actor)
  const rotationKeypair = await requireRotationKeypair()

  // One create per actor at a time: two that both passed the checks would
  // both register a DID at the directory, and the loser's would be orphaned.
  await withPdsRepoLock(
    database,
    `actor:${actor.id}`,
    () =>
      createHostedRepoLocked({
        database,
        actor,
        handle,
        context,
        rotationKeypair
      }),
    { ttlMs: CREATE_LOCK_MS, waitMs: CREATE_LOCK_MS }
  )

  return getHostedBlueskyAccountState({ database, actor })
}

// Covers the PLC submit's timeout and the local create after it.
const CREATE_LOCK_MS = PLC_DIRECTORY_TIMEOUT_MS + 30_000

const createHostedRepoLocked = async ({
  database,
  actor,
  handle,
  context,
  rotationKeypair
}: {
  database: Database
  actor: Actor
  handle: string
  context: HostedAccountContext
  rotationKeypair: Secp256k1Keypair
}): Promise<void> => {
  const existing = await database.getPdsRepo({ actorId: actor.id })
  if (existing && existing.status !== 'deleted') {
    throw new PdsHostedAccountExistsError()
  }
  if (await database.getBlueskyAccount({ actorId: actor.id })) {
    throw new PdsHostedAccountLinkedError()
  }

  const normalizedHandle = normalizeHandleInput(handle)
  const choices = await getHandleChoices(database, actor, context)
  if (!choices.some((choice) => choice.handle === normalizedHandle)) {
    throw new PdsHandleNotAllowedError(
      'Choose one of the offered handles for a new account.'
    )
  }
  await assertHandleFree(database, normalizedHandle, null)

  await consumeHostedBlueskyRateLimit(database, actor.id, 'create')
  const signingKey = await createPdsSigningKey()
  const { did, operation } = await createGenesisOperation({
    rotationKeys: [rotationKeypair.did()],
    signingKeyDid: signingKey.did(),
    handle: normalizedHandle,
    pdsEndpoint: `https://${context.entry.hostname}`,
    rotationKeypair
  })

  await submitPlcOperation(did, operation)

  try {
    await createPdsRepo(database, {
      did,
      actorId: actor.id,
      domain: context.domain,
      handle: normalizedHandle,
      plcOperation: JSON.stringify(operation),
      signingKey
    })
  } catch (error) {
    logger.error({
      message:
        'Hosted Bluesky account repo creation failed after the PLC submit; a retry derives a new DID',
      actorId: actor.id,
      did,
      err: toLoggableError(error)
    })
    throw isHandleTakenError(error) ? new PdsHandleTakenError() : error
  }
}

/** Turns the account off: status `deactivated` and `#account` active:false. */
export const deactivateHostedBlueskyAccount = async ({
  database,
  actor
}: {
  database: Database
  actor: Actor
}): Promise<HostedBlueskyAccountState> => {
  const repo = await requireHostedRepo(database, actor)
  if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()

  await writeLiveRepo(database, repo.did, async () => {
    const changed = await database.updatePdsRepoStatus({
      did: repo.did,
      status: 'deactivated'
    })
    if (!changed) return false
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

  return getHostedBlueskyAccountState({ database, actor })
}

/**
 * Turns the account back on: status `active` and `#account` active:true. The
 * gates are re-checked, so a suspended or disabled actor cannot reactivate.
 */
export const reactivateHostedBlueskyAccount = async ({
  database,
  actor
}: {
  database: Database
  actor: Actor
}): Promise<HostedBlueskyAccountState> => {
  requireUsableHostedContext(actor)
  const repo = await requireHostedRepo(database, actor)
  if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()

  await writeLiveRepo(database, repo.did, async () => {
    const changed = await database.updatePdsRepoStatus({
      did: repo.did,
      status: 'active'
    })
    if (!changed) return false
    await database.appendPdsEvent({
      did: repo.did,
      type: 'account',
      payload: formatPdsAccountEvent({ did: repo.did, active: true })
    })
    return true
  })

  return getHostedBlueskyAccountState({ database, actor })
}

/**
 * Changes the handle: a server-signed PLC update (alsoKnownAs) chained on the
 * directory's last operation, then `#identity`. A custom domain handle must resolve to
 * this DID first; the PDS handle and the bare served domain are answered by
 * this server and skip the check.
 */
export const changeHostedBlueskyHandle = async ({
  database,
  actor,
  handle
}: {
  database: Database
  actor: Actor
  handle: string
}): Promise<HostedBlueskyAccountState> => {
  const context = requireUsableHostedContext(actor)
  const repo = await requireHostedRepo(database, actor)
  if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()
  if (repo.status !== 'active') throw new PdsHostedAccountInactiveError()

  const normalizedHandle = normalizeHandleInput(handle)
  await assertHandleFree(database, normalizedHandle, repo.did)
  const choices = await getHandleChoices(database, actor, context)
  const selfAnswered = choices.some(
    (choice) => choice.handle === normalizedHandle
  )
  if (!selfAnswered) {
    // A valid PDS subdomain handle is left out of the choices only when
    // another host owns that name.
    if (normalizedHandle === pdsSubdomainHandle(actor, context.entry)) {
      throw new PdsHandleNotAllowedError(
        'That handle belongs to another domain on this server. Choose another handle.'
      )
    }
    const resolvedDid = await resolveHandleDid(normalizedHandle)
    if (resolvedDid !== repo.did) {
      throw new PdsHandleNotResolvedError(normalizedHandle)
    }
  }

  const rotationKeypair = await requireRotationKeypair()
  await consumeHostedBlueskyRateLimit(database, actor.id, 'handle')
  const operation = await createChainedUpdate(repo.did, rotationKeypair, {
    alsoKnownAs: [`at://${normalizedHandle}`]
  })

  await submitPlcOperation(repo.did, operation)

  await writeLiveRepo(database, repo.did, async () => {
    const changed = await database
      .updatePdsRepoIdentity({
        did: repo.did,
        handle: normalizedHandle,
        plcOperation: JSON.stringify(operation)
      })
      .catch((error: unknown) => {
        throw isHandleTakenError(error) ? new PdsHandleTakenError() : error
      })
    if (!changed) return false
    await database.appendPdsEvent({
      did: repo.did,
      type: 'identity',
      payload: formatPdsIdentityEvent({
        did: repo.did,
        handle: normalizedHandle
      })
    })
    return true
  })

  return getHostedBlueskyAccountState({ database, actor })
}

/**
 * Adds a `did:key` recovery key first in `rotationKeys`, or removes it when
 * `recoveryKeyDid` is null, through a server-signed PLC update chained on the
 * directory's last operation. The caller has already checked the account's
 * current password.
 */
export const setHostedBlueskyRecoveryKey = async ({
  database,
  actor,
  recoveryKeyDid
}: {
  database: Database
  actor: Actor
  recoveryKeyDid: string | null
}): Promise<HostedBlueskyAccountState> => {
  requireUsableHostedContext(actor)
  const repo = await requireHostedRepo(database, actor)
  if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()

  if (recoveryKeyDid !== null) {
    try {
      parseDidKey(recoveryKeyDid)
    } catch {
      throw new PdsRecoveryKeyInvalidError()
    }
  }

  const rotationKeypair = await requireRotationKeypair()
  const serverKeyDid = rotationKeypair.did()
  const rotationKeys =
    recoveryKeyDid && recoveryKeyDid !== serverKeyDid
      ? [recoveryKeyDid, serverKeyDid]
      : [serverKeyDid]

  await consumeHostedBlueskyRateLimit(database, actor.id, 'recovery')
  const operation = await createChainedUpdate(repo.did, rotationKeypair, {
    rotationKeys
  })

  await submitPlcOperation(repo.did, operation)

  await writeLiveRepo(database, repo.did, () =>
    database.updatePdsRepoIdentity({
      did: repo.did,
      recoveryKeyDid,
      plcOperation: JSON.stringify(operation)
    })
  )

  return getHostedBlueskyAccountState({ database, actor })
}

/**
 * Deletes the account: `#account` active:false status `deleted`, status
 * `deleted`, the blob files and the repo's records, blocks and blobs. The
 * `pds_repos` row and its events stay as a tombstone that retention removes
 * after the event window.
 *
 * The DID stays registered at the PLC directory: a PLC tombstone is out of
 * scope for D2.3a.
 */
export const deleteHostedBlueskyAccount = async ({
  database,
  actor,
  confirmHandle
}: {
  database: Database
  actor: Actor
  confirmHandle: string
}): Promise<HostedBlueskyAccountState> => {
  const repo = await requireHostedRepo(database, actor)
  if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()

  if (
    !repo.handle ||
    confirmHandle.trim().toLowerCase() !== repo.handle.toLowerCase()
  ) {
    throw new PdsConfirmHandleMismatchError()
  }

  // The event goes first: if a later step fails, the repo is still live and
  // the owner can delete it again. Once the status flips, retention finishes
  // whatever content and blob files a failure left behind.
  await writeLiveRepo(database, repo.did, async () => {
    await database.appendPdsEvent({
      did: repo.did,
      type: 'account',
      payload: formatPdsAccountEvent({
        did: repo.did,
        active: false,
        status: 'deleted'
      })
    })
    const changed = await database.updatePdsRepoStatus({
      did: repo.did,
      status: 'deleted'
    })
    if (!changed) return false
    const storageKeys = await database.listPdsBlobStorageKeys({
      did: repo.did
    })
    await deletePdsBlobFilesBestEffort(storageKeys, {
      context: { did: repo.did, reason: 'hosted_account_deleted' }
    })
    await database.deletePdsRepoContent({ did: repo.did })
    return true
  })

  return getHostedBlueskyAccountState({ database, actor })
}
