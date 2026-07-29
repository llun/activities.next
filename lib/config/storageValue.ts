import { logger } from '@/lib/utils/logger'

/**
 * Reads a storage variable that has no default and is meaningless when blank.
 *
 * A missing variable and a blank one used to be treated very differently by
 * accident. Missing fails loudly — `z.string()` rejects `undefined`, so
 * `Config.parse` throws at startup. Blank satisfies the same schema and boots a
 * live-but-broken backend: an empty `..._STORAGE_PATH` reaches
 * `path.resolve('')`, which is the process CWD, so uploads land in the
 * application directory and `/api/v1/files/<name>` — which passes the requested
 * path straight to the local driver — serves the application's own files to
 * anyone. An empty bucket or region instead renders as `S3 — ` in admin and
 * only fails much later inside the AWS SDK. A whitespace-only value is worse
 * still: it is truthy, so it survives every `||` fallback and becomes a literal
 * directory name.
 *
 * Returns the trimmed value; `null` when the variable is set but blank, so the
 * caller can fall back to the already-supported "no storage configured" state;
 * and `undefined` when it is unset, which keeps the loud `Config.parse` failure
 * unchanged.
 *
 * This deliberately lives outside `lib/config/utils.ts`: that module is reached
 * from `proxy.ts` (via `config/host` and `config/securityHeaders`) and so ends
 * up in the middleware Edge Runtime bundle, which must not pull in the logger.
 */
export const requiredStorageValue = (
  key: string,
  subject: string
): string | null | undefined => {
  const value = process.env[key]
  if (value === undefined) return undefined

  const trimmed = value.trim()
  if (trimmed) return trimmed

  logger.warn(`${key} is set but empty; ${subject} will be disabled`)
  return null
}
