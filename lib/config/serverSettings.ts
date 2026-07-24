import { z } from 'zod'

import {
  DEFAULT_MAX_STATUS_CHARACTERS,
  MAX_POLL_EXPIRATION_SECONDS,
  MAX_POLL_OPTION_CHARS,
  MAX_STORED_MEDIA_ATTACHMENTS,
  MIN_POLL_EXPIRATION_SECONDS
} from '@/lib/services/mastodon/constants'
import {
  MAX_CONFIGURABLE_FILE_SIZE,
  MAX_FILE_SIZE
} from '@/lib/services/medias/constants'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

import { getEnvironmentList } from './utils'

// The database-backed server settings registry. Each field maps a value that
// today lives in an ACTIVITIES_* env var or a hardcoded constant to a
// database-backed setting resolved by env -> database -> default. Env reads and
// env-var name constants stay in lib/config (see AGENTS.md); the resolver in
// lib/services/serverSettings combines this registry with the database.

// Which admin tab a field belongs to. Drives grouping in the admin UI/API; note
// it is coarser than the dotted key prefix (registrations.* live on the
// Instance tab; polls.*/media.* live on the Posts & media tab).
export type ServerSettingTab = 'instance' | 'posts' | 'network' | 'federation'

// Maximum poll expiration (~1 month). Uses the value the create/edit routes
// actually enforce, so advertising and enforcement agree (the routes previously
// advertised the Mastodon literal 2629746 while enforcing this constant).
export const DEFAULT_MAX_POLL_EXPIRATION_SECONDS = MAX_POLL_EXPIRATION_SECONDS

// Matches the outbound request wrapper's effective default when no
// ACTIVITIES_REQUEST_* variable is set (lib/utils/request.ts previously fell
// back to 10000 in that common case), so the unconfigured timeout is unchanged.
const DEFAULT_REQUEST_TIMEOUT_MS = 10000
const DEFAULT_REQUEST_RETRIES = 1
const DEFAULT_MAX_RESPONSE_SIZE_BYTES = 2 * 1024 * 1024

// The fully-resolved settings shape consumers read. Grouped by concern; the
// dotted registry keys below write into these paths.
export interface ResolvedServerSettings {
  instance: {
    name: string
    description: string
    contactEmail: string
    languages: string[]
  }
  registrations: {
    open: boolean
    allowEmails: string[]
  }
  posts: {
    maxCharacters: number
    maxMediaAttachments: number
  }
  polls: {
    maxOptions: number
    maxCharactersPerOption: number
    minExpirationSeconds: number
    maxExpirationSeconds: number
  }
  media: {
    maxFileSize: number
  }
  network: {
    requestTimeoutMs: number
    requestRetries: number
    maxResponseSizeBytes: number
  }
  federation: {
    mode: 'open' | 'allowlist'
    allowActorDomains: string[]
  }
}

// The default values, mirroring today's env defaults and hardcoded constants.
// A field is only served from the database when its env var is absent; when an
// env var is present it wins and locks the field.
export const DEFAULT_SERVER_SETTINGS: ResolvedServerSettings = {
  instance: {
    name: 'Activities.next',
    description: 'Personal activity pub server with Next.js',
    contactEmail: '',
    languages: ['en']
  },
  registrations: {
    open: true,
    allowEmails: []
  },
  posts: {
    maxCharacters: DEFAULT_MAX_STATUS_CHARACTERS,
    maxMediaAttachments: MAX_STORED_MEDIA_ATTACHMENTS
  },
  polls: {
    maxOptions: 4,
    maxCharactersPerOption: MAX_POLL_OPTION_CHARS,
    minExpirationSeconds: MIN_POLL_EXPIRATION_SECONDS,
    maxExpirationSeconds: DEFAULT_MAX_POLL_EXPIRATION_SECONDS
  },
  media: {
    maxFileSize: MAX_FILE_SIZE
  },
  network: {
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    requestRetries: DEFAULT_REQUEST_RETRIES,
    maxResponseSizeBytes: DEFAULT_MAX_RESPONSE_SIZE_BYTES
  },
  federation: {
    mode: 'open',
    allowActorDomains: []
  }
}

/* ------------------------------- env readers ------------------------------ */
// Each reader returns the parsed value when the variable is present, or
// undefined when it is not (so the resolver falls through to the database, then
// the default). The parsing mirrors getConfig() so an env-pinned setting keeps
// exactly the value it has today.

const readEnvString = (name: string) => (): string | undefined =>
  process.env[name]

const readEnvBooleanDefaultTrue = (name: string) => (): boolean | undefined =>
  process.env[name] === undefined ? undefined : process.env[name] !== 'false'

