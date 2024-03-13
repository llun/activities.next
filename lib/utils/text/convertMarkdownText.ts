import { Tokenizer, marked } from 'marked'

export const LINK_BODY_LIMIT = 30

marked.use({
  renderer: {
    link(href, title, text) {
      if (title) {
        return `<a href="${href}" title="${title}" target="_blank" rel="noopener noreferrer">${text}</a>`
      }
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
    }
  },
  tokenizer: {
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
})

export const convertMarkdownText = (text: string) =>
  marked.parse(text, { gfm: true, async: false }) as string
