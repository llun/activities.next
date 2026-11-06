// The server's `{ error }` message a failed folder write carries (a duplicate
// name, the cap), via `ApiRequestError`, or `fallback`.
export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback
