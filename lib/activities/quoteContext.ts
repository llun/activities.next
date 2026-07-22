import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'

// Inline JSON-LD term map for the FEP-044f / Mastodon-4.5 quote vocabulary,
// emitted on outbound quote-carrying activities so receivers (whose parsers are
// context-driven) keep the terms. Mirrors the inbound aliases in
// CANONICAL_CONTEXT (lib/activities/jsonld) — `instrument`/`result` are core
// AS2 terms and need no entry here.
export const QUOTE_CONTEXT_TERMS = {
  fep044f: 'https://w3id.org/fep/044f#',
  gts: 'https://gotosocial.org/ns#',
  fedibird: 'http://fedibird.com/ns#',
  misskey: 'https://misskey-hub.net/ns#',

  QuoteRequest: 'fep044f:QuoteRequest',
  QuoteAuthorization: 'fep044f:QuoteAuthorization',

  quote: { '@id': 'fep044f:quote', '@type': '@id' },
  quoteUrl: 'as:quoteUrl',
  quoteUri: 'fedibird:quoteUri',
  _misskey_quote: 'misskey:_misskey_quote',
  quoteAuthorization: { '@id': 'fep044f:quoteAuthorization', '@type': '@id' },
  interactingObject: { '@id': 'gts:interactingObject', '@type': '@id' },
  interactionTarget: { '@id': 'gts:interactionTarget', '@type': '@id' },

  interactionPolicy: 'gts:interactionPolicy',
  canQuote: 'gts:canQuote',
  automaticApproval: {
    '@id': 'gts:automaticApproval',
    '@type': '@id',
    '@container': '@set'
  },
  manualApproval: {
    '@id': 'gts:manualApproval',
    '@type': '@id',
    '@container': '@set'
  }
} as const

// The `@context` value for outbound activities/objects that carry quote terms.
export const QUOTE_ACTIVITY_CONTEXT = [ACTIVITY_STREAM_URL, QUOTE_CONTEXT_TERMS]
