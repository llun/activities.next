import sanitizeHtml from 'sanitize-html'

export const SANITIZED_OPTION = {
  allowedTags: [
    'p',
    'br',
    'span',
    'a',
    'del',
    'pre',
    'blockquote',
    'code',
    'b',
    'strong',
    'u',
    'i',
    'em',
    'ul',
    'ol',
    'li',
    'img'
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'class', 'translate', 'target'],
    img: ['class', 'src', 'alt'],
    span: ['class', 'translate'],
    ol: ['start', 'reversed'],
    li: ['value']
  },
  allowedClasses: {
    img: ['emoji']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
    img: ['https']
  },
  transformTags: {
    a: (tagName: string, attribs: sanitizeHtml.Attributes) => {
      if (attribs.target !== '_blank') return { tagName, attribs }

      const rel = new Set((attribs.rel ?? '').split(/\s+/).filter(Boolean))
      rel.add('noopener')
      rel.add('noreferrer')

      return {
        tagName,
        attribs: {
          ...attribs,
          rel: Array.from(rel).join(' ')
        }
      }
    }
  },
  exclusiveFilter(frame: sanitizeHtml.IFrame) {
    if (frame.tag !== 'img') return false
    return !frame.attribs.class?.split(/\s+/).includes('emoji')
  }
}

// Support the same tags as Mastodon here
// https://github.com/mastodon/mastodon/blob/eae5c7334ae61c463edd2e3cd03115b897f6e92b/lib/sanitize_ext/sanitize_config.rb
export const sanitizeText = (text: string) =>
  sanitizeHtml(text, {
    ...SANITIZED_OPTION
  })
