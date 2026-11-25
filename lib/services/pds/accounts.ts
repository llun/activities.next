import { Secp256k1Keypair, parseDidKey } from '@atproto/crypto'
import { isValidHandle, normalizeHandle } from '@atproto/syntax'

import {
  type BlueskyPdsDomainConfig,
  getPdsConfig,
  getPdsRotationKeyHex,
  isPdsAllowed
} from '@/lib/config/blueskyPds'
import type { PdsRepo } from '@/lib/database/domains/pds/types'
import type { Database } from '@/lib/database/types'
import { createBlueskyIdentityResolver } from '@/lib/services/bluesky/identityResolver'
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
import {
  PdsConfirmHandleMismatchError,
  PdsDisabledError,
  PdsHandleNotAllowedError,
  PdsHandleNotResolvedError,
  PdsHostedAccountExistsError,
  PdsHostedAccountLinkedError,
  PdsHostedAccountNotFoundError,
  PdsNotAllowedError,
  PdsRecoveryKeyInvalidError,
  PdsRotationKeyMissingError,
  PdsValidationError
} from './errors'
import { formatPdsAccountEvent, formatPdsIdentityEvent } from './events'
import { createPdsSigningKey } from './keys'
import { withPdsRepoLock } from './lock'
import {
  type PlcSignedOperation,
  cidForOperation,
  createGenesisOperation,
  createUpdateOperation,
  submitPlcOperation
} from './plc'
import { createPdsRepo } from './repo'

// The hosted-account service behind Settings › Bluesky (D2.3a): creating a
// did:plc account on the embedded PDS, turning it off and on, changing its
// handle, adding a recovery key and deleting it. Every write that touches repo
// state takes the per-DID lock.

const stripPort = (hostname: string): string => hostname.replace(/:\d+$/, '')

type HostedAccountContext = {
  domain: string
  entry: BlueskyPdsDomainConfig
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
    pdsEnabled: entry.enabled,
    allowed,
    blocked,
    available: entry.enabled && allowed && !blocked
  }
}

const summarizeRepo = (
  repo: PdsRepo | null
): HostedBlueskyRepoSummary | null =>
  repo && repo.status !== 'deleted'
    ? {
        did: repo.did,
        handle: repo.handle,
        status: repo.status,
        recoveryKeyDid: repo.recoveryKeyDid
      }
    : null

