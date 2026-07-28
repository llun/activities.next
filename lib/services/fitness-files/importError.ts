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
