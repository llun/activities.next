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
        : `Repo has been deactivated: ${did}`,
      repoStatus === 'takendown' ? 'RepoTakendown' : 'RepoDeactivated',
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
