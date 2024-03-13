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
    a: ['href', 'rel', 'class', 'translate'],
    span: ['class', 'translate'],
    ol: ['start', 'reversed'],
    li: ['value']
  },
  allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel']
}

// Support the same tags as Mastodon here
// https://github.com/mastodon/mastodon/blob/eae5c7334ae61c463edd2e3cd03115b897f6e92b/lib/sanitize_ext/sanitize_config.rb
export const sanitizeText = (text: string) =>
  sanitizeHtml(text, {
    ...SANITIZED_OPTION
  })
