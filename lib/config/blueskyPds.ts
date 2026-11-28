import { z } from 'zod'

import { normalizeServedDomainChoice } from '@/lib/utils/host'
import { logger } from '@/lib/utils/logger'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

export const DEFAULT_BLUESKY_PDS_RELAYS = ['https://bsky.network'] as const

const RawBlueskyPdsDomainConfig = z.object({
  enabled: z.boolean().default(false),
  hostname: z.string().min(1),
  allowEmails: z.string().array().default([]),
  allowActors: z.string().array().default([]),
  relays: z.string().array().optional()
})

export const BlueskyPdsDomainConfig = z.object({
  domain: z.string(),
  enabled: z.boolean(),
  hostname: z.string(),
  did: z.string(),
  allowEmails: z.string().array(),
  allowActors: z.string().array(),
  relays: z.string().array()
})
export type BlueskyPdsDomainConfig = z.infer<typeof BlueskyPdsDomainConfig>

export const BlueskyPdsConfig = z.record(z.string(), BlueskyPdsDomainConfig)
export type BlueskyPdsConfig = z.infer<typeof BlueskyPdsConfig>

export const normalizePdsRelayUrl = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.includes('@') || trimmed.includes('?') || trimmed.includes('#')) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null
  if (parsed.search !== '' || parsed.hash !== '') return null
  return parsed.origin
}

const normalizeActorHandle = (value: string): string =>
  value.trim().replace(/^@/, '').toLowerCase()

/**
 * The `did:web` a PDS hostname answers as: `did:web:<hostname>`, with a port's
 * colon percent-encoded (`pds.example:8443` → `did:web:pds.example%3A8443`).
 */
export const toWebDid = (hostname: string): string =>
  `did:web:${hostname.replace(/:/g, '%3A')}`

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseBlueskyPdsConfig = (
  raw: string | undefined
): BlueskyPdsConfig | null => {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logger.warn({
      message:
        'ACTIVITIES_BLUESKY_PDS must be a JSON object keyed by served domain; Bluesky PDS will be disabled'
    })
    return null
  }

  if (!isPlainObject(parsed)) {
    logger.warn({
      message:
        'ACTIVITIES_BLUESKY_PDS must be a JSON object keyed by served domain; Bluesky PDS will be disabled'
    })
    return null
  }

  const normalizedEntries = new Map<string, BlueskyPdsDomainConfig>()
  for (const [rawDomain, rawEntry] of Object.entries(parsed)) {
    const domain = normalizeServedDomainChoice(rawDomain)
    if (!domain) {
      logger.warn({
        message:
          'ACTIVITIES_BLUESKY_PDS contains an invalid served domain key; Bluesky PDS will be disabled'
      })
      return null
    }
    if (normalizedEntries.has(domain)) {
      logger.warn({
        domain,
        message:
          'ACTIVITIES_BLUESKY_PDS contains duplicate served domain keys; Bluesky PDS will be disabled'
      })
      return null
    }

    const entryResult = RawBlueskyPdsDomainConfig.safeParse(rawEntry)
    if (!entryResult.success) {
      logger.warn({
        domain,
        message:
          'ACTIVITIES_BLUESKY_PDS has an invalid domain entry; Bluesky PDS will be disabled'
      })
      return null
    }

    const hostname = normalizeServedDomainChoice(entryResult.data.hostname)
    if (!hostname) {
      logger.warn({
        domain,
        message:
          'ACTIVITIES_BLUESKY_PDS has an invalid PDS hostname; Bluesky PDS will be disabled'
      })
      return null
    }

    const rawRelays = entryResult.data.relays
    let relays: string[]
    if (rawRelays === undefined) {
      relays = [...DEFAULT_BLUESKY_PDS_RELAYS]
    } else {
      const normalizedRelays: string[] = []
      for (const rawRelay of rawRelays) {
        const normalizedRelay = normalizePdsRelayUrl(rawRelay)
        if (!normalizedRelay) {
          logger.warn({
            domain,
            message:
              'ACTIVITIES_BLUESKY_PDS has an invalid relay URL; Bluesky PDS will be disabled'
          })
          return null
        }
        normalizedRelays.push(normalizedRelay)
      }
      relays = Array.from(new Set(normalizedRelays))
    }

    normalizedEntries.set(domain, {
      domain,
      enabled: entryResult.data.enabled,
      hostname,
      did: toWebDid(hostname),
      allowEmails: Array.from(
        new Set(
          entryResult.data.allowEmails.map(normalizeEmail).filter(Boolean)
        )
      ),
      allowActors: Array.from(
        new Set(
          entryResult.data.allowActors.map(normalizeActorHandle).filter(Boolean)
        )
      ),
      relays
    })
  }

  const domainKeys = new Set(normalizedEntries.keys())
  const hostnameCounts = new Map<string, number>()
  for (const entry of normalizedEntries.values()) {
    hostnameCounts.set(
      entry.hostname,
      (hostnameCounts.get(entry.hostname) ?? 0) + 1
    )
  }

  const result: BlueskyPdsConfig = {}
  for (const [domain, entry] of normalizedEntries.entries()) {
    if (domainKeys.has(entry.hostname)) {
      logger.warn({
        domain,
        hostname: entry.hostname,
        message:
          'ACTIVITIES_BLUESKY_PDS hostname cannot match a served domain key; dropping domain'
      })
      continue
    }
    if ((hostnameCounts.get(entry.hostname) ?? 0) > 1) {
      logger.warn({
        domain,
        hostname: entry.hostname,
        message:
          'ACTIVITIES_BLUESKY_PDS hostname is duplicated across domains; dropping domain'
      })
      continue
    }
    result[domain] = entry
  }

  if (Object.keys(result).length === 0) return null
  return result
}