const getHandleChoices = async (
  database: Database,
  actor: Actor,
  entry: BlueskyPdsDomainConfig
): Promise<HostedBlueskyHandleChoice[]> => {
  const choices: HostedBlueskyHandleChoice[] = []
  // The served domain this profile claimed in Settings › Other networks. A
  // hosted account cannot coexist with a linked one, so this is normally
  // absent; it is read anyway so a claim made before D2.3 is offered.
  const linked = await database.getBlueskyAccount({ actorId: actor.id })
  if (linked?.instanceHandle) {
    choices.push({ handle: linked.instanceHandle, kind: 'instance' })
  }
  const pdsHandle =
    `${actor.username}.${stripPort(entry.hostname)}`.toLowerCase()
  choices.push({ handle: pdsHandle, kind: 'pds' })
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

const parseStoredOperation = (repo: PdsRepo): PlcSignedOperation => {
  if (!repo.plcOperation) {
    throw new PdsValidationError(
      'The account has no stored PLC operation to update.'
    )
  }
  try {
    return JSON.parse(repo.plcOperation) as PlcSignedOperation
  } catch (error) {
    throw new PdsValidationError(
      'The stored PLC operation is invalid.',
      'InvalidRequest',
      { cause: error }
    )
  }
}

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
      repo: summarizeRepo(repo),
      handleChoices: [],
      customHandleAllowed: false
    }
  }

  return {
    available: context.available,
    pdsHostname: context.entry.hostname,
    rotationKeyConfigured,
    repo: summarizeRepo(repo),
    handleChoices: await getHandleChoices(database, actor, context.entry),
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
  const context = resolveHostedAccountContext(actor)
  if (!context || !context.pdsEnabled) {
    throw new PdsDisabledError(actor.domain)
  }
  if (!context.allowed || context.blocked) {
    throw new PdsNotAllowedError(actor.id)
  }

  const rotationKeypair = await requireRotationKeypair()

  const existing = await database.getPdsRepo({ actorId: actor.id })
  if (existing && existing.status !== 'deleted') {
    throw new PdsHostedAccountExistsError()
  }
  if (await database.getBlueskyAccount({ actorId: actor.id })) {
    throw new PdsHostedAccountLinkedError()
  }

  const normalizedHandle = normalizeHandleInput(handle)
  const choices = await getHandleChoices(database, actor, context.entry)
  if (!choices.some((choice) => choice.handle === normalizedHandle)) {
    throw new PdsHandleNotAllowedError(
      'Choose one of the offered handles for a new account.'
    )
  }

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
    throw error
  }

  return getHostedBlueskyAccountState({ database, actor })
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

  await withPdsRepoLock(database, repo.did, async () => {
    await database.updatePdsRepoStatus({ did: repo.did, status: 'deactivated' })
    await database.appendPdsEvent({
      did: repo.did,
      type: 'account',
      payload: formatPdsAccountEvent({
        did: repo.did,
        active: false,
        status: 'deactivated'
      })
    })
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
  const context = resolveHostedAccountContext(actor)
  if (!context || !context.pdsEnabled) {
    throw new PdsDisabledError(actor.domain)
  }
  if (!context.allowed || context.blocked) {
    throw new PdsNotAllowedError(actor.id)
  }

  const repo = await requireHostedRepo(database, actor)
  if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()

  await withPdsRepoLock(database, repo.did, async () => {
    await database.updatePdsRepoStatus({ did: repo.did, status: 'active' })
    await database.appendPdsEvent({
      did: repo.did,
      type: 'account',
      payload: formatPdsAccountEvent({ did: repo.did, active: true })
    })
  })

  return getHostedBlueskyAccountState({ database, actor })
}

/**
 * Changes the handle: a server-signed PLC update (alsoKnownAs) chained on the
 * stored operation, then `#identity`. A custom domain handle must resolve to
 * this DID first; the PDS handle and a claimed instance handle are answered by
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
  const repo = await requireHostedRepo(database, actor)
  if (repo.status === 'deleted') throw new PdsHostedAccountNotFoundError()

  const normalizedHandle = normalizeHandleInput(handle)
  const context = resolveHostedAccountContext(actor)
  if (!context) throw new PdsDisabledError(actor.domain)

  const choices = await getHandleChoices(database, actor, context.entry)
  const selfAnswered = choices.some(
    (choice) => choice.handle === normalizedHandle
  )
  if (!selfAnswered) {
    const resolvedDid = await resolveHandleDid(normalizedHandle)
    if (resolvedDid !== repo.did) {
      throw new PdsHandleNotResolvedError(normalizedHandle)
    }
  }

  const rotationKeypair = await requireRotationKeypair()
  const previous = parseStoredOperation(repo)
  const previousCid = await cidForOperation(previous)
  const operation = await createUpdateOperation({
    previous,
    previousCid,
    changes: { alsoKnownAs: [`at://${normalizedHandle}`] },
    rotationKeypair
  })

  await submitPlcOperation(repo.did, operation)

  await withPdsRepoLock(database, repo.did, async () => {
    await database.updatePdsRepoIdentity({
      did: repo.did,
      handle: normalizedHandle,
      plcOperation: JSON.stringify(operation)
    })
    await database.appendPdsEvent({
      did: repo.did,
      type: 'identity',
      payload: formatPdsIdentityEvent({
        did: repo.did,
        handle: normalizedHandle
      })
    })
  })

  return getHostedBlueskyAccountState({ database, actor })
}

/**
 * Adds a `did:key` recovery key first in `rotationKeys`, or removes it when
 * `recoveryKeyDid` is null, through a server-signed PLC update.
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

  const previous = parseStoredOperation(repo)
  const previousCid = await cidForOperation(previous)
  const operation = await createUpdateOperation({
    previous,
    previousCid,
    changes: { rotationKeys },
    rotationKeypair
  })

  await submitPlcOperation(repo.did, operation)

  await withPdsRepoLock(database, repo.did, async () => {
    await database.updatePdsRepoIdentity({
      did: repo.did,
      recoveryKeyDid,
      plcOperation: JSON.stringify(operation)
    })
  })

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

  await withPdsRepoLock(database, repo.did, async () => {
    await database.appendPdsEvent({
      did: repo.did,
      type: 'account',
      payload: formatPdsAccountEvent({
        did: repo.did,
        active: false,
        status: 'deleted'
      })
    })
    await database.updatePdsRepoStatus({ did: repo.did, status: 'deleted' })
    const storageKeys = await database.listPdsBlobStorageKeys({
      did: repo.did
    })
    await deletePdsBlobFilesBestEffort(storageKeys, {
      context: { did: repo.did, reason: 'hosted_account_deleted' }
    })
    await database.deletePdsRepoContent({ did: repo.did })
  })

  return getHostedBlueskyAccountState({ database, actor })
}
