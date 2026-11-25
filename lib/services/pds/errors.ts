import type { PdsRepoStatus } from '@/lib/database/domains/pds/types'

export class PdsError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number = 400,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = new.target.name
  }
}

export class PdsDisabledError extends PdsError {
  constructor(domain: string) {
    super(
      `Bluesky PDS is not enabled for domain: ${domain}`,
      'PdsDisabled',
      404
    )
  }
}

export class PdsNotAllowedError extends PdsError {
  constructor(actorId: string) {
    super(
      `Bluesky PDS is not allowed for actor: ${actorId}`,
      'PdsNotAllowed',
      403
    )
  }
}

export class PdsValidationError extends PdsError {
  constructor(
    message: string,
    code = 'InvalidRequest',
    options?: ErrorOptions
  ) {
    super(message, code, 400, options)
  }
}

export class PdsBlobTooLargeError extends PdsValidationError {
  constructor(size: number, maxSize: number) {
    super(
      `Blob size ${size} bytes exceeds maximum allowed size of ${maxSize} bytes`,
      'BlobTooLarge'
    )
    Object.defineProperty(this, 'statusCode', { value: 413 })
  }
}

export class PdsRepoNotFoundError extends PdsError {
  constructor(did: string) {
    super(`Could not find repo for DID: ${did}`, 'RepoNotFound', 400)
  }
}

export class PdsRepoUnavailableError extends PdsError {
  constructor(
    readonly did: string,
    readonly repoStatus: Exclude<PdsRepoStatus, 'active'>
  ) {
    super(
      repoStatus === 'takendown'
        ? `Repo has been takendown: ${did}`
        : repoStatus === 'deleted'
          ? `Repo has been deleted: ${did}`
          : `Repo has been deactivated: ${did}`,
      repoStatus === 'takendown'
        ? 'RepoTakendown'
        : repoStatus === 'deleted'
          ? 'RepoDeleted'
          : 'RepoDeactivated',
      400
    )
  }
}

export class PdsRecordNotFoundError extends PdsError {
  constructor(uri: string) {
    super(`Could not locate record: ${uri}`, 'RecordNotFound', 400)
  }
}

export class PdsRecordConflictError extends PdsError {
  constructor(uri: string) {
    super(`Record already exists: ${uri}`, 'InvalidRequest', 400)
  }
}

export class PdsInvalidSwapError extends PdsError {
  constructor(
    message: string,
    readonly currentCid: string | null = null
  ) {
    super(message, 'InvalidSwap', 400)
  }
}

export class PdsBlocksNotFoundError extends PdsError {
  constructor(readonly missingCids: string[]) {
    super(
      `Could not find cids: ${missingCids.join(', ')}`,
      'InvalidRequest',
      400
    )
  }
}

export class PdsLockTimeoutError extends PdsError {
  constructor(readonly did: string) {
    super(`Timed out waiting for PDS repo lock for ${did}`, 'LockTimeout', 503)
  }
}

export class PdsStorageNotConfiguredError extends PdsError {
  constructor() {
    super(
      'Media storage backend is not configured for PDS blobs',
      'StorageNotConfigured',
      500
    )
  }
}

/**
 * A hosted Bluesky account cannot be created because the instance has no
 * `ACTIVITIES_BLUESKY_PDS_ROTATION_KEY`. The message names the variable only;
 * the key itself is never included.
 */
export class PdsRotationKeyMissingError extends PdsError {
  constructor() {
    super(
      'Hosted Bluesky accounts are not set up on this server: ACTIVITIES_BLUESKY_PDS_ROTATION_KEY is missing or invalid.',
      'RotationKeyMissing',
      422
    )
  }
}

/** The actor already has a hosted repo (any status but `deleted`). */
export class PdsHostedAccountExistsError extends PdsError {
  constructor() {
    super(
      'This profile already has a hosted Bluesky account.',
      'HostedAccountExists',
      409
    )
  }
}

/** The actor has a linked outside Bluesky account; it must be unlinked first. */
export class PdsHostedAccountLinkedError extends PdsError {
  constructor() {
    super(
      'Unlink the Bluesky account linked to this profile before creating a hosted one.',
      'HostedAccountLinked',
      409
    )
  }
}

/** The actor has no hosted repo to act on. */
export class PdsHostedAccountNotFoundError extends PdsError {
  constructor() {
    super(
      'This profile has no hosted Bluesky account.',
      'HostedAccountNotFound',
      422
    )
  }
}

/** A handle is not one of the choices a new account may take. */
export class PdsHandleNotAllowedError extends PdsError {
  constructor(message: string) {
    super(message, 'HandleNotAllowed', 422)
  }
}

/** A custom handle does not resolve to the account's DID. */
export class PdsHandleNotResolvedError extends PdsError {
  constructor(handle: string) {
    super(
      `${handle} does not point at this account. Add the _atproto DNS record or the /.well-known/atproto-did answer first.`,
      'HandleNotResolved',
      422
    )
  }
}

/** A recovery key is not a supported `did:key`. */
export class PdsRecoveryKeyInvalidError extends PdsError {
  constructor() {
    super(
      'Enter a did:key recovery key with a supported curve (secp256k1 or p256).',
      'RecoveryKeyInvalid',
      422
    )
  }
}

/** The typed handle did not match the account's current handle. */
export class PdsConfirmHandleMismatchError extends PdsError {
  constructor() {
    super(
      'Type the account’s current handle to confirm deleting it.',
      'ConfirmHandleMismatch',
      422
    )
  }
}

/** The actor ran out of hosted-account actions of this kind for the day. */
export class PdsHostedRateLimitedError extends PdsError {
  constructor() {
    super('Too many tries. Try again later.', 'RateLimited', 429)
  }
}

/** The directory's last operation for the DID does not verify. */
export class PdsPlcOperationInvalidError extends PdsError {
  constructor() {
    super(
      'The PLC directory returned an operation for this account that does not verify. Try again later.',
      'PlcOperationInvalid',
      422
    )
  }
}

/**
 * The directory's last operation no longer lists this server's rotation key:
 * the owner moved the DID away, so this server cannot change it.
 */
export class PdsIdentityMovedError extends PdsError {
  constructor() {
    super(
      'This account’s identity no longer lists this server’s rotation key, so it can’t be changed here.',
      'IdentityMoved',
      409
    )
  }
}