let cachedRaw: string | undefined
let hasCachedValue = false
let cachedConfig: BlueskyPdsConfig | null = null

export const getPdsConfig = (): BlueskyPdsConfig | null => {
  const raw = process.env.ACTIVITIES_BLUESKY_PDS?.trim()
  if (hasCachedValue && raw === cachedRaw) {
    return cachedConfig
  }
  const parsed = parseBlueskyPdsConfig(raw)
  cachedRaw = raw
  hasCachedValue = true
  cachedConfig = parsed
  return parsed
}

export const getBlueskyPdsConfig = (): {
  blueskyPds: BlueskyPdsConfig
} | null => {
  const blueskyPds = getPdsConfig()
  return blueskyPds ? { blueskyPds } : null
}

export const getPdsDomainForHostname = (
  hostname: string | null | undefined,
  config: BlueskyPdsConfig | null = getPdsConfig()
): BlueskyPdsDomainConfig | null => {
  if (!config || !hostname) return null
  const normalizedHostname = normalizeServedDomainChoice(hostname)
  if (!normalizedHostname) return null

  for (const entry of Object.values(config)) {
    if (entry.enabled && entry.hostname === normalizedHostname) {
      return entry
    }
  }
  return null
}

/**
 * Whether an email or `username@domain` profile is on an allowlist. Empty
 * lists allow nobody.
 */
export const matchesPdsAllowList = ({
  email,
  actorUsernameAtDomain,
  allowEmails,
  allowActors
}: {
  email?: string | null
  actorUsernameAtDomain?: string | null
  allowEmails: readonly string[]
  allowActors: readonly string[]
}): boolean => {
  if (email) {
    const normalizedEmail = normalizeEmail(email)
    if (normalizedEmail && allowEmails.includes(normalizedEmail)) {
      return true
    }
  }

  if (actorUsernameAtDomain) {
    const normalizedActor = normalizeActorHandle(actorUsernameAtDomain)
    if (normalizedActor && allowActors.includes(normalizedActor)) {
      return true
    }
  }

  return false
}

export const isPdsAllowed = ({
  email,
  actorUsernameAtDomain,
  domain,
  config = getPdsConfig()
}: {
  email?: string | null
  actorUsernameAtDomain?: string | null
  domain: string
  config?: BlueskyPdsConfig | null
}): boolean => {
  if (!config) return false
  const normalizedDomain = normalizeServedDomainChoice(domain)
  if (!normalizedDomain) return false

  const entry = config[normalizedDomain]
  if (!entry || !entry.enabled) return false

  return matchesPdsAllowList({
    email,
    actorUsernameAtDomain,
    allowEmails: entry.allowEmails,
    allowActors: entry.allowActors
  })
}

/** Default PLC directory the embedded PDS submits `did:plc` operations to. */
export const DEFAULT_PLC_DIRECTORY_URL = 'https://plc.directory'

const PDS_ROTATION_KEY_PATTERN = /^[0-9a-fA-F]{64}$/

let cachedRotationKeyRaw: string | undefined
let hasCachedRotationKey = false
let cachedRotationKey: string | null = null
let didWarnAboutRotationKey = false

/**
 * The instance-wide secp256k1 private key that signs `did:plc` operations for
 * hosted Bluesky accounts, as 64 lowercase hex characters, or `null` when it is
 * unset or invalid. The value is a secret: it is never logged, and the warning
 * for an invalid value names the variable only.
 */
export const getPdsRotationKeyHex = (): string | null => {
  const raw = process.env.ACTIVITIES_BLUESKY_PDS_ROTATION_KEY?.trim()
  if (hasCachedRotationKey && raw === cachedRotationKeyRaw) {
    return cachedRotationKey
  }
  cachedRotationKeyRaw = raw
  hasCachedRotationKey = true

  if (!raw) {
    cachedRotationKey = null
    return null
  }

  if (!PDS_ROTATION_KEY_PATTERN.test(raw)) {
    if (!didWarnAboutRotationKey) {
      didWarnAboutRotationKey = true
      logger.warn({
        message:
          'ACTIVITIES_BLUESKY_PDS_ROTATION_KEY must be a 64-character hex secp256k1 private key; hosted Bluesky accounts will be refused'
      })
    }
    cachedRotationKey = null
    return null
  }

  cachedRotationKey = raw.toLowerCase()
  return cachedRotationKey
}

