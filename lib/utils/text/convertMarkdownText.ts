import {
  Marked,
  RendererObject,
  Tokenizer,
  TokenizerAndRendererExtension,
  TokenizerObject
} from 'marked'

export type MentionMatchGroup = { username: string; domain: string | null }

export const MENTION_REGEX =
  /@(?<username>[a-zA-Z0-9_.]+)(@(?<domain>[a-zA-Z0-9_.]+))?/

export const MENTION_TOKENIZER_REGEX = new RegExp(
  `^${MENTION_REGEX.source}(\\s+|$)`
)
export const MENTION_GLOBAL_REGEX = new RegExp(
  `(^|\\s+)?${MENTION_REGEX.source}($|\\s+)?`,
  'g'
)
export const LINK_BODY_LIMIT = 30

const mention: (host: string) => TokenizerAndRendererExtension = (host) => ({
  name: 'mention',
  level: 'inline',
  start(src) {
    return src.match(/(^|\s+)@\w+/)?.index
  },
  tokenizer(src) {
    const rule = MENTION_TOKENIZER_REGEX
    const match = rule.exec(src)
    if (match) {
      const { username, domain } = match.groups as MentionMatchGroup
      return {
        type: 'mention',
        raw: match[0].trim(),
        username,
        domain
      }
    }
  },
  renderer(token) {
    return `<span class="h-card"><a href="https://${host}/${token.raw}" target="_blank" class="u-url mention">@<span>${token.username}</span></a></span>`
  }
})

const SHARED_RENDERER: RendererObject = {
  link({ href, title, text }) {
    if (title) {
      return `<a href="${href}" title="${title}" target="_blank" rel="noopener noreferrer">${text}</a>`
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
  }
}

const SHARED_TOKENIZER: TokenizerObject = {
  url(src) {
    const tokenizer = this as Tokenizer
    const cap = tokenizer.rules.inline.url.exec(src)
    if (!cap) return false
    if (cap[2] === '@') return false

    // do extended autolink path validation
    let prevCapZero
    do {
      prevCapZero = cap[0]
      cap[0] = tokenizer.rules.inline._backpedal.exec(cap[0])?.[0] ?? ''
    } while (prevCapZero !== cap[0])
    const href = cap[1] === 'www.' ? 'http://' + cap[0] : cap[0]
    try {
      const link = new URL(href)
      const hostname = link.host.startsWith('www.')
        ? link.host.slice(4)
        : link.host
      const pathnameWithSearch = `${link.pathname}${link.search}`
      const fullText = `${hostname}${pathnameWithSearch === '/' ? '' : pathnameWithSearch}`
      const text =
        fullText.length > LINK_BODY_LIMIT
          ? `${fullText.slice(0, LINK_BODY_LIMIT)}…`
          : fullText
      return {
        type: 'link',
        raw: cap[0],
        text,
        href,
        tokens: [
          {
            type: 'text',
            raw: cap[0],
            text
          }
        ]
      }
    } catch {
      return false
    }
  }
}

export const convertMarkdownText = (host: string) => (text: string) =>
  (
    new Marked({
      gfm: true,
      async: false,
      extensions: [mention(host)],
      renderer: SHARED_RENDERER,
      tokenizer: SHARED_TOKENIZER
    }).parse(text) as string
  ).trim()
