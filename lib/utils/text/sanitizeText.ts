import sanitizeHtml from 'sanitize-html'

// The microformat and presentation classes fediverse servers put inside status
// text: the mention wrapper and its anchor, hashtag anchors, the
// `invisible`/`ellipsis` spans Mastodon splits a long link's display text into,
// and the `quote-inline` marker on the legacy quote fallback ("RE: <link>") a
// quote post carries for receivers that do not understand structured quotes —
// kept so `cleanClassName` can hide the redundant line whenever a quote card
// renders (Mastodon 4.5 wraps it in a `p`, older conventions in a `span`).
//
// An ALLOWLIST rather than Mastodon's own `h-*`/`p-*`/`u-*` prefix globs,
// because those globs are unsafe in a Tailwind app: `h-*` would admit `h-screen`
// and `p-*` would admit `p-0`. The list is short and the fediverse's is not
// growing, so enumerating is both safer and clearer here.
//
// Without it the class attribute is a hole. `cleanClassName` hands an anchor's
// class straight to `className` and leaves any span class it does not itself
// rewrite alone, so a class named here reaches the real DOM — and this app
// compiles Tailwind, which means every utility in the bundle is a class a
// remote server can spend on our page. `sr-only` is
// `position:absolute;width:1px;height:1px;clip-path:inset(50%)`: enough to
// publish text, including a link, that no reader can see.
//
// Exported because the link-preview extractor's own hidden-class list is only
// sufficient while this one is: see the coupling test in
// `lib/services/link-previews/extractUrl.test.ts`.
export const ALLOWED_CONTENT_CLASSES = [
  'h-card',
  'p-author',
  'u-url',
  'mention',
  'hashtag',
  'invisible',
  'ellipsis',
  'quote-inline'
]

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
    p: ['class'],
    ol: ['start', 'reversed'],
    li: ['value']
  },
  allowedClasses: {
    a: ALLOWED_CONTENT_CLASSES,
    span: ALLOWED_CONTENT_CLASSES,
    // `p` may wear ONLY the quote-fallback marker (Mastodon 4.5 wraps its
    // "RE: <link>" line in `<p class="quote-inline">`). The microformat
    // classes have no meaning on a paragraph, so don't widen what remote
    // HTML can keep.
    p: ['quote-inline']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto']
  },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName: string, attribs: sanitizeHtml.Attributes) => {
      if (attribs.target !== '_blank') {
        const { target: _target, ...safeAttribs } = attribs
        return { tagName, attribs: safeAttribs }
      }

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
  // Spread, never replace. A tag with no entry here keeps its class attribute
  // untouched, so declaring `img` alone would hand span and a back their
  // unrestricted class and undo the first pass — which is the pass that sees
  // the untrusted input.
  allowedClasses: {
    ...SANITIZED_OPTION.allowedClasses,
    img: ['emoji']
  },
  allowedSchemesByTag: {
    ...SANITIZED_OPTION.allowedSchemesByTag,
    img: ['https']
  },
  exclusiveFilter(frame: sanitizeHtml.IFrame) {
    if (frame.tag !== 'img') return false
    const classes = frame.attribs.class?.trim().split(/\s+/) ?? []
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