const normalizeHttpsOrigin = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null
  if (parsed.search !== '' || parsed.hash !== '') return null
  return parsed.origin
}

let cachedPlcDirectoryRaw: string | undefined
let hasCachedPlcDirectory = false
let cachedPlcDirectoryUrl = DEFAULT_PLC_DIRECTORY_URL
let didWarnAboutPlcDirectory = false

/**
 * The PLC directory the embedded PDS submits `did:plc` operations to. An
 * unset value uses `DEFAULT_PLC_DIRECTORY_URL`; an invalid value (not an https
 * origin with no path, query, fragment or credentials) logs one warning and
 * falls back to the default.
 */
export const getPlcDirectoryUrl = (): string => {
  const raw = process.env.ACTIVITIES_BLUESKY_PLC_DIRECTORY_URL?.trim()
  if (hasCachedPlcDirectory && raw === cachedPlcDirectoryRaw) {
    return cachedPlcDirectoryUrl
  }
  cachedPlcDirectoryRaw = raw
  hasCachedPlcDirectory = true

  if (!raw) {
    cachedPlcDirectoryUrl = DEFAULT_PLC_DIRECTORY_URL
    return cachedPlcDirectoryUrl
  }

  const normalized = normalizeHttpsOrigin(raw)
  if (!normalized) {
    if (!didWarnAboutPlcDirectory) {
      didWarnAboutPlcDirectory = true
      logger.warn({
        message: `ACTIVITIES_BLUESKY_PLC_DIRECTORY_URL must be an https origin with no path, query, fragment or credentials; using ${DEFAULT_PLC_DIRECTORY_URL}`
      })
    }
    cachedPlcDirectoryUrl = DEFAULT_PLC_DIRECTORY_URL
    return cachedPlcDirectoryUrl
  }

  cachedPlcDirectoryUrl = normalized
  return cachedPlcDirectoryUrl
}

/** Bluesky's AppView, which hosted accounts read timelines and views from. */
export const DEFAULT_BLUESKY_APPVIEW_URL = 'https://api.bsky.app'
/** The AppView's service reference, `<did>#<service id>`. */
export const DEFAULT_BLUESKY_APPVIEW_DID = 'did:web:api.bsky.app#bsky_appview'

// A DID with an optional `#service` fragment.
const SERVICE_DID_PATTERN =
  /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-](#[a-zA-Z0-9._~-]+)?$/

const warnedAppViewVariables = new Set<string>()
const warnAppViewOnce = (name: string, message: string) => {
  if (warnedAppViewVariables.has(name)) return
  warnedAppViewVariables.add(name)
  logger.warn({ message })
}

/**
 * The AppView a hosted account's `app.bsky.*` calls go to. An unset value uses
 * `DEFAULT_BLUESKY_APPVIEW_URL`; an invalid one (not an https origin with no
 * path, query, fragment or credentials) warns once and uses the default.
 */
export const getBlueskyAppViewUrl = (): string => {
  const raw = process.env.ACTIVITIES_BLUESKY_APPVIEW_URL?.trim()
  if (!raw) return DEFAULT_BLUESKY_APPVIEW_URL
  const normalized = normalizeHttpsOrigin(raw)
  if (normalized) return normalized
  warnAppViewOnce(
    'ACTIVITIES_BLUESKY_APPVIEW_URL',
    `ACTIVITIES_BLUESKY_APPVIEW_URL must be an https origin with no path, query, fragment or credentials; using ${DEFAULT_BLUESKY_APPVIEW_URL}`
  )
  return DEFAULT_BLUESKY_APPVIEW_URL
}

/**
 * The AppView's service DID, as `<did>#<service id>`, that service-auth
 * tokens for hosted accounts are addressed to. An unset value uses
 * `DEFAULT_BLUESKY_APPVIEW_DID`; an invalid one warns once and uses the
 * default.
 */
export const getBlueskyAppViewDid = (): string => {
  const raw = process.env.ACTIVITIES_BLUESKY_APPVIEW_DID?.trim()
  if (!raw) {
    // Tokens for another AppView addressed to Bluesky's would be refused.
    if (process.env.ACTIVITIES_BLUESKY_APPVIEW_URL?.trim()) {
      warnAppViewOnce(
        'ACTIVITIES_BLUESKY_APPVIEW_DID unset',
        `ACTIVITIES_BLUESKY_APPVIEW_URL is set but ACTIVITIES_BLUESKY_APPVIEW_DID is not; service-auth tokens are addressed to ${DEFAULT_BLUESKY_APPVIEW_DID}. Set both together.`
      )
    }
    return DEFAULT_BLUESKY_APPVIEW_DID
  }
  if (raw.length <= 2048 && SERVICE_DID_PATTERN.test(raw)) return raw
  warnAppViewOnce(
    'ACTIVITIES_BLUESKY_APPVIEW_DID',
    `ACTIVITIES_BLUESKY_APPVIEW_DID must be a DID with an optional #service fragment; using ${DEFAULT_BLUESKY_APPVIEW_DID}`
  )
  return DEFAULT_BLUESKY_APPVIEW_DID
}
