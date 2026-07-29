/**
 * Normalizes a thrown value into the `err` field the logger reports on.
 *
 * `logger`'s formatter reads `err.stack` and emits it as `stack_trace`, which is
 * what error reporting groups and displays — a bare `error: <message>` string
 * gives it nothing to work with. Anything can be thrown, not just an Error, so
 * wrap non-Errors rather than passing them through and losing the stack.
 */
export const toLoggableError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))
