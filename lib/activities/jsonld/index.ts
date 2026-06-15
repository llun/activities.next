import type { ContextDefinition, JsonLdDocument } from 'jsonld'
import type { RemoteDocument, Url } from 'jsonld/jsonld-spec'

import { logger } from '@/lib/utils/logger'
import { isRecord } from '@/lib/utils/typeGuards'

import activityStreamsContext from './contexts/activitystreams.json'
import securityV1Context from './contexts/security-v1.json'

// ============================================================================
// Bundled context documents (offline assets)
//
// ActivityPub objects are JSON-LD, so the same logical object can arrive in
// many shapes (compacted, expanded, with `type` as a string/array/IRI, with
// recipients as a single value or an array, …). We canonicalise inbound
// documents by running them through the real JSON-LD processor (`jsonld`) and
// compacting against a single known context. Strict-ish Zod schemas can then
// rely on a predictable shape (bare `type` terms, id references as strings,
// recipients always arrays) instead of every dialect variation.
//
// The processor MUST NOT dereference remote `@context` URLs at runtime — that
// is an SSRF/DoS vector. Instead the context documents we understand are
// bundled as committed JSON assets and served by an offline document loader;
// every other URL resolves to an empty context (its terms simply drop).
// ============================================================================

export const ACTIVITY_STREAMS_CONTEXT_URL =
  'https://www.w3.org/ns/activitystreams'
export const SECURITY_V1_CONTEXT_URL = 'https://w3id.org/security/v1'

const MASTODON_NAMESPACE = 'http://joinmastodon.org/ns#'
const SCHEMA_NAMESPACE = 'http://schema.org#'

const BUNDLED_CONTEXTS: Record<string, unknown> = {
  [ACTIVITY_STREAMS_CONTEXT_URL]: activityStreamsContext,
  // Some peers reference these contexts over http instead of https; map both so
  // their terms (e.g. publicKey) are not dropped.
  'http://www.w3.org/ns/activitystreams': activityStreamsContext,
  [SECURITY_V1_CONTEXT_URL]: securityV1Context,
  'http://w3id.org/security/v1': securityV1Context
}

const EMPTY_CONTEXT_DOCUMENT = { '@context': {} }

type JsonLdProcessor = {
  compact: (
    input: JsonLdDocument,
    ctx: ContextDefinition,
    options: { documentLoader: (url: Url) => Promise<RemoteDocument> }
  ) => Promise<Record<string, unknown>>
}

// `jsonld` (via `rdf-canonize`) is a heavy, Node-only dependency: importing it
// eagerly references `setImmediate`, which is absent in jsdom, so it must not be
// pulled into module graphs that never compact (e.g. React component tests). We
// therefore load it lazily on first use and cache the promise.
let processorPromise: Promise<JsonLdProcessor> | null = null

const getProcessor = (): Promise<JsonLdProcessor> => {
  if (!processorPromise) {
    processorPromise = import('jsonld').then(
      (module) =>
        ((module as { default?: unknown }).default ??
          module) as unknown as JsonLdProcessor
    )
  }
  return processorPromise
}

/**
 * Default context applied to inbound documents that omit `@context` entirely
 * (for example individual `orderedItems` inside an outbox collection, which do
 * not repeat the collection's context). Treating them as ActivityStreams is the
 * only sane default and matches how every plain-JSON ActivityPub server reads
 * them.
 */
const DEFAULT_INPUT_CONTEXT = [
  ACTIVITY_STREAMS_CONTEXT_URL,
  SECURITY_V1_CONTEXT_URL
]

/**
 * The single context we compact every inbound document against. It defines the
 * ActivityStreams + security vocabularies plus the handful of extension terms
 * we actually consume, and forces collection-like properties to always be
 * arrays via `@container: @set` so the Zod schemas can rely on it.
 */
