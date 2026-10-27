import { toLoggableError } from '@/lib/utils/toLoggableError'

// `archives/<id>/<secret>` and `imports/<id>/<token>` as they appear in a path
// or a key: the secret segment is the only thing that guards an export or an
// import upload on public storage, so it never goes to a log (a failed fs call
// names the whole path in its message).
const ARCHIVE_ROOT =
  /(archives|imports)([\\/])[A-Za-z0-9._-]+[\\/][A-Za-z0-9_-]{20,}/g

export const redactArchiveRoot = (text: string) =>
  text.replace(ARCHIVE_ROOT, '$1$2<redacted>')

/** An error for the logs with every archive root removed from it. */
export const toArchiveLoggableError = (error: unknown): Error => {
  const source = toLoggableError(error)
  const safe = new Error(redactArchiveRoot(source.message))
  safe.name = source.name
  if (source.stack) safe.stack = redactArchiveRoot(source.stack)
  const code = (source as NodeJS.ErrnoException).code
  if (code) (safe as NodeJS.ErrnoException).code = code
  return safe
}
