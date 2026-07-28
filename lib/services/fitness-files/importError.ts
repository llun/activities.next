/**
 * Normalizes a thrown value into the reason stored on `fitness_files.importError`.
 *
 * Anything can be thrown, not just an Error — a queue SDK can reject with a
 * plain object or string. `(error as Error).message` is `undefined` for those,
 * and an undefined reason is written to the column as NULL: it wipes any reason
 * already there and leaves the file `failed` with no explanation, which is the
 * exact failure recording the reason exists to prevent.
 */
export const toImportErrorMessage = (
  error: unknown,
  fallback = 'Unknown fitness import error'
) => (error instanceof Error ? error.message : String(error)) || fallback

/**
 * Normalizes a thrown value into the `err` field the logger reports on.
 *
 * `logger`'s formatter reads `err.stack` to emit `stack_trace`, which is what
 * error reporting groups and displays — a bare `error: message` string gives it
 * nothing to work with. Anything can be thrown, so wrap non-Errors rather than
 * passing them through and losing the stack silently.
 */
export const toLoggableError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))
