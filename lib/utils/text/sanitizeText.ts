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
    'li'
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'class', 'translate', 'target'],
    span: ['class', 'translate'],
    ol: ['start', 'reversed'],
    li: ['value']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto']
  },
  allowProtocolRelative: false,
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
  }
}

const SANITIZED_TRUSTED_STATUS_OPTION = {
  ...SANITIZED_OPTION,
  allowedTags: [...SANITIZED_OPTION.allowedTags, 'img'],
  allowedAttributes: {
    ...SANITIZED_OPTION.allowedAttributes,
    img: ['class', 'src', 'alt']
  },
  allowedClasses: {
    img: ['emoji']
  },
  allowedSchemesByTag: {
    ...SANITIZED_OPTION.allowedSchemesByTag,
    img: ['https']
  },
  exclusiveFilter(frame: sanitizeHtml.IFrame) {
    if (frame.tag !== 'img') return false
    const classes = frame.attribs.class?.split(/\s+/) ?? []
    return !classes.includes('emoji') || !frame.attribs.src
  }
}

// Support the same tags as Mastodon here
// https://github.com/mastodon/mastodon/blob/eae5c7334ae61c463edd2e3cd03115b897f6e92b/lib/sanitize_ext/sanitize_config.rb
export const sanitizeText = (text: string) =>
  sanitizeHtml(text, {
    ...SANITIZED_OPTION
  })

// Use only after untrusted input has already gone through sanitizeText and the
// app has injected known custom-emoji image tags from structured status tags.
export const sanitizeTrustedStatusText = (text: string) =>
  sanitizeHtml(text, {
    ...SANITIZED_TRUSTED_STATUS_OPTION
  })
