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

/** The hosted repo is turned off; its handle changes once it is back on. */
export class PdsHostedAccountInactiveError extends PdsError {
  constructor(
    message = 'Turn the Bluesky account on before changing its handle.'
  ) {
    super(message, 'HostedAccountInactive', 409)
  }
}

/** A handle is not one of the choices a new account may take. */
export class PdsHandleNotAllowedError extends PdsError {
  constructor(message: string) {
    super(message, 'HandleNotAllowed', 422)
  }
}

/** Another live hosted repo on this server holds the handle. */
export class PdsHandleTakenError extends PdsError {
  constructor() {
    super(
      'That handle is already used by another account on this server.',
      'HandleTaken',
      409
    )
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

/** A move to another Bluesky PDS is already in progress for this account. */
export class PdsMoveOutInProgressError extends PdsError {
  constructor() {
    super(
      'A move to another Bluesky server is already in progress for this account.',
      'MoveOutInProgress',
      409
    )
  }
}

/** A move is stored for this account; finish or cancel it before other changes. */
export class PdsMoveOutPendingError extends PdsError {
  constructor() {
    super('Finish or cancel the move first.', 'MoveOutPending', 409)
  }
}

/** There is no stored move in progress for this account. */
export class PdsMoveOutNotFoundError extends PdsError {
  constructor() {
    super(
      'There is no move in progress for this account.',
      'MoveOutNotFound',
      409
    )
  }
}

/** The PLC switch has already happened; pre-switch steps and cancel are refused. */
export class PdsMoveOutSwitchedError extends PdsError {
  constructor(
    message = 'This account has already switched to the new server and can no longer be cancelled.'
  ) {
    super(message, 'MoveOutSwitched', 409)
  }
}

/** The destination PDS URL is not a valid external https origin. */
export class PdsMoveOutInvalidServerUrlError extends PdsError {
  constructor(
    message = 'Enter a valid https:// server address without a path, query, or credentials.'
  ) {
    super(message, 'MoveOutInvalidServerUrl', 400)
  }
}

/** The destination PDS refused a move request or could not be reached. */
export class PdsMoveOutRemoteError extends PdsError {
  constructor(
    message: string,
    readonly remoteStatus: number = 0,
    readonly remoteError: string | null = null,
    readonly remoteMessage: string | null = null,
    options?: ErrorOptions
  ) {
    super(message, 'MoveOutRemoteError', 502, options)
  }
}

/** The destination PDS returned invalid recommended DID credentials. */
export class PdsMoveOutInvalidCredentialsError extends PdsError {
  constructor(
    message = 'The destination server returned invalid account credentials.'
  ) {
    super(message, 'MoveOutInvalidCredentials', 502)
  }
}

/** The hosted repo's stored PLC operation already points to another PDS. */
export class PdsAccountMovedError extends PdsError {
  constructor(readonly movedTo?: string) {
    super(
      movedTo
        ? `This Bluesky account has moved to ${movedTo} and can’t be turned back on here.`
        : 'This Bluesky account has moved to another server and can’t be turned back on here.',
      'AccountMoved',
      409
    )
  }
}