const readEnvNumber = (name: string) => (): number | undefined => {
  const raw = process.env[name]
  // Mirror getConfig()'s parsing exactly (getOptionalInteger / mediaStorage use
  // parseInt base 10): an empty value is "unset", and `parseInt` (not `Number`)
  // is what determines the pinned value so `5000ms`/`5e3`/`500.9` resolve the
  // same way here as in getConfig().
  if (raw === undefined || raw === '') return undefined
  const parsed = parseInt(raw, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

const readEnvStringArray = (name: string) => (): string[] | undefined =>
  process.env[name] === undefined
    ? undefined
    : getEnvironmentList(name, { onInvalidList: 'empty' })

const readEnvNormalizedEmails = (name: string) => (): string[] | undefined =>
  process.env[name] === undefined
    ? undefined
    : getEnvironmentList(name, { onInvalidList: 'empty' }).map(normalizeEmail)

const readEnvFederationMode =
  (name: string) => (): 'open' | 'allowlist' | undefined => {
    const raw = process.env[name]
    if (raw === undefined) return undefined
    if (raw === 'allowlist') return 'allowlist'
    // getConfig() treats an empty value as the 'open' default. Any other,
    // non-empty value is rejected by getConfig()'s strict enum at startup, so it
    // is unreachable here; fall through to database/default rather than silently
    // coercing a typo to the more permissive 'open'.
    if (raw === '' || raw === 'open') return 'open'
    return undefined
  }

/* -------------------------------- registry -------------------------------- */

export interface ServerSettingField {
  // Dotted storage key, e.g. `posts.maxCharacters`.
  key: string
  // Admin tab the field is shown on.
  group: ServerSettingTab
  // The env var that pins (locks) this field when present, for the badge.
  envVar?: string
  // Validates database and admin-supplied values.
  schema: z.ZodType
  // Reads the env override, or undefined when the variable is unset.
  readEnv: () => unknown
  // Reads/writes the field within a resolved settings object.
  get: (settings: ResolvedServerSettings) => unknown
  set: (settings: ResolvedServerSettings, value: unknown) => void
}

// Typed field factory: keeps each definition strongly typed while the registry
// stores them behind the erased ServerSettingField shape.
const field = <V>(def: {
  key: string
  group: ServerSettingTab
  envVar?: string
  schema: z.ZodType<V>
  readEnv: () => V | undefined
  get: (settings: ResolvedServerSettings) => V
  set: (settings: ResolvedServerSettings, value: V) => void
}): ServerSettingField => def as unknown as ServerSettingField

const nameSchema = z.string().trim().max(255)
const descriptionSchema = z.string().trim().max(5000)
const emailSchema = z.string().trim().max(255)
const languagesSchema = z.array(z.string().trim().min(2).max(15)).max(100)
const allowEmailsSchema = z
  .array(z.string().trim().max(255))
  .max(1000)
  .transform((emails) => emails.map(normalizeEmail))
const domainsSchema = z.array(z.string().trim().max(255)).max(1000)

export const SERVER_SETTING_FIELDS: ServerSettingField[] = [
  // Instance identity
  field<string>({
    key: 'instance.name',
    group: 'instance',
    envVar: 'ACTIVITIES_SERVICE_NAME',
    schema: nameSchema,
    readEnv: readEnvString('ACTIVITIES_SERVICE_NAME'),
    get: (s) => s.instance.name,
    set: (s, v) => {
      s.instance.name = v
    }
  }),
  field<string>({
    key: 'instance.description',
    group: 'instance',
    envVar: 'ACTIVITIES_SERVICE_DESCRIPTION',
    schema: descriptionSchema,
    readEnv: readEnvString('ACTIVITIES_SERVICE_DESCRIPTION'),
    get: (s) => s.instance.description,
    set: (s, v) => {
      s.instance.description = v
    }
  }),
  field<string>({
    key: 'instance.contactEmail',
    group: 'instance',
    // No env var: contact email has no dedicated variable today.
    schema: emailSchema,
    readEnv: () => undefined,
    get: (s) => s.instance.contactEmail,
    set: (s, v) => {
      s.instance.contactEmail = v
    }
  }),
  field<string[]>({
    key: 'instance.languages',
    group: 'instance',
    envVar: 'ACTIVITIES_LANGUAGES',
    schema: languagesSchema,
    readEnv: readEnvStringArray('ACTIVITIES_LANGUAGES'),
    get: (s) => s.instance.languages,
    set: (s, v) => {
      s.instance.languages = v
    }
  }),

  // Registrations
  field<boolean>({
    key: 'registrations.open',
    group: 'instance',
    envVar: 'ACTIVITIES_REGISTRATION_OPEN',
    schema: z.boolean(),
    readEnv: readEnvBooleanDefaultTrue('ACTIVITIES_REGISTRATION_OPEN'),
    get: (s) => s.registrations.open,
    set: (s, v) => {
      s.registrations.open = v
    }
  }),
  field<string[]>({
    key: 'registrations.allowEmails',
    group: 'instance',
    envVar: 'ACTIVITIES_ALLOW_EMAILS',
    schema: allowEmailsSchema,
    readEnv: readEnvNormalizedEmails('ACTIVITIES_ALLOW_EMAILS'),
    get: (s) => s.registrations.allowEmails,
    set: (s, v) => {
      s.registrations.allowEmails = v
    }
  }),

  // Posts & media
  field<number>({
    key: 'posts.maxCharacters',
    group: 'posts',
    schema: z.number().int().min(1).max(100000),
    readEnv: () => undefined,
    get: (s) => s.posts.maxCharacters,
    set: (s, v) => {
      s.posts.maxCharacters = v
    }
  }),
  field<number>({
    key: 'posts.maxMediaAttachments',
    group: 'posts',
    // Bounded by the stored-media safety ceiling; the setting drives the value
    // advertised to clients, not the hard create-route cap.
    schema: z.number().int().min(1).max(MAX_STORED_MEDIA_ATTACHMENTS),
    readEnv: () => undefined,
    get: (s) => s.posts.maxMediaAttachments,
    set: (s, v) => {
      s.posts.maxMediaAttachments = v
    }
  }),

  // Polls
  field<number>({
    key: 'polls.maxOptions',
    group: 'posts',
    schema: z.number().int().min(2).max(50),
    readEnv: () => undefined,
    get: (s) => s.polls.maxOptions,
    set: (s, v) => {
      s.polls.maxOptions = v
    }
  }),
  field<number>({
    key: 'polls.maxCharactersPerOption',
    group: 'posts',
    schema: z.number().int().min(1).max(1000),
    readEnv: () => undefined,
    get: (s) => s.polls.maxCharactersPerOption,
    set: (s, v) => {
      s.polls.maxCharactersPerOption = v
    }
  }),
  field<number>({
    key: 'polls.minExpirationSeconds',
    group: 'posts',
    schema: z.number().int().min(60),
    readEnv: () => undefined,
    get: (s) => s.polls.minExpirationSeconds,
    set: (s, v) => {
      s.polls.minExpirationSeconds = v
    }
  }),
  field<number>({
    key: 'polls.maxExpirationSeconds',
    group: 'posts',
    schema: z.number().int().min(300),
    readEnv: () => undefined,
    get: (s) => s.polls.maxExpirationSeconds,
    set: (s, v) => {
      s.polls.maxExpirationSeconds = v
    }
  }),

  // Media upload
  field<number>({
    key: 'media.maxFileSize',
    group: 'posts',
    envVar: 'ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE',
    // MAX_FILE_SIZE (200 MiB) is only the default; the cap can be raised to
    // MAX_CONFIGURABLE_FILE_SIZE. The object-storage driver bounds its
    // read-back buffer by this same resolved setting (S3StorageFile's
    // `getFile`), so raising the cap never stores a file the read path would
    // then refuse to serve. The ceiling is what keeps that buffer bounded.
    schema: z.number().int().min(1).max(MAX_CONFIGURABLE_FILE_SIZE),
    readEnv: readEnvNumber('ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE'),
    get: (s) => s.media.maxFileSize,
    set: (s, v) => {
      s.media.maxFileSize = v
    }
  }),

  // Network — outbound requests
  field<number>({
    key: 'network.requestTimeoutMs',
    group: 'network',
    envVar: 'ACTIVITIES_REQUEST_TIMEOUT',
    schema: z.number().int().min(1),
    readEnv: readEnvNumber('ACTIVITIES_REQUEST_TIMEOUT'),
    get: (s) => s.network.requestTimeoutMs,
    set: (s, v) => {
      s.network.requestTimeoutMs = v
    }
  }),
  field<number>({
    key: 'network.requestRetries',
    group: 'network',
    envVar: 'ACTIVITIES_REQUEST_RETRY',
    schema: z.number().int().min(0).max(20),
    readEnv: readEnvNumber('ACTIVITIES_REQUEST_RETRY'),
    get: (s) => s.network.requestRetries,
    set: (s, v) => {
      s.network.requestRetries = v
    }
  }),
  field<number>({
    key: 'network.maxResponseSizeBytes',
    group: 'network',
    envVar: 'ACTIVITIES_REQUEST_MAX_RESPONSE_SIZE_BYTES',
    schema: z.number().int().min(1),
    readEnv: readEnvNumber('ACTIVITIES_REQUEST_MAX_RESPONSE_SIZE_BYTES'),
    get: (s) => s.network.maxResponseSizeBytes,
    set: (s, v) => {
      s.network.maxResponseSizeBytes = v
    }
  }),

  // Federation policy
  field<'open' | 'allowlist'>({
    key: 'federation.mode',
    group: 'federation',
    envVar: 'ACTIVITIES_FEDERATION_MODE',
    schema: z.enum(['open', 'allowlist']),
    readEnv: readEnvFederationMode('ACTIVITIES_FEDERATION_MODE'),
    get: (s) => s.federation.mode,
    set: (s, v) => {
      s.federation.mode = v
    }
  }),
  field<string[]>({
    key: 'federation.allowActorDomains',
    group: 'federation',
    envVar: 'ACTIVITIES_ALLOW_ACTOR_DOMAINS',
    schema: domainsSchema,
    readEnv: readEnvStringArray('ACTIVITIES_ALLOW_ACTOR_DOMAINS'),
    get: (s) => s.federation.allowActorDomains,
    set: (s, v) => {
      s.federation.allowActorDomains = v
    }
  })
]

// Lookup by key for the admin write path.
export const SERVER_SETTING_FIELDS_BY_KEY: Record<string, ServerSettingField> =
  Object.fromEntries(SERVER_SETTING_FIELDS.map((f) => [f.key, f]))
