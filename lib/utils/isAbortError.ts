/**
 * True for the rejection an aborted `fetch` (or any `AbortSignal`-aware call)
 * produces. Checked as a `DOMException` first, because not every runtime makes
 * `DOMException` a subclass of `Error`.
 */
export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
