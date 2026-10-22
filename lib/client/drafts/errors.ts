// Kept apart from draftsDb so composers can `instanceof` these without
// pulling the IndexedDB code into the first-load bundle.
class DraftsDbError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

/** `indexedDB` is missing, the open failed, was blocked or took too long. */
export class DraftsUnavailableError extends DraftsDbError {
  constructor(message = 'Drafts storage is unavailable') {
    super('DraftsUnavailableError', message)
  }
}

/** The browser refused a write for lack of storage space. */
export class DraftQuotaError extends DraftsDbError {
  constructor(message = 'Not enough storage space for this draft') {
    super('DraftQuotaError', message)
  }
}

/** Another tab saved this draft first, or deleted it. */
export class DraftConflictError extends DraftsDbError {
  constructor(message = 'This draft changed in another tab') {
    super('DraftConflictError', message)
  }
}

/** The account signed out since this tab read its epoch. */
export class DraftSignedOutError extends DraftsDbError {
  constructor(message = 'The account signed out') {
    super('DraftSignedOutError', message)
  }
}
