// Raised when an upload fails for a client-actionable reason (storage quota
// exceeded, unsupported/invalid media) rather than an internal fault. Upload
// routes map this to 422 (Mastodon's "Validation failed"), while untyped errors
// fall through to 500. Mirrors the PresignedUploadValidationError pattern.
export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaValidationError'
  }
}
