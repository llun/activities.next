/**
 * Probes `GET /health` (no database, same origin, not intercepted by the
 * service worker). Resolves whether the server answered 2xx; a network error
 * propagates so the caller can tell "unreachable" from "unhealthy".
 */
export const checkServerHealth = async ({
  signal
}: { signal?: AbortSignal } = {}): Promise<boolean> =>
  (await fetch('/health', { cache: 'no-store', signal })).ok
