import { htmlToDOM } from 'html-react-parser'
import type {
  DOMNode,
  Element as HtmlElement,
  Text as HtmlText
} from 'html-react-parser'
import sanitizeHtml from 'sanitize-html'

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

const appendSeparator = (parts: string[], separator: string) => {
  if (parts.length === 0 || parts[parts.length - 1] === separator) return
  parts.push(separator)
}

const appendText = (parts: string[], text: string) => {
  if (!text) return
  parts.push(text)
}

const collectText = (
  nodes: PlainTextDomNode[],
  parts: string[],
  preserveLineBreaks: boolean
) => {
  nodes.forEach((node) => {
    if (isTextNode(node)) {
      appendText(parts, node.data)
      return
    }

    if (!isElementNode(node)) return

    if (node.name === 'br') {
      appendSeparator(parts, preserveLineBreaks ? '\n' : ' ')
      return
    }

    if (BLOCK_TAGS.has(node.name)) {
      const separator = preserveLineBreaks ? '\n\n' : ' '
      appendSeparator(parts, separator)
      collectText(node.children, parts, preserveLineBreaks)
      appendSeparator(parts, separator)
      return
    }

    collectText(node.children, parts, preserveLineBreaks)
  })
}

interface HtmlToPlainTextOptions {
  /**
   * Off by default, so the many single-line-preview callers (chat list,
   * search snippets, quote-card, oEmbed excerpts, search indexing) keep
   * flattening every <br>/block boundary to one space. Turn on for a
   * multi-line display (e.g. a heading) where a block caption should read as
   * paragraphs/line breaks rather than one run-on line.
   */
  preserveLineBreaks?: boolean
}

export const htmlToPlainText = (
  html: string | null | undefined,
  { preserveLineBreaks = false }: HtmlToPlainTextOptions = {}
) => {
  const sanitizedHtml = sanitizeHtml(html ?? '', {
    allowedTags: ALLOWED_STRUCTURE_TAGS,
    allowedAttributes: {}
  })
  const parts: string[] = []
  collectText(htmlToDOM(sanitizedHtml), parts, preserveLineBreaks)
  const text = parts.join('')

  if (!preserveLineBreaks) {
    return text.replace(/\s+/g, ' ').trim()
  }

  // Collapse horizontal whitespace, drop spaces hugging a line break, then
  // cap at one blank line between paragraphs (nested block tags can otherwise
  // stack several `\n\n` separators in a row).
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
