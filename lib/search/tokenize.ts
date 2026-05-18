import sanitizeHtml from 'sanitize-html'

const DEFAULT_MAX_TOKENS = 32
const DEFAULT_MAX_TOKEN_LENGTH = 64
const DEFAULT_MIN_PREFIX_LENGTH = 2
const HTML_TEXT_BOUNDARY_TAGS = new Set([
  'article',
  'blockquote',
  'div',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'ol',
  'p',
  'section',
  'ul'
])

type NormalizeSearchTokensOptions = {
  maxTokens?: number
  maxTokenLength?: number
}

type BuildSearchTermPrefixesOptions = {
  minPrefixLength?: number
  maxPrefixLength?: number
}

const stripHtmlForSearch = (value: string) =>
  sanitizeHtml(value, {
    allowedTags: ['br'],
    allowedAttributes: {},
    textFilter: (text, tagName) =>
      HTML_TEXT_BOUNDARY_TAGS.has(tagName) ? `${text} ` : text
  }).replace(/<br\s*\/?>/gi, ' ')

export const normalizeSearchTokens = (
  value: string,
  {
    maxTokens = DEFAULT_MAX_TOKENS,
    maxTokenLength = DEFAULT_MAX_TOKEN_LENGTH
  }: NormalizeSearchTokensOptions = {}
): string[] => {
  const seen = new Set<string>()
  const tokens: string[] = []
  const normalized = stripHtmlForSearch(value)
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')

  for (const rawToken of normalized.split(/\s+/)) {
    const token = rawToken.trim().slice(0, maxTokenLength)
    if (token.length === 0 || seen.has(token)) continue

    seen.add(token)
    tokens.push(token)
    if (tokens.length >= maxTokens) break
  }

  return tokens
}

export const buildSearchTermPrefixes = (
  tokens: string[],
  {
    minPrefixLength = DEFAULT_MIN_PREFIX_LENGTH,
    maxPrefixLength = DEFAULT_MAX_TOKEN_LENGTH
  }: BuildSearchTermPrefixesOptions = {}
): string[] => {
  const prefixes = new Set<string>()

  for (const token of tokens) {
    const maxLength = Math.min(token.length, maxPrefixLength)
    for (let length = minPrefixLength; length <= maxLength; length += 1) {
      prefixes.add(token.slice(0, length))
    }
  }

  return [...prefixes]
}
