import { htmlToDOM } from 'html-react-parser'
import type {
  DOMNode,
  Element as HtmlElement,
  Text as HtmlText
} from 'html-react-parser'
import sanitizeHtml from 'sanitize-html'

import {
  isEllipsisClass,
  isInvisibleClass,
  isQuoteInlineClass
} from '@/lib/utils/text/statusBodyClasses'

const BLOCK_TAGS = new Set([
  'blockquote',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ol',
  'p',
  'pre',
  'ul'
])

const ALLOWED_STRUCTURE_TAGS = ['br', ...BLOCK_TAGS]

type PlainTextDomNode = DOMNode | HtmlElement['children'][number]

const isTextNode = (node: PlainTextDomNode): node is HtmlText =>
  node.type === 'text'

const isElementNode = (node: PlainTextDomNode): node is HtmlElement =>
  node.type === 'tag' || node.type === 'script' || node.type === 'style'

const appendSpace = (parts: string[]) => {
  if (parts.length === 0 || parts[parts.length - 1] === ' ') return
  parts.push(' ')
}

const appendText = (parts: string[], text: string) => {
  if (!text) return
  parts.push(text)
}

export interface HtmlToPlainTextOptions {
  // Read the markup the way the status body renders it: Mastodon's `invisible`
  // link parts are dropped, `ellipsis` gets its "…", and the `quote-inline`
  // fallback is dropped when `hideQuoteInline` is set. Off by default.
  matchStatusBody?: boolean
  hideQuoteInline?: boolean
}

const collectText = (
  nodes: PlainTextDomNode[],
  parts: string[],
  options: HtmlToPlainTextOptions = {}
) => {
  nodes.forEach((node) => {
    if (isTextNode(node)) {
      appendText(parts, node.data)
      return
    }

    if (!isElementNode(node)) return

    if (options.matchStatusBody) {
      const className = node.attribs?.class
      if (
        isInvisibleClass(className) ||
        (options.hideQuoteInline && isQuoteInlineClass(className))
      ) {
        return
      }
      if (isEllipsisClass(className)) {
        collectText(node.children, parts, options)
        appendText(parts, '…')
        return
      }
    }

    if (node.name === 'br') {
      appendSpace(parts)
      return
    }

    if (BLOCK_TAGS.has(node.name)) {
      appendSpace(parts)
      collectText(node.children, parts, options)
      appendSpace(parts)
      return
    }

    collectText(node.children, parts, options)
  })
}

// Remote HTML (an actor's summary) nests as deep as its author likes, and
// `collectText` spends stack frames per level. Real markup stays a few levels
// deep (`p > a > span`); tags beyond this depth are dropped by the sanitizer
// while their text is kept, so a hostile bio cannot overflow the stack.
const MAX_NESTING_DEPTH = 10

export const htmlToPlainText = (
  html: string | null | undefined,
  options: HtmlToPlainTextOptions = {}
) => {
  const sanitizedHtml = sanitizeHtml(html ?? '', {
    allowedTags: options.matchStatusBody
      ? [...ALLOWED_STRUCTURE_TAGS, 'a', 'span']
      : ALLOWED_STRUCTURE_TAGS,
    allowedAttributes: options.matchStatusBody
      ? { a: ['class'], p: ['class'], span: ['class'] }
      : {},
    nestingLimit: MAX_NESTING_DEPTH
  })
  const parts: string[] = []
  collectText(htmlToDOM(sanitizedHtml), parts, options)
  return parts.join('').replace(/\s+/g, ' ').trim()
}