const CANONICAL_CONTEXT = {
  '@context': [
    ACTIVITY_STREAMS_CONTEXT_URL,
    SECURITY_V1_CONTEXT_URL,
    {
      toot: MASTODON_NAMESPACE,
      schema: SCHEMA_NAMESPACE,

      // Extension *types* we match on, aliased so they compact to bare terms
      // (e.g. a custom emoji's `http://joinmastodon.org/ns#Emoji` would
      // otherwise compact to the CURIE `toot:Emoji` and be dropped).
      Emoji: 'toot:Emoji',

      // Extension terms we read, mapped to their canonical IRIs so they survive
      // compaction as bare property names instead of being dropped.
      sensitive: 'as:sensitive',
      votersCount: 'toot:votersCount',
      blurhash: 'toot:blurhash',
      focalPoint: { '@id': 'toot:focalPoint', '@container': '@list' },
      discoverable: 'toot:discoverable',
      indexable: 'toot:indexable',
      memorial: 'toot:memorial',
      suspended: 'toot:suspended',
      manuallyApprovesFollowers: 'as:manuallyApprovesFollowers',
      movedTo: { '@id': 'as:movedTo', '@type': '@id' },
      alsoKnownAs: { '@id': 'as:alsoKnownAs', '@type': '@id' },
      featured: { '@id': 'toot:featured', '@type': '@id' },
      featuredTags: { '@id': 'toot:featuredTags', '@type': '@id' },
      devices: { '@id': 'toot:devices', '@type': '@id' },
      PropertyValue: 'schema:PropertyValue',
      value: 'schema:value',

      // Collection-like properties: always arrays.
      to: { '@id': 'as:to', '@type': '@id', '@container': '@set' },
      cc: { '@id': 'as:cc', '@type': '@id', '@container': '@set' },
      tag: { '@id': 'as:tag', '@container': '@set' },
      attachment: { '@id': 'as:attachment', '@container': '@set' }
    }
  ]
}

/**
 * Offline document loader: serves the bundled contexts we understand and never
 * touches the network. Unknown context URLs resolve to an empty context, so
 * compaction still succeeds and unrecognised terms are simply dropped.
 */
export const offlineDocumentLoader = async (
  url: Url
): Promise<RemoteDocument> => {
  const document = BUNDLED_CONTEXTS[url] ?? EMPTY_CONTEXT_DOCUMENT
  return {
    contextUrl: undefined,
    documentUrl: url,
    document
  } as RemoteDocument
}

/**
 * Recursively strips JSON-LD bookkeeping from a compacted document:
 * - the echoed `@context`,
 * - blank-node property keys (`_:term`), which the ActivityStreams context
 *   produces for terms a sender included without defining,
 * - a leading `_:` on `type` values, recovering the bare local name (e.g. an
 *   undefined `QuoteRequest` type expands to `_:QuoteRequest`).
 */
const stripJsonLdArtifacts = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripJsonLdArtifacts)
  if (!isRecord(value)) return value

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '@context') continue
    if (key.startsWith('_:')) continue
    if (key === 'type') {
      result[key] = stripBlankNodePrefix(item)
      continue
    }
    result[key] = stripJsonLdArtifacts(item)
  }
  return result
}

const stripBlankNodePrefix = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripBlankNodePrefix)
  if (typeof value === 'string' && value.startsWith('_:')) {
    return value.slice(2)
  }
  return value
}

const withInputContext = (input: Record<string, unknown>) =>
  input['@context'] ? input : { ...input, '@context': DEFAULT_INPUT_CONTEXT }

/**
 * Canonicalise an inbound ActivityPub document by compacting it against the
 * canonical context with the offline loader. Non-object inputs are returned
 * unchanged, and any processing error falls back to the original input so a
 * malformed `@context` can never make inbound handling worse than the previous
 * plain-JSON behaviour.
 *
 * Compaction preserves the document's logical shape (it only canonicalises how
 * existing fields are represented), so the result is typed as the input type.
 * This lets callers keep their existing typings without an extra cast.
 */
export const compactActivityPub = async <T>(input: T): Promise<T> => {
  if (!isRecord(input)) return input

  try {
    const jsonld = await getProcessor()
    const compacted = await jsonld.compact(
      withInputContext(input) as JsonLdDocument,
      CANONICAL_CONTEXT as unknown as ContextDefinition,
      { documentLoader: offlineDocumentLoader }
    )
    return stripJsonLdArtifacts(compacted) as T
  } catch (error) {
    logger.warn({
      message: 'Failed to compact ActivityPub document, using raw input',
      error: error instanceof Error ? error.message : String(error)
    })
    return input
  }
}
